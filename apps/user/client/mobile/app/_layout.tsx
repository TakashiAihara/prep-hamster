import { Stack, useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { initialAuthStatus, redirectFor, type AuthStatus } from "@/auth"
import { supabase } from "@/supabase"

export default function RootLayout() {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    void initialAuthStatus().then(setStatus)
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
