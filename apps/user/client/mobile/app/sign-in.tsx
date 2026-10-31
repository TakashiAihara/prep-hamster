import { useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native"
import { signInWithGoogle } from "@/auth"
import { AuthGate } from "@/auth-status"

// M-01 サインイン。セッションができると AuthGate が一覧のタブに移す。

export default function SignInScreen() {
  return (
    <AuthGate area="sign-in">
      <SignIn />
    </AuthGate>
  )
}

function SignIn() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onPress = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown")
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.primary} onPress={onPress} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryLabel}>Google でサインイン</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>サインイン失敗: {error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
  primary: {
    backgroundColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c0392b" },
})
