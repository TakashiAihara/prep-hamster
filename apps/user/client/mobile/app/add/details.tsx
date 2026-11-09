import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker"
import { router, useLocalSearchParams } from "expo-router"
import { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { getApiClient } from "@/api"
import { useCurrentGroup } from "@/current-group"
import { KeyboardScrollView } from "@/keyboard-scroll-view"
import { appendCreatedLocation, createLocation, parseLocationName } from "@/location-create"
import { parsePositive } from "@/stock-detail"

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
  | { status: "ok"; item: ItemDto; locations: LocationDto[]; groupId: string }
  | { status: "error"; message: string }

export default function AddDetailsScreen() {
  const params = useLocalSearchParams<{ itemId: string; productLookup: string }>()
  const itemId = params.itemId
  const productLookup = params.productLookup as "existing" | "hit" | "miss" | undefined
  const groupId = useCurrentGroup().group?.id

  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [name, setName] = useState("")
  // グループ切替の読み直しで、利用者が打った名前を item の名前で上書きしない
  const nameSetFor = useRef<string | null>(null)
  // 場所追加の応答が返る頃には一覧が別グループのものかもしれないので、現在のグループを覚えておく
  const currentGroupRef = useRef<string | null>(null)
  // Pressable の disabled は再描画まで効かないので、同じフレームの 2 回目を同期フラグで止める
  const addingRef = useRef(false)
  // GET が作成を追い越して一覧に無いまま返ることがあるので、作成した場所をグループごとに覚えておく
  const createdLocationsRef = useRef<Record<string, { id: string; name: string }[]>>({})
  // 読み直し後に選択を戻すため、直近に作成した場所を覚えておく
  const lastCreatedRef = useRef<{ groupId: string; id: string } | null>(null)
  // 場所追加の応答時に一覧へ反映できるか (load が ok か) を見るための最新の load
  const loadRef = useRef(load)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [locationName, setLocationName] = useState("")
  const [locationError, setLocationError] = useState<string | null>(null)
  const [addingLocation, setAddingLocation] = useState(false)
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
    const nextGroupId = groupId ?? null
    if (currentGroupRef.current !== nextGroupId) {
      // 別グループに切り替わったので、前のグループ向けに入力中の名前と表示中のエラーは消す
      setLocationName("")
      setLocationError(null)
    }
    currentGroupRef.current = nextGroupId
    if (!itemId) return
    if (!groupId) {
      setLoad({ status: "error", message: "グループが選ばれていません" })
      return
    }
    let cancelled = false
    // グループが変わったら前のグループの場所を出したままにしない
    setLoad({ status: "loading" })
    void (async () => {
      try {
        const client = getApiClient()
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
        if (nameSetFor.current !== itemId) {
          nameSetFor.current = itemId
          setName(itemBody.name)
        }
        // GET が作成を追い越して一覧に無いまま返ることがあるので、作成済みの場所を足してから出す
        const merged = (createdLocationsRef.current[groupId] ?? []).reduce(
          (acc, loc) => appendCreatedLocation(acc, groupId, loc) ?? acc,
          { groupId, locations: locsBody },
        )
        // 場所が 0 件のグループでは、前のグループの場所を残さない。
        // 直前に作った場所が一覧にあればそれを選ぶ
        const lastCreated = lastCreatedRef.current
        setLocationId(
          lastCreated !== null &&
            lastCreated.groupId === groupId &&
            merged.locations.some((l) => l.id === lastCreated.id)
            ? lastCreated.id
            : (merged.locations[0]?.id ?? null),
        )
        setLoad({ status: "ok", item: itemBody, locations: merged.locations, groupId })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "unknown"
        setLoad({ status: "error", message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [itemId, groupId])

  useEffect(() => {
    loadRef.current = load
  })

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

  async function onSave() {
    // 送るのは場所を読んだときのグループ。読み直しの途中に切り替わっても、別グループの場所と混ぜない
    const loadedGroupId = load.status === "ok" ? load.groupId : null
    if (!loadedGroupId) {
      setSaveError("グループが選ばれていません")
      return
    }
    if (!locationId) {
      setSaveError("場所を選択してください")
      return
    }
    // 数量 0 の在庫は一覧から隠れて見えなくなるので登録させない
    const qty = parsePositive(quantity)
    if (!qty.ok) {
      setSaveError(qty.message)
      return
    }
    const parsedQty = qty.value
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
          groupId: loadedGroupId,
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

  async function onAddLocation() {
    if (addingRef.current) return
    const parsed = parseLocationName(locationName)
    if (!parsed.ok) {
      setLocationError(parsed.message)
      return
    }
    if (load.status !== "ok") return
    // 場所を読んだグループに作る。読み直しの途中で現在のグループが変わっても、別グループには作らない
    const submittedGroupId = load.groupId
    addingRef.current = true
    setAddingLocation(true)
    setLocationError(null)
    try {
      const result = await createLocation(getApiClient(), submittedGroupId, parsed.value)
      // 追加中に別グループへ切り替わっていたら、成功・失敗どちらの結果も今の画面には関係ない
      if (currentGroupRef.current !== submittedGroupId) return
      if (!result.ok) {
        setLocationError(result.message)
        return
      }
      const createdList = (createdLocationsRef.current[submittedGroupId] ??= [])
      createdList.push(result.location)
      lastCreatedRef.current = { groupId: submittedGroupId, id: result.location.id }
      setLoad((prev) =>
        prev.status === "ok"
          ? (appendCreatedLocation(prev, submittedGroupId, result.location) ?? prev)
          : prev,
      )
      // load が ok でなければ一覧にまだ無いので、選択は GET 後に lastCreatedRef 経由で行う
      const currentLoad = loadRef.current
      if (currentLoad.status === "ok" && currentLoad.groupId === submittedGroupId) {
        setLocationId(result.location.id)
      }
      setLocationName("")
      setLocationError(null)
    } finally {
      addingRef.current = false
      setAddingLocation(false)
    }
  }

  return (
    <KeyboardScrollView contentContainerStyle={styles.container}>
      <Section title={`商品 (${labelForLookup(productLookup)})`}>
        {canEditName ? (
          <TextInput
            testID="add-name-input"
            value={name}
            onChangeText={setName}
            style={styles.input}
          />
        ) : (
          <Text style={styles.staticText}>{name}</Text>
        )}
      </Section>

      <Section title="保管場所">
        {load.locations.length === 0 ? (
          <Text style={styles.empty}>場所がまだありません。下で追加してください。</Text>
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
        <View style={styles.row}>
          <TextInput
            testID="add-location-input"
            value={locationName}
            onChangeText={setLocationName}
            placeholder="新しい場所の名前"
            maxLength={100}
            returnKeyType="done"
            onSubmitEditing={onAddLocation}
            style={[styles.input, styles.qtyInput]}
          />
          <Pressable
            testID="add-location-submit"
            accessibilityRole="button"
            onPress={onAddLocation}
            disabled={addingLocation}
            style={[styles.choice, addingLocation && styles.choiceDisabled]}
          >
            {addingLocation ? (
              <ActivityIndicator size="small" color="#333" />
            ) : (
              <Text style={styles.choiceLabel}>場所を追加</Text>
            )}
          </Pressable>
        </View>
        {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
      </Section>

      <Section title="数量 / 単位">
        <View style={styles.row}>
          <TextInput
            testID="add-quantity-input"
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
        testID="add-save"
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
    </KeyboardScrollView>
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
  choiceDisabled: { opacity: 0.5 },
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
