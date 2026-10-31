# Supabase Auth への置き換え (#124)

## To-Be

- クライアントは Supabase Auth でサインインし、API には `Authorization: Bearer <access token>` を付けて呼ぶ。`x-user-id` は無くなる
- API は token を Supabase の JWKS (ES256 の公開鍵) で検証し、`sub` を current user の id にする。秘密の鍵は API に置かない
- `public.users.id` は `auth.users.id` と同じ値 (判断キュー D-10)。行は API が初回のリクエストで作る
- サインインは OAuth だけ (Google と Apple。判断キュー D-11)。Email provider は無効にし、サインアップ画面 (M-02) は作らない。API はどの方式でも同じ token を受けるので、方式はクライアント側だけの話

## API

### token の検証

- `Authorization` が `Bearer <token>` でない / 署名・`exp`・`iss`・`aud` のどれかが合わない → 401 `UNAUTHORIZED`
- 受ける alg は `ES256` と `RS256` (Supabase の非対称鍵)。`HS256` (旧来の共有鍵) は受けない
- `iss` は env `SUPABASE_JWT_ISSUER`、無ければ `<SUPABASE_URL>/auth/v1`。`aud` は `authenticated`
- 検証は hono の `verifyWithJwks` (追加の依存なし)。JWKS は `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` から取り、10 分持つ。手持ちの鍵に無い `kid` が来たら取り直す (鍵の入れ替えに追従する)。ただし直前の取得から 1 分以内なら取り直さない (でたらめな `kid` で Supabase への取得を増やされないため)

### 設定

- `createApp` は `auth` を必須で受ける: 公開鍵の取得関数・`issuer`・`audience`
- 起動口 (`src/index.ts`) は env `SUPABASE_URL` から組み立てる。無ければ起動しない
- `SUPABASE_JWT_ISSUER` は、API が token の発行元と別の名前で Supabase に届く構成のためのもの。compose は API コンテナから `host.docker.internal:54321` で手元の `supabase start` に届き、token の `iss` は `http://127.0.0.1:54321/auth/v1` (supabase/config.toml の `auth.jwt_issuer` の既定) なので、compose の既定はこの値にしている

### users の行

- 検証が通ったら `users` に `(id = sub, email = token の email, display_name = email の @ より前)` を `on conflict do nothing` で入れる
- 同じ email の別 id の行が既にあると入らない。その場合は middleware が 409 `EMAIL_IN_USE` を返す (seed で作った開発用の行や、Supabase のアカウントを作り直したときに起きる)。同じ user の初回リクエストが同時に来て、片方が先に行を作った場合は通す
- token に email が無い (匿名サインインなど) / `sub` が UUID でない → 401
- 鍵を 1 度も取れていない (Supabase に届かない) → 503 `AUTH_UNAVAILABLE`。取れた後の取り直しに失敗したときは手持ちの鍵で検証を続ける
- 409 と 503 は全 `/v1` route で起きうるが、OpenAPI にはまだ宣言していない (follow-up)

## クライアント

- `@prep-hamster/api-client` の `userId` を `accessToken` に置き換え、`Authorization` ヘッダで送る
- CLI は env `PREP_HAMSTER_ACCESS_TOKEN` を読む (`PREP_HAMSTER_USER_ID` の置き換え)。login コマンドは別 PR
- mobile は `src/auth.ts` の `getAccessToken()` が Supabase のセッションの token を返す (下の「mobile のサインイン」)

## テスト

- E2E は ES256 の鍵の組をテストの中で作り、公開鍵を `createApp` の `auth` に渡す。token は helper で発行する
- 受け入れ: token なし 401 / 署名の違う token 401 / 期限切れ 401 / `iss` 違い 401 / `aud` 違い 401 / 正しい token 200 / 初回で users の行ができる / 他人のグループ 403 (既存のまま)
- 既存の E2E の `x-user-id` は全部 token の helper に置き換える

## mobile のサインイン (M-01)

v1.1.0 は Android と Google だけ (判断キュー Q-01)。Apple は #149。

### To-Be

- 起動時にセッションが無ければ M-01 (サインイン) を出す。「Google でサインイン」の 1 ボタンだけ
- ボタンでブラウザ (Custom Tabs) が開き、Google で選んだアカウントでそのままアプリに戻る。戻ったら一覧のタブを出す
- サインアウトは設定の 1 ボタン。mobile が push token を登録するようになったら (#128 の mobile 側)、サインアウトでは自分の push token を `DELETE /v1/push-tokens` で消してからセッションを消す (#133 の契約)。今はまだ登録していないので、セッションを消すだけ

### 流れ

- `@supabase/supabase-js` の `signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } })` で URL を得て、`expo-web-browser` の `openAuthSessionAsync(url, redirectTo)` で開く
- `flowType: "pkce"` にし、戻ってきた URL の `code` を `exchangeCodeForSession(code)` でセッションにする。URL に token を載せない (Redirect URLs の `exp://**` は Expo Go を指すので、届いた code は verifier を持つアプリでしか使えない形にしておく)
- `redirectTo` は `expo-linking` の `createURL("auth/callback")`。dev build と本番は `prep-hamster://auth/callback`、Expo Go は `exp://…/--/auth/callback` になる
- Supabase の Redirect URLs (設定済み): `prep-hamster://**`, `exp://**`

### セッションの保存

- Supabase の Expo の手順にある `LargeSecureStore` の形: セッションは AES で暗号化して AsyncStorage に置き、鍵だけを `expo-secure-store` に置く (secure-store は 1 値 2048 byte までで、セッションが入らない)
- `autoRefreshToken: true` / `persistSession: true` / `detectSessionInUrl: false`。`AppState` が active になったら `startAutoRefresh()`、裏に回ったら `stopAutoRefresh()`

### API への token

- `src/auth.ts` の `getAccessToken()` を、Supabase の現在のセッションの `access_token` を返す形に差し替える (非同期になるので、`getApiClient()` は呼ぶたびに token を取る形にする)
- `EXPO_PUBLIC_DEV_ACCESS_TOKEN` は消す
- 追加の env: `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable key は端末に配る前提の公開鍵)

### 追加する依存

- `@supabase/supabase-js`、`expo-web-browser`、`expo-secure-store`、`@react-native-async-storage/async-storage`、`aes-js`、`react-native-get-random-values` (Expo の公式手順と同じ組)。Expo の管理下のものは `npx expo install` で SDK 52 に合う版を入れる

### 確かめ方

- d1 には Android の SDK も端末も無いので、サインインの往復は手元の Android 端末 (Expo Go) で確かめる。API は d1 で `SUPABASE_URL` を Supabase の project に向けて LAN に出す
- 自動テストは、`getAccessToken()` がセッションの token を返すこと / 戻り URL の `code` の取り出し (code が無い・error 付きを含む) / セッションが無いとき M-01 に回す判定、を unit で押さえる
