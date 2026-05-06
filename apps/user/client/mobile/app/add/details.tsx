import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker"
import { router, useLocalSearchParams } from "expo-router"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { getApiClient } from "@/api"
import { getCurrentGroupId } from "@/config"

// 詳細入力 + 保存画面。
// 受け取る params:
//   - itemId       : POST /v1/items/by-barcode で確定した item の UUID
//   - productLookup: "existing" | "hit" | "miss"
//                     miss なら item.name を編集する UI を出す。
//
// 保存フロー:
//   1. (productLookup === miss && name 編集あり) PATCH /v1/items/:id
//   2. POST /v1/stocks
//   3. 成功で /(tabs) に replace し、一覧画面で最新化

type ItemDto = {
  id: string
  name: string
  manufacturer: string | null
}

type LocationDto = {
  id: string
  name: string
}

type LoadState =
  | { status: "loading" }
  | { status: "ok"; item: ItemDto; locations: LocationDto[] }
  | { status: "error"; message: string }

export default function AddDetailsScreen() {
  const params = useLocalSearchParams<{ itemId: string; productLookup: string }>()
  const itemId = params.itemId
  const productLookup = params.productLookup as "existing" | "hit" | "miss" | undefined

  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [name, setName] = useState("")
  const [locationId, setLocationId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [unit, setUnit] = useState("個")
  const [useByDate, setUseByDate] = useState<Date | null>(null)
  const [bestBeforeDate, setBestBeforeDate] = useState<Date | null>(null)
  const [note, setNote] = useState("")
  const [showUseBy, setShowUseBy] = useState(false)
  const [showBestBefore, setShowBestBefore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!itemId) return
    let cancelled = false
    void (async () => {
      try {
        const client = getApiClient()
        const groupId = getCurrentGroupId()
        const [itemRes, locsRes] = await Promise.all([
          client.v1.items[":id"].$get({ param: { id: itemId } }),
          client.v1.locations.$get({ query: { groupId } }),
        ])
        if (cancelled) return
        if (!itemRes.ok) {
          setLoad({ status: "error", message: `item HTTP ${itemRes.status}` })
          return
        }
        if (!locsRes.ok) {
          setLoad({ status: "error", message: `locations HTTP ${locsRes.status}` })
          return
        }
        const itemBody = (await itemRes.json()).item
        const locsBody = (await locsRes.json()).locations
        setName(itemBody.name)
        if (locsBody[0]) setLocationId(locsBody[0].id)
        setLoad({ status: "ok", item: itemBody, locations: locsBody })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "unknown"
        setLoad({ status: "error", message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [itemId])

  if (!itemId) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>itemId が指定されていません</Text>
      </View>
    )
  }
  if (load.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    )
  }
  if (load.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>取得失敗: {load.message}</Text>
      </View>
    )
  }

  const canEditName = productLookup === "miss"
  const groupId = getCurrentGroupId()

  async function onSave() {
    if (!locationId) {
      setSaveError("場所を選択してください")
      return
    }
    const parsedQty = Number(quantity)
    if (!Number.isFinite(parsedQty) || parsedQty < 0) {
      setSaveError("数量は 0 以上の数値で入力してください")
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const client = getApiClient()
      // miss の場合のみ name を更新する (hit / existing は外部 lookup or 既存値を尊重)
      if (canEditName && load.status === "ok" && name !== load.item.name) {
        const patchRes = await client.v1.items[":id"].$patch({
          param: { id: itemId },
          json: { name },
        })
        if (!patchRes.ok) {
          setSaveError(`item PATCH HTTP ${patchRes.status}`)
          setSaving(false)
          return
        }
      }
      const stockRes = await client.v1.stocks.$post({
        json: {
          groupId,
          itemId,
          locationId,
          quantity: parsedQty,
          unit,
          useByDate: useByDate ? toIsoDate(useByDate) : null,
          bestBeforeDate: bestBeforeDate ? toIsoDate(bestBeforeDate) : null,
          openedAt: null,
          note: note.length > 0 ? note : null,
        },
      })
      if (!stockRes.ok) {
        setSaveError(`stock POST HTTP ${stockRes.status}`)
        setSaving(false)
        return
      }
      // 一覧に戻ると useFocusEffect で reload される
      router.replace("/(tabs)")
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown"
      setSaveError(message)
      setSaving(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Section title={`商品 (${labelForLookup(productLookup)})`}>
        {canEditName ? (
          <TextInput value={name} onChangeText={setName} style={styles.input} />
        ) : (
          <Text style={styles.staticText}>{name}</Text>
        )}
      </Section>

      <Section title="保管場所">
        {load.locations.length === 0 ? (
          <Text style={styles.empty}>
            場所がまだありません。先に /v1/locations で作成してください。
          </Text>
        ) : (
          <View style={styles.choices}>
            {load.locations.map((loc) => (
              <Pressable
                key={loc.id}
                onPress={() => setLocationId(loc.id)}
                style={[styles.choice, locationId === loc.id && styles.choiceSelected]}
              >
                <Text
                  style={[styles.choiceLabel, locationId === loc.id && styles.choiceLabelSelected]}
                >
                  {loc.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </Section>

      <Section title="数量 / 単位">
        <View style={styles.row}>
          <TextInput
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            style={[styles.input, styles.qtyInput]}
          />
          <TextInput value={unit} onChangeText={setUnit} style={[styles.input, styles.unitInput]} />
        </View>
      </Section>

      <Section title="期限">
        <DateRow
          label="使用期限 (useByDate)"
          value={useByDate}
          show={showUseBy}
          setShow={setShowUseBy}
          setValue={setUseByDate}
        />
        <DateRow
          label="賞味期限 (bestBeforeDate)"
          value={bestBeforeDate}
          show={showBestBefore}
          setShow={setShowBestBefore}
          setValue={setBestBeforeDate}
        />
      </Section>

      <Section title="メモ (任意)">
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          style={[styles.input, styles.note]}
        />
      </Section>

      {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

      <Pressable
        style={[styles.primary, saving && styles.primaryDisabled]}
        onPress={onSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryLabel}>保存</Text>
        )}
      </Pressable>
    </ScrollView>
  )
}

function labelForLookup(lookup: string | undefined): string {
  switch (lookup) {
    case "existing":
      return "既存"
    case "hit":
      return "外部 hit"
    case "miss":
      return "未登録 (要編集)"
    default:
      return "?"
  }
}

function toIsoDate(d: Date): string {
  // YYYY-MM-DD のみ。ローカル日付として扱う。
  const yyyy = d.getFullYear().toString().padStart(4, "0")
  const mm = (d.getMonth() + 1).toString().padStart(2, "0")
  const dd = d.getDate().toString().padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function DateRow({
  label,
  value,
  show,
  setShow,
  setValue,
}: {
  label: string
  value: Date | null
  show: boolean
  setShow: (v: boolean) => void
  setValue: (d: Date | null) => void
}) {
  function onChange(_e: DateTimePickerEvent, selected: Date | undefined) {
    // Android はピッカーがモーダルなので選択 / 取消後に閉じる
    if (Platform.OS !== "ios") setShow(false)
    if (selected) setValue(selected)
  }

  return (
    <View style={styles.dateRow}>
      <Text style={styles.dateLabel}>{label}</Text>
      <View style={styles.dateControls}>
        <Pressable style={styles.dateButton} onPress={() => setShow(true)}>
          <Text style={styles.dateButtonText}>{value ? toIsoDate(value) : "選択"}</Text>
        </Pressable>
        {value ? (
          <Pressable style={styles.clearButton} onPress={() => setValue(null)}>
            <Text style={styles.clearButtonText}>クリア</Text>
          </Pressable>
        ) : null}
      </View>
      {show ? <DateTimePicker value={value ?? new Date()} mode="date" onChange={onChange} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#333" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  staticText: { fontSize: 15, paddingVertical: 8 },
  row: { flexDirection: "row", gap: 8 },
  qtyInput: { flex: 1 },
  unitInput: { width: 80 },
  note: { minHeight: 80, textAlignVertical: "top" },
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
  choiceLabelSelected: { color: "#fff", fontWeight: "600" },
  empty: { color: "#666", fontSize: 13 },
  error: { color: "#c0392b" },
  dateRow: { gap: 6 },
  dateLabel: { fontSize: 13, color: "#444" },
  dateControls: { flexDirection: "row", gap: 8, alignItems: "center" },
  dateButton: {
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 140,
    alignItems: "center",
  },
  dateButtonText: { fontSize: 14 },
  clearButton: { paddingHorizontal: 8, paddingVertical: 8 },
  clearButtonText: { color: "#888", fontSize: 13 },
  primary: {
    backgroundColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  primaryDisabled: { opacity: 0.5 },
  primaryLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
})
