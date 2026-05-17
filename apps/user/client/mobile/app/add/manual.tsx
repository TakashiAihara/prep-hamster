import { router } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { useByBarcode } from "@/use-by-barcode"

// Simulator やカメラが使えない開発環境向けの debug 入口。
// scan.tsx と同じ後続フロー (詳細画面 → 保存) に乗せる。

export default function ManualBarcodeScreen() {
  const [barcode, setBarcode] = useState("")
  const { state, submit } = useByBarcode()

  async function onSubmit() {
    if (!barcode) return
    const result = await submit(barcode)
    if (result) {
      router.replace({
        pathname: "/add/details",
        params: { itemId: result.itemId, productLookup: result.productLookup },
      })
    }
  }

  const submitting = state.status === "loading"

  return (
    <View style={styles.container}>
      <Text style={styles.label}>JAN コード (EAN-13 / EAN-8)</Text>
      <TextInput
        testID="input"
        value={barcode}
        onChangeText={setBarcode}
        keyboardType="number-pad"
        placeholder="4901234567894"
        style={styles.input}
        editable={!submitting}
      />
      {state.status === "error" ? <Text style={styles.error}>{state.message}</Text> : null}
      <Pressable
        style={[styles.primary, (!barcode || submitting) && styles.primaryDisabled]}
        onPress={onSubmit}
        disabled={!barcode || submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryLabel}>送信</Text>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  label: { fontSize: 14, color: "#444" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: { color: "#c0392b" },
  primary: {
    backgroundColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryDisabled: { opacity: 0.5 },
  primaryLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
})
