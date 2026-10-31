// サインイン画面 (M-01) が入るまでの auth スタブ。
// Supabase のセッションに差し替えるときはこの 1 ファイルを置換する想定。
//
// 設計方針:
// - access token は env (EXPO_PUBLIC_DEV_ACCESS_TOKEN) の値を返すだけ。未設定なら空文字で、API は 401 を返す
// - モバイルコードは getAccessToken() からのみ token を取得し、直接 process.env を参照しない
export function getAccessToken(): string {
  return process.env.EXPO_PUBLIC_DEV_ACCESS_TOKEN ?? ""
}
