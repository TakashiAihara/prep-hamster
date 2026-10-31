import { Redirect, useLocalSearchParams } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { exchangeAuthCodeOnce } from "@/auth"

// OAuth の戻り URL (prep-hamster://auth/callback?code=...) の受け皿。ふだんの交換は signInWithGoogle() が
// 行うが、ブラウザにいる間にアプリが OS に終了させられると、戻ってきた code を受け取れるのはこの画面だけ。
export default function AuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>()
  const [done, setDone] = useState(!code)

  useEffect(() => {
    if (!code) return
    // 失敗してもここでは出さない。セッションが無ければ AuthGate がサインイン画面に戻す。
    exchangeAuthCodeOnce(code)
      .catch(() => undefined)
      .finally(() => setDone(true))
  }, [code])

  if (done) return <Redirect href="/" />
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  )
}
