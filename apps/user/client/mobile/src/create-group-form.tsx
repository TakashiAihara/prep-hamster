import { useRef, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { useCurrentGroup } from "./current-group"

// 「グループを作る」画面と M-10 の「新しいグループを作る」で同じものを使う。
export function CreateGroupForm({ onCreated }: { onCreated?: () => void }) {
  const { create, busy } = useCurrentGroup()
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()

  // state の saving は次の描画まで反映されないので、改行キーの連打で同じグループを 2 つ作らない
  const inFlight = useRef(false)

  async function onSubmit() {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await create(trimmed)
      setName("")
      if (result === "selected") onCreated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  // 他のフォームの作成・参加を待っている間も押させない (選択の競合を起こさない)
  const disabled = trimmed.length === 0 || saving || busy

  return (
    <View style={styles.form}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="グループ名"
        maxLength={100}
        editable={!saving}
        // 確定キーで送れるようにし、キーボードの下のボタンに届かなくても作れるようにする
        returnKeyType="done"
        onSubmitEditing={() => {
          if (!disabled) onSubmit()
        }}
        style={styles.input}
      />
      <Pressable
        style={[styles.primary, disabled && styles.primaryDisabled]}
        onPress={onSubmit}
        disabled={disabled}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryLabel}>グループを作る</Text>
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
