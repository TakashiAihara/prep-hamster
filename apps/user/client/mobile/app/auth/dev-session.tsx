import { Redirect, useLocalSearchParams } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, Text, View } from "react-native"
import { acceptsDevSession, devSessionFromParams } from "@/dev-session"

// dev build だけの受け口: prep-hamster://auth/dev-session?access_token=...&refresh_token=...
// 本番の build では token を読まずに一覧へ戻す (AuthGate が未サインインならサインイン画面に回す)。
export default function DevSession() {
  const params = useLocalSearchParams<{ access_token?: string; refresh_token?: string }>()
  const session = acceptsDevSession(__DEV__) ? devSessionFromParams(params) : null
  const [done, setDone] = useState(!session)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    void (async () => {
      const { supabase } = await import("@/supabase")
      const { error } = await supabase.auth.setSession({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
      })
      if (error) throw error
    })()
      .then(() => setDone(true))
      // 一覧へ進めずに理由を出す。Maestro の flow はサインイン後の画面を待つので、ここで止まって落ちる
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
    // session は params から作り直されるので、token の値が変わったときだけ走らせる
  }, [session?.accessToken, session?.refreshToken])

  if (done) return <Redirect href="/" />
  if (failure) return <Text style={{ padding: 16 }}>dev session failed: {failure}</Text>
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  )
}
