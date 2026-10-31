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
- `iss` は `<SUPABASE_URL>/auth/v1`、`aud` は `authenticated`
- 検証は hono の `verifyWithJwks` (追加の依存なし)。JWKS は `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` から取り、10 分持つ。手持ちの鍵に無い `kid` が来たら取り直す (鍵の入れ替えに追従する)。ただし直前の取得から 1 分以内なら取り直さない (でたらめな `kid` で Supabase への取得を増やされないため)

### 設定

- `createApp` は `auth` を必須で受ける: 公開鍵の取得関数・`issuer`・`audience`
- 起動口 (`src/index.ts`) は env `SUPABASE_URL` から組み立てる。無ければ起動しない

### users の行

- 検証が通ったら `users` に `(id = sub, email = token の email, display_name = email の @ より前)` を `on conflict do nothing` で入れる
- 同じ email の別 id の行が既にあると入らない。その場合は今までどおり各 route が 404 を返す (seed で作った開発用の行と衝突したときに起きる。本番には無い)
- token に email が無い (匿名サインインなど) → 401

## クライアント

- `@prep-hamster/api-client` の `userId` を `accessToken` に置き換え、`Authorization` ヘッダで送る
- CLI は env `PREP_HAMSTER_ACCESS_TOKEN` を読む (`PREP_HAMSTER_USER_ID` の置き換え)。login コマンドは別 PR
- mobile は `src/auth.ts` の `getCurrentUserId()` を `getAccessToken()` に置き換え、当面は env `EXPO_PUBLIC_DEV_ACCESS_TOKEN` を返す。サインイン画面 (M-01) を入れる PR でこの 1 ファイルを Supabase のセッションに差し替える

## テスト

- E2E は ES256 の鍵の組をテストの中で作り、公開鍵を `createApp` の `auth` に渡す。token は helper で発行する
- 受け入れ: token なし 401 / 署名の違う token 401 / 期限切れ 401 / `iss` 違い 401 / `aud` 違い 401 / 正しい token 200 / 初回で users の行ができる / 他人のグループ 403 (既存のまま)
- 既存の E2E の `x-user-id` は全部 token の helper に置き換える
