# @prep-hamster/mobile

備蓄管理アプリのモバイルクライアント (Expo + Expo Router)。

## v1.0.0 の位置付け

最小スコープでカメラ読取 → 在庫追加までを成立させる MVP。

- 認証は Supabase の Google サインイン (M-01)。API には現在のセッションの access token を `Authorization: Bearer` で送る
- 画面: 在庫一覧 placeholder + 追加導線 (#77 で本実装)
- API は `@prep-hamster/api-client` の `hc<AppType>` を経由

## ローカル起動

```sh
# repo root から
bun install

# API サーバを別タブで起動
bun --filter @prep-hamster/api dev

# モバイル dev server
bun --filter @prep-hamster/mobile dev
```

ターミナルに表示される QR を Expo Go で読むと実機で起動できる。
iOS Simulator なら `i`、Android Emulator なら `a` を押す。

## 環境変数

`.env.local` に以下を記述（コミットしない）。

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.y:3000
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase の publishable key>
```

- `EXPO_PUBLIC_API_BASE_URL`: Expo Go / 実機からは LAN IP 必須（localhost は届かない）
  - iOS Simulator: `http://localhost:3000`
  - Android Emulator: `http://10.0.2.2:3000`
  - 実機 (Expo Go): 開発機の LAN IP
- `EXPO_PUBLIC_SUPABASE_URL`: Supabase project の URL。未設定だとアプリは起動時に例外を投げる
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase の publishable key (端末に配る前提の公開鍵)。未設定だとアプリは起動時に例外を投げる

## v1.0.0 で動作確認するもの

- [x] iOS / Android Emulator / Expo Go で起動
- [x] `/health` 叩いて画面に「OK (HTTP 200)」表示

`bun --filter @prep-hamster/mobile typecheck` が CI で通ることが merge 条件。

## As-Is screen catalog (Maestro)

`docs/design/screens-as-is.md` に画面遷移図 + 各画面のキャプチャを集める。再生成手順:

```sh
# 1. Android emulator 起動 + adb で認識させる
emulator -avd <name>  # or Android Studio から起動
adb devices            # 1 台以上認識していること

# 2. app をビルド & インストール (初回 / app が無い時のみ)。Expo Go ではなく、
#    com.example.prephamster として入り prep-hamster:// を受ける debug build を作る
bun run --filter @prep-hamster/mobile android:build

# 3. flow を実行してキャプチャ取得
bun run --filter @prep-hamster/mobile capture
```

Maestro CLI のインストール:

```sh
curl -Ls "https://get.maestro.mobile.dev" | bash
# PATH に ~/.maestro/bin を追加
```

flow 定義は `apps/user/client/mobile/maestro/*.yaml`。新画面追加時はここに flow を増やす。

flow はサインイン済みで始める。Google の画面は Maestro では通れないので、`capture` は先に `scripts/dev-session.ts` で
テスト用ユーザー (`maestro@example.test`) の session を Supabase の Admin API で発行し、その deep link
(`prep-hamster://auth/dev-session?...`) を各 flow の先頭で開く。受け口は dev build (`__DEV__`) でだけ token を使う。
`capture` を流すシェルに `SUPABASE_URL` と `SUPABASE_SECRET_KEY` (Supabase の secret key。アプリには入れない) を渡す。
新しい flow も `launchApp` の直後に `- openLink: ${DEV_SESSION_URL}` を置く。
iOS / 実機・本物の barcode 読取は別 Issue で扱う (本仕組みは Android emulator 前提)。
