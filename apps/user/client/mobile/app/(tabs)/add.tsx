import { StyleSheet, Text, View } from "react-native"

// 在庫追加導線 placeholder。
// バーコードスキャン → 場所/期限入力の本実装は #77 で行う。

export default function AddStock() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>在庫追加 (bootstrap)</Text>
      <Text style={styles.subtitle}>バーコード読取 / 手動入力は #77 で実装予定</Text>
    </View>
  )
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
