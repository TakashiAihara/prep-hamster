import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { AuthStatusProvider } from "@/auth-status"

// サインインの有無での出し分けは各グループの layout (タブ / サインイン画面) が持つ。
// ここは navigator を常に描く (描かないうちに遷移すると expo-router が落ちる)。
export default function RootLayout() {
  return (
    <AuthStatusProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
      </Stack>
    </AuthStatusProvider>
  )
}
