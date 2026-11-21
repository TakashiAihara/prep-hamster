import { router, useFocusEffect } from "expo-router"
import { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useCurrentGroup } from "@/current-group"
import { formatQuantity } from "@/stock-detail"
import { isExpired, todayUtc, type StockListItem } from "@/stock-join"
import {
  EMPTY_STOCK_FILTER,
  filterStockRows,
  sortStockRowsByExpiry,
  stockFilterOptions,
  type StockFilterOption,
  type StockListFilter,
} from "@/stock-filter"
import { useStocks } from "@/use-stocks"

// 在庫一覧画面 (/(tabs)/index)。
// 追加画面 (#77) からの導線で「保存後に一覧に反映」を満たすためのシンプル表示。
// 絞り込み・検索・期限順は join 済みの行に対して端末側で行う (src/stock-filter.ts)。

export default function StocksIndex() {
  // グループを切り替えたら絞り込み条件を持ち越さない (別グループの id では何にも当たらない)
  const groupId = useCurrentGroup().group?.id ?? ""
  return <StocksList key={groupId} />
}

function StocksList() {
  const { state, reload } = useStocks()
  const [filter, setFilter] = useState<StockListFilter>(EMPTY_STOCK_FILTER)

  // tab に戻ってくるたびに最新化したい (#77 の add fl ow からの帰還で表示更新)
  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload]),
  )

  const rows = state.status === "ok" ? state.rows : []
  const options = useMemo(() => stockFilterOptions(rows), [rows])
  // 選択中の id が今の行に無い (その場所・カテゴリの在庫が全部無くなった等) ときは絞り込みを効かせない。
  // そのまま id で絞ると「条件に合う在庫がありません」が出続け、選択を戻すチップも無い
  const effectiveFilter = useMemo<StockListFilter>(
    () => ({
      categoryId:
        filter.categoryId !== null && options.categories.some((o) => o.id === filter.categoryId)
          ? filter.categoryId
          : null,
      locationId:
        filter.locationId !== null && options.locations.some((o) => o.id === filter.locationId)
          ? filter.locationId
          : null,
      query: filter.query,
    }),
    [filter, options],
  )
  const visibleRows = useMemo(
    () => sortStockRowsByExpiry(filterStockRows(rows, effectiveFilter)),
    [rows, effectiveFilter],
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
      <View style={styles.center} testID="stock-list-empty">
        <Text style={styles.empty}>在庫はまだありません</Text>
        <Text style={styles.empty}>「追加」タブから登録してください</Text>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        <TextInput
          testID="stock-search-input"
          value={filter.query}
          onChangeText={(query) => setFilter({ ...filter, query })}
          placeholder="品名で検索"
          style={styles.searchInput}
        />
        <FilterChipRow
          label="カテゴリ"
          testIDPrefix="stock-filter-category"
          options={options.categories}
          selectedId={effectiveFilter.categoryId}
          onSelect={(categoryId) => setFilter({ ...filter, categoryId })}
        />
        <FilterChipRow
          label="保管場所"
          testIDPrefix="stock-filter-location"
          options={options.locations}
          selectedId={effectiveFilter.locationId}
          onSelect={(locationId) => setFilter({ ...filter, locationId })}
        />
      </View>
      {visibleRows.length === 0 ? (
        <View style={styles.center} testID="stock-list-no-match">
          <Text style={styles.empty}>条件に合う在庫がありません</Text>
        </View>
      ) : (
        <FlatList
          testID="stock-list"
          data={visibleRows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
          renderItem={({ item }) => <StockRow row={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          // Maestro の flow が一覧の末尾まで送ったことを確かめる目印
          ListFooterComponent={<View testID="stock-list-end" style={styles.listEnd} />}
        />
      )}
    </View>
  )
}

function FilterChipRow({
  label,
  testIDPrefix,
  options,
  selectedId,
  onSelect,
}: {
  label: string
  testIDPrefix: string
  options: StockFilterOption[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.choices}>
        <Pressable
          testID={`${testIDPrefix}-all`}
          accessibilityRole="button"
          style={[styles.choice, selectedId === null && styles.choiceSelected]}
          onPress={() => onSelect(null)}
        >
          <Text style={[styles.choiceLabel, selectedId === null && styles.choiceLabelSelected]}>
            すべて
          </Text>
        </Pressable>
        {options.map((option) => (
          <Pressable
            key={option.id}
            testID={`${testIDPrefix}-${option.id}`}
            accessibilityRole="button"
            style={[styles.choice, selectedId === option.id && styles.choiceSelected]}
            onPress={() => onSelect(option.id)}
          >
            <Text
              style={[styles.choiceLabel, selectedId === option.id && styles.choiceLabelSelected]}
            >
              {option.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function StockRow({ row }: { row: StockListItem }) {
  const expiry = row.useByDate ?? row.bestBeforeDate
  const expired = isExpired(row, todayUtc())
  return (
    <Pressable
      testID={`stock-row-${row.id}`}
      accessibilityRole="button"
      style={styles.row}
      onPress={() => router.push({ pathname: "/stocks/[id]", params: { id: row.id } })}
    >
      <Text style={styles.itemName}>{row.itemName}</Text>
      <Text style={styles.meta}>
        {row.locationName} ・ {formatQuantity(row.quantity)} {row.unit}
        {expiry ? ` ・ 期限 ${expiry}` : ""}
        {expired ? " ・ 期限切れ" : ""}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  filterGroup: { gap: 4 },
  filterLabel: { fontSize: 12, color: "#666" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  choice: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#aaa",
  },
  choiceSelected: { backgroundColor: "#2c7be5", borderColor: "#2c7be5" },
  choiceLabel: { fontSize: 12, color: "#333" },
  choiceLabelSelected: { color: "#fff", fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 6 },
  empty: { color: "#666" },
  error: { color: "#c0392b" },
  listContent: { paddingVertical: 8 },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  itemName: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13, color: "#555" },
  separator: { height: 1, backgroundColor: "#eee" },
  // 高さ 0 の View は UI 階層に出ず、Maestro が見つけられない (高さ 1 なら出る。2026-11-09 実測)
  listEnd: { height: 1 },
})
