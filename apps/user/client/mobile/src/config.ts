// v1.0.0 のスタブ設定。
// 認証は #76 の auth.ts に分離。ここでは認証以外の「現在のコンテキスト」値
// (groupId 等) を集約する。Supabase Auth + group switcher 実装時にこの 1 箇所を
// 置き換えれば足りるよう interface を絞る。

const FALLBACK_GROUP_ID = "00000000-0000-0000-0000-000000000010"

// API 側に seed しておいた group の UUID を env で渡す。未設定時は fallback。
export function getCurrentGroupId(): string {
  return process.env.EXPO_PUBLIC_STUB_GROUP_ID ?? FALLBACK_GROUP_ID
}
