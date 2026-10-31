import { Redirect } from "expo-router"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { ActivityIndicator, View } from "react-native"
import { gateFor, initialAuthStatus, type AuthStatus } from "./auth"

const AuthStatusContext = createContext<AuthStatus>("loading")

export function AuthStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading")

  useEffect(() => {
    let unsubscribe = () => {}
    const subscribe = async () => {
      const { supabase } = await import("./supabase")
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        setStatus(session ? "signed-in" : "signed-out")
      })
      unsubscribe = () => data.subscription.unsubscribe()
    }
    // supabase.ts の読み込み (env の検査) が落ちたらセッションは作れないので、サインアウト扱いにする。
    subscribe().catch(() => setStatus("signed-out"))
    // 起動時の読み出しが遅いと、先に届いた onAuthStateChange (サインイン完了など) を古い結果で
    // 上書きしてしまう。まだ決まっていないときだけ採る。
    void initialAuthStatus().then((s) => setStatus((prev) => (prev === "loading" ? s : prev)))
    return () => unsubscribe()
  }, [])

  return <AuthStatusContext.Provider value={status}>{children}</AuthStatusContext.Provider>
}

export const useAuthStatus = () => useContext(AuthStatusContext)

// gateFor の結果どおりに、中身を描くか、待つ (spinner) か、別の画面に移す。
export function AuthGate({ area, children }: { area: "app" | "sign-in"; children: ReactNode }) {
  const gate = gateFor(useAuthStatus(), area)
  if (gate.render) return <>{children}</>
  if (gate.redirect) return <Redirect href={gate.redirect as never} />
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  )
}
