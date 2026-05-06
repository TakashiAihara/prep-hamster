import { Stack } from "expo-router"

// /add/* のサブスタック。タブの上に push されてヘッダ + 戻るが付く。
export default function AddStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="scan" options={{ title: "バーコードを読む" }} />
      <Stack.Screen name="manual" options={{ title: "手動入力" }} />
      <Stack.Screen name="details" options={{ title: "詳細を入力" }} />
    </Stack>
  )
}
