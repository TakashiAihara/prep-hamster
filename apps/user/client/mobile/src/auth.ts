// v1.0.0 の auth スタブ。
// Supabase Auth を入れるのは v1.1.0 以降。差し替え時はこの 1 ファイルを置換する想定。
//
// 設計方針:
// - x-user-id は固定値 (env: EXPO_PUBLIC_STUB_USER_ID) を返すだけ
// - 将来 token / refresh / sign-out が要るなら、この interface を拡張して
//   ApiClient ファクトリに渡しているところだけ差し替える
//
//   後で Supabase Auth に差し替える際の注入ポイントを 1 箇所に集約するため、
//   モバイルコードは getCurrentUserId() / useCurrentUserId() からのみ
//   userId を取得する想定。直接 process.env を参照しない。

const FALLBACK_USER_ID = "00000000-0000-0000-0000-000000000001"

// process.env.EXPO_PUBLIC_STUB_USER_ID が設定されていればそれ、無ければ FALLBACK。
// 開発機ごとに別 user として動かしたい場合は .env で上書きする。
export function getCurrentUserId(): string {
  return process.env.EXPO_PUBLIC_STUB_USER_ID ?? FALLBACK_USER_ID
}
