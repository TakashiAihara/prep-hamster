import { StyleSheet, Text, View } from "react-native"
import { useHealth } from "@/use-health"

// 在庫一覧 placeholder。
// 本実装は別 Issue (#77 + 後続) で stocks endpoint を叩いて表示する。
// bootstrap (#76) の段階では /v1/health の結果を出して API 疎通を確認するだけ。

export default function StocksIndex() {
  const health = useHealth()

  return (
    <View style={styles.container}>
      <Text style={styles.title}>在庫一覧 (bootstrap)</Text>
      <Text style={styles.subtitle}>API 疎通: {renderHealth(health)}</Text>
    </View>
  )
}

function renderHealth(health: ReturnType<typeof useHealth>): string {
  switch (health.status) {
    case "loading":
      return "確認中..."
    case "ok":
      return `OK (HTTP ${health.httpStatus})`
    case "error":
      return `NG (${health.message})`
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  title: { fontSize: 20, fontWeight: "600" },
  subtitle: { fontSize: 14, color: "#555" },
})
