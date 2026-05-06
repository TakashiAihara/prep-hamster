import { router } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

// 在庫追加のエントリポイント。
// カメラ起動 / 手動入力 (debug) のいずれかへ進む。
// 実機では基本カメラ、Simulator やテストでは手動入力で同じ後続フローに乗せる。

export default function AddEntry() {
  return (
    <View style={styles.container}>
      <Pressable style={styles.primary} onPress={() => router.push("/add/scan")}>
        <Text style={styles.primaryLabel}>カメラで読み取る</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.push("/add/manual")}>
        <Text style={styles.secondaryLabel}>手動で barcode を入力 (debug)</Text>
      </Pressable>
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
  secondary: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#aaa",
  },
  secondaryLabel: { color: "#333", fontSize: 14 },
})
