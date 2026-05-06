# @prep-hamster/mobile

備蓄管理アプリのモバイルクライアント (Expo + Expo Router)。

## v1.0.0 の位置付け

最小スコープでカメラ読取 → 在庫追加までを成立させる MVP。

- 認証は `x-user-id` ヘッダ固定値 (Supabase Auth 本実装は v1.1.0)
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
EXPO_PUBLIC_STUB_USER_ID=<開発機ごとの UUID>
```

- `EXPO_PUBLIC_API_BASE_URL`: Expo Go / 実機からは LAN IP 必須（localhost は届かない）
  - iOS Simulator: `http://localhost:3000`
  - Android Emulator: `http://10.0.2.2:3000`
  - 実機 (Expo Go): 開発機の LAN IP
- `EXPO_PUBLIC_STUB_USER_ID`: API 側に seed 済みの user UUID。未設定時は `00000000-0000-0000-0000-000000000001` を fallback として送る

## v1.0.0 で動作確認するもの

- [x] iOS / Android Emulator / Expo Go で起動
- [x] `/health` 叩いて画面に「OK (HTTP 200)」表示

`bun --filter @prep-hamster/mobile typecheck` が CI で通ることが merge 条件。

## v1.1.0 以降の差し替えポイント

- `src/auth.ts` の `getCurrentUserId()` を Supabase Auth ベースに置換
- 残りの mobile コードは `getCurrentUserId()` 経由でのみ user id を参照しているので、
  この 1 ファイルの差し替えで Supabase Auth 移行が完了する想定
