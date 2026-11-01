import { Stack } from "expo-router"
import { AuthGate } from "@/auth-status"

// /add/* のサブスタック。タブの上に push されてヘッダ + 戻るが付く。
// root の Stack に直接ぶら下がるのでタブの AuthGate を通らない。深リンクで未サインインのまま開かれても
// サインイン画面へ回すよう、ここでも AuthGate を掛ける
export default function AddStackLayout() {
  return (
    <AuthGate area="app">
      <Stack>
        <Stack.Screen name="scan" options={{ title: "バーコードを読む" }} />
        <Stack.Screen name="manual" options={{ title: "手動入力" }} />
        <Stack.Screen name="details" options={{ title: "詳細を入力" }} />
      </Stack>
    </AuthGate>
  )
}
