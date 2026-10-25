import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { useCallback, useReducer, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { getApiClient } from "@/api"
import {
  formatQuantity,
  loadStockDetail,
  moveTargets,
  shouldSuggestShopping,
  type StockDetail,
  type StockDto,
} from "@/stock-detail"
import { createConfirmDiscard, leaveDetail, loadReducer } from "@/stock-detail-controller"
import { useStockActions } from "@/use-stock-actions"

// 在庫詳細画面 (M-05)。消費 / 廃棄 / 移動 / 編集を 1 画面にまとめる。
// 消費 / 廃棄で残量が残れば一覧へ戻り、0 になったら留まって買い物リスト追加の提案を表示する
// (screen-flow 2.3.2。表示のみ。買い物リスト本体は v1.2.0)。
// 移動 / 編集は画面に留まり、最新の stock で表示を差し替える。

export default function StockDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [load, dispatch] = useReducer(loadReducer, { status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)

  // focus のたびに取り直す (他のメンバーが変えた在庫を古いまま操作しない)。再試行は reloadKey で再実行する
  useFocusEffect(
    useCallback(() => {
      if (!id) return
      let cancelled = false
      dispatch({ type: "start", id })
      void (async () => {
        const r = await loadStockDetail(getApiClient(), id)
        if (cancelled) return
        dispatch(
          r.ok ? { type: "loaded", detail: r.detail } : { type: "failed", message: r.message },
        )
      })()
      return () => {
        cancelled = true
      }
    }, [id, reloadKey]),
  )

  const onStockChanged = useCallback(
    (stock: StockDto) => dispatch({ type: "stock-changed", stock }),
    [],
  )

  if (!id) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>id が指定されていません</Text>
      </View>
    )
  }
  if (load.status === "loading") {
    return (
      <View style={styles.center} testID="detail-loading">
        <ActivityIndicator />
      </View>
    )
  }
  if (load.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error} testID="detail-load-error">
          取得失敗: {load.message}
        </Text>
        <Pressable
          testID="detail-retry"
          accessibilityRole="button"
          style={styles.retry}
          onPress={() => setReloadKey((n) => n + 1)}
        >
          <Text style={styles.primaryLabel}>再試行</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <DetailBody key={load.detail.stock.id} detail={load.detail} onStockChanged={onStockChanged} />
  )
}

const confirmDiscard = createConfirmDiscard({
  os: Platform.OS,
  webConfirm: (message) => window.confirm(message),
  alert: Alert.alert,
})

function DetailBody({
  detail,
  onStockChanged,
}: {
  detail: StockDetail
  onStockChanged: (stock: StockDto) => void
}) {
  const { stock, itemName, locations } = detail
  const [amount, setAmount] = useState("1")
  const [reason, setReason] = useState("")
  const [targetId, setTargetId] = useState<string | null>(null)
  const [useBy, setUseBy] = useState(stock.useByDate ?? "")
  const [bestBefore, setBestBefore] = useState(stock.bestBeforeDate ?? "")
  const [note, setNote] = useState(stock.note ?? "")
  const { busy, message, consume, discard, move, edit } = useStockActions({
    stock,
    onStockChanged,
    onMoved: () => setTargetId(null),
    confirmDiscard,
    leave: () => leaveDetail(router),
  })

  const empty = shouldSuggestShopping(stock.quantity)
  const currentLocation = locations.find((l) => l.id === stock.locationId)?.name ?? "(unknown)"
  const targets = moveTargets(locations, stock.locationId)
  const targetName = targets.find((l) => l.id === targetId)?.name

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.section}>
        <Text style={styles.title} testID="detail-item-name">
          {itemName}
        </Text>
        <Text style={styles.meta} testID="detail-location">
          {currentLocation}
        </Text>
        <Text style={styles.quantity} testID="detail-quantity">
          {formatQuantity(stock.quantity)} {stock.unit}
        </Text>
      </View>

      {message ? (
        <Text
          style={message.kind === "ok" ? styles.ok : styles.error}
          testID={message.kind === "ok" ? "detail-message" : "detail-error"}
        >
          {message.text}
        </Text>
      ) : null}

      {empty ? (
        <View style={styles.suggestion} testID="detail-shopping-suggestion">
          <Text style={styles.suggestionText}>
            在庫がなくなりました。買い物リストに追加しますか？
          </Text>
          <Text style={styles.suggestionNote}>(買い物リストは v1.2.0 で提供予定です)</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>消費 / 廃棄</Text>
        <TextInput
          testID="detail-amount-input"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          style={styles.input}
          placeholder="数量"
        />
        <TextInput
          testID="detail-reason-input"
          value={reason}
          onChangeText={setReason}
          style={styles.input}
          placeholder="廃棄理由 (任意)"
        />
        <View style={styles.row}>
          <Pressable
            testID="detail-consume"
            accessibilityRole="button"
            style={[styles.primary, (busy || empty) && styles.disabled]}
            onPress={() => void consume(amount)}
            disabled={busy || empty}
          >
            <Text style={styles.primaryLabel}>消費</Text>
          </Pressable>
          <Pressable
            testID="detail-discard"
            accessibilityRole="button"
            style={[styles.danger, (busy || empty) && styles.disabled]}
            onPress={() => void discard(amount, reason)}
            disabled={busy || empty}
          >
            <Text style={styles.primaryLabel}>廃棄</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>移動</Text>
        {targets.length === 0 ? (
          <Text style={styles.meta}>移動先の保管場所がありません</Text>
        ) : (
          <View style={styles.choices}>
            {targets.map((loc) => (
              <Pressable
                key={loc.id}
                testID={`detail-move-target-${loc.id}`}
                accessibilityRole="button"
                onPress={() => setTargetId(loc.id)}
                style={[styles.choice, targetId === loc.id && styles.choiceSelected]}
              >
                <Text
                  style={[styles.choiceLabel, targetId === loc.id && styles.choiceSelectedLabel]}
                >
                  {loc.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {targetName ? (
          <Text style={styles.meta} testID="detail-move-selected-name">
            {targetName}
          </Text>
        ) : null}
        <Pressable
          testID="detail-move"
          accessibilityRole="button"
          style={[styles.primary, (busy || targets.length === 0) && styles.disabled]}
          onPress={() => void move(targetId)}
          disabled={busy || targets.length === 0}
        >
          <Text style={styles.primaryLabel}>移動</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>編集</Text>
        <TextInput
          testID="detail-use-by-input"
          value={useBy}
          onChangeText={setUseBy}
          style={styles.input}
          keyboardType="numbers-and-punctuation"
          placeholder="使用期限 YYYY-MM-DD"
        />
        <TextInput
          testID="detail-best-before-input"
          value={bestBefore}
          onChangeText={setBestBefore}
          style={styles.input}
          keyboardType="numbers-and-punctuation"
          placeholder="賞味期限 YYYY-MM-DD"
        />
        <TextInput
          testID="detail-note-input"
          value={note}
          onChangeText={setNote}
          multiline
          style={[styles.input, styles.note]}
          placeholder="備考"
        />
        <Pressable
          testID="detail-edit-save"
          accessibilityRole="button"
          style={[styles.primary, busy && styles.disabled]}
          onPress={() => void edit({ useByDate: useBy, bestBeforeDate: bestBefore, note })}
          disabled={busy}
        >
          <Text style={styles.primaryLabel}>保存</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#333" },
  title: { fontSize: 20, fontWeight: "700" },
  meta: { fontSize: 13, color: "#555" },
  quantity: { fontSize: 28, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  note: { minHeight: 70, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: 8 },
  primary: {
    flex: 1,
    backgroundColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  danger: {
    flex: 1,
    backgroundColor: "#c0392b",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  retry: {
    marginTop: 12,
    backgroundColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  disabled: { opacity: 0.4 },
  primaryLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#aaa",
  },
  choiceSelected: { backgroundColor: "#2c7be5", borderColor: "#2c7be5" },
  choiceLabel: { fontSize: 13, color: "#333" },
  choiceSelectedLabel: { color: "#fff", fontWeight: "600" },
  suggestion: { backgroundColor: "#fff4d6", borderRadius: 8, padding: 12, gap: 4 },
  suggestionText: { fontSize: 14, fontWeight: "600" },
  suggestionNote: { fontSize: 12, color: "#666" },
  ok: { color: "#1e8449" },
  error: { color: "#c0392b" },
})
