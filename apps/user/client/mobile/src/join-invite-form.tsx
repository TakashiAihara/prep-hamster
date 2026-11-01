import { useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { useCurrentGroup } from "./current-group"

// M-10 と「グループを作る」画面で同じものを使う。
export function JoinInviteForm({ onJoined }: { onJoined?: () => void }) {
  const { join } = useCurrentGroup()
  const [text, setText] = useState("")
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    setJoining(true)
    setError(null)
    try {
      const result = await join(text)
      // 一覧を取り直している最中は、画面ごと入口へ戻るので何も出さない
      if (result === "joined") {
        setText("")
        onJoined?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown")
    } finally {
      setJoining(false)
    }
  }

  const disabled = text.trim().length === 0 || joining

  return (
    <View style={styles.form}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="招待コードを貼り付け"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!joining}
        style={styles.input}
      />
      <Pressable
        style={[styles.primary, disabled && styles.primaryDisabled]}
        onPress={onSubmit}
        disabled={disabled}
      >
        {joining ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryLabel}>参加する</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  primary: {
    backgroundColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryDisabled: { opacity: 0.5 },
  primaryLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c0392b" },
})
