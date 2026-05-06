import { useFocusEffect } from "expo-router"
import { useCallback } from "react"
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native"
import { useStocks, type StockListItem } from "@/use-stocks"

// 在庫一覧画面 (/(tabs)/index)。
// 追加画面 (#77) からの導線で「保存後に一覧に反映」を満たすためのシンプル表示。

export default function StocksIndex() {
  const { state, reload } = useStocks()

  // tab に戻ってくるたびに最新化したい (#77 の add fl ow からの帰還で表示更新)
  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload]),
  )

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    )
  }
  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>取得失敗: {state.message}</Text>
      </View>
    )
  }
  if (state.rows.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>在庫はまだありません</Text>
        <Text style={styles.empty}>「追加」タブから登録してください</Text>
      </View>
    )
  }

  return (
    <FlatList
      data={state.rows}
      keyExtractor={(row) => row.id}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      renderItem={({ item }) => <StockRow row={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  )
}

function StockRow({ row }: { row: StockListItem }) {
  const expiry = row.useByDate ?? row.bestBeforeDate
  return (
    <View style={styles.row}>
      <Text style={styles.itemName}>{row.itemName}</Text>
      <Text style={styles.meta}>
        {row.locationName} ・ {row.quantity} {row.unit}
        {expiry ? ` ・ 期限 ${expiry}` : ""}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 6 },
  empty: { color: "#666" },
  error: { color: "#c0392b" },
  listContent: { paddingVertical: 8 },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  itemName: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, color: "#555" },
  separator: { height: 1, backgroundColor: "#eee" },
})
