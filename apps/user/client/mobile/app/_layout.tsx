import { Stack, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { initialAuthStatus, redirectFor, type AuthStatus } from "@/auth"
import { supabase } from "@/supabase"

export default function RootLayout() {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    // 起動時の読み出しが遅いと、先に届いた onAuthStateChange (サインイン完了など) を古い結果で
    // 上書きしてしまう。まだ決まっていないときだけ採る。
    void initialAuthStatus().then((s) => setStatus((prev) => (prev === "loading" ? s : prev)))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? "signed-in" : "signed-out")
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const firstSegment: string | undefined = segments[0]
  useEffect(() => {
    const to = redirectFor(status, firstSegment)
    if (to) router.replace(to as never)
  }, [status, firstSegment, router])

  // セッションの有無が決まるまで画面を描かない。描くと一覧が token 無しで API を叩いて 401 を出す。
  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    )
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
      </Stack>
    </>
  )
}
