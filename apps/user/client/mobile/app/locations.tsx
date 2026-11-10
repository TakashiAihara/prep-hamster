import { Redirect, useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { getApiClient } from "@/api"
import { useCurrentGroup } from "@/current-group"
import { KeyboardScrollView } from "@/keyboard-scroll-view"
import { parseLocationName } from "@/location-create"
import {
  applyRenamedLocation,
  deleteLocation,
  removeLocation,
  renameLocation,
  type LocationDto,
} from "@/location-manage"

type LoadState =
  | { status: "loading" }
  | { status: "ok"; locations: LocationDto[] }
  | { status: "error"; message: string }

type Pending = { kind: "rename" | "delete"; id: string }

type ActionMessage = { kind: "ok" | "error"; text: string }

// 場所管理画面 (/locations)。root の Stack の modal として /groups から開く。
// rename / delete は EDITOR 以上。role をクライアントが持たないのでボタンは常に出し、
// 403 は API の message をそのまま出す (グループ招待ボタンと同じ既存パターン)。
// /groups と同じく、未サインインやグループ未確定のまま deep link で開かれたら入口へ戻す
export default function LocationsScreen() {
  const { status, group } = useCurrentGroup()
  if (status !== "ok" || !group) return <Redirect href="/" />
  // グループが変わったら編集中の行や一覧を前のグループのまま残さない
  return <LocationsBody key={group.id} groupId={group.id} />
}

function LocationsBody({ groupId }: { groupId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<ActionMessage | null>(null)

  // focus のたびに取り直す (他のメンバーが変えた場所を古いまま操作しない)。再試行は reloadKey で再実行する
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      setLoad({ status: "loading" })
      void (async () => {
        try {
          const res = await getApiClient().v1.locations.$get({ query: { groupId } })
          if (cancelled) return
          if (!res.ok) {
            setLoad({ status: "error", message: `locations HTTP ${res.status}` })
            return
          }
          const { locations } = await res.json()
          if (cancelled) return
          setLoad({ status: "ok", locations })
        } catch (err) {
          if (cancelled) return
          setLoad({ status: "error", message: err instanceof Error ? err.message : "unknown" })
        }
      })()
      return () => {
        cancelled = true
      }
    }, [groupId, reloadKey]),
  )

  function startEdit(loc: LocationDto) {
    setEditingId(loc.id)
    setDraftName(loc.name)
    setMessage(null)
  }

  async function onRename(loc: LocationDto) {
    const parsed = parseLocationName(draftName)
    if (!parsed.ok) {
      setMessage({ kind: "error", text: parsed.message })
      return
    }
    // 名前が変わっていなければ API を呼ばずに編集を閉じる (updatedAt だけが動く書き込みを避ける)
    if (parsed.value === loc.name) {
      setEditingId(null)
      return
    }
    setPending({ kind: "rename", id: loc.id })
    setMessage(null)
    try {
      const res = await renameLocation(getApiClient(), loc.id, parsed.value)
      if (!res.ok) {
        setMessage({ kind: "error", text: res.message })
        return
      }
      setLoad((prev) =>
        prev.status === "ok"
          ? { ...prev, locations: applyRenamedLocation(prev.locations, loc.id, res.name) }
          : prev,
      )
      setEditingId(null)
      setMessage({ kind: "ok", text: "場所の名前を変更しました" })
    } finally {
      setPending(null)
    }
  }

  function confirmDelete(loc: LocationDto) {
    Alert.alert(`「${loc.name}」を削除しますか？`, "在庫がこの場所を参照していると削除できません", [
      { text: "キャンセル", style: "cancel" },
      { text: "削除", style: "destructive", onPress: () => void onDelete(loc) },
    ])
  }

  async function onDelete(loc: LocationDto) {
    setPending({ kind: "delete", id: loc.id })
    setMessage(null)
    try {
      const res = await deleteLocation(getApiClient(), loc.id)
      if (!res.ok) {
        setMessage({ kind: "error", text: res.message })
        return
      }
      setLoad((prev) =>
        prev.status === "ok"
          ? { ...prev, locations: removeLocation(prev.locations, loc.id) }
          : prev,
      )
      if (editingId === loc.id) setEditingId(null)
      setMessage({ kind: "ok", text: "場所を削除しました" })
    } finally {
      setPending(null)
    }
  }

  if (load.status === "loading") {
    return (
      <View style={styles.center} testID="locations-loading">
        <ActivityIndicator />
      </View>
    )
  }
  if (load.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error} testID="locations-load-error">
          取得失敗: {load.message}
        </Text>
        <Pressable
          testID="locations-retry"
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
    <KeyboardScrollView contentContainerStyle={styles.container}>
      {load.locations.length === 0 ? (
        <Text style={styles.empty}>場所がまだありません</Text>
      ) : (
        <View style={styles.list}>
          {load.locations.map((loc) =>
            editingId === loc.id ? (
              <View key={loc.id} style={styles.row} testID={`location-edit-row-${loc.id}`}>
                <TextInput
                  testID="location-edit-input"
                  value={draftName}
                  onChangeText={setDraftName}
                  autoFocus
                  maxLength={100}
                  returnKeyType="done"
                  onSubmitEditing={() => void onRename(loc)}
                  style={[styles.input, styles.editInput]}
                />
                <Pressable
                  testID="location-edit-save"
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => void onRename(loc)}
                  disabled={pending !== null}
                >
                  {pending?.kind === "rename" && pending.id === loc.id ? (
                    <ActivityIndicator size="small" color="#2c7be5" />
                  ) : (
                    <Text style={styles.editLabel}>保存</Text>
                  )}
                </Pressable>
                <Pressable
                  testID="location-edit-cancel"
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => setEditingId(null)}
                  disabled={pending !== null}
                >
                  <Text style={styles.cancelLabel}>キャンセル</Text>
                </Pressable>
              </View>
            ) : (
              <View key={loc.id} style={styles.row} testID={`location-row-${loc.id}`}>
                <Text style={styles.name}>{loc.name}</Text>
                <Pressable
                  testID={`location-edit-${loc.id}`}
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => startEdit(loc)}
                  disabled={pending !== null}
                >
                  <Text style={styles.editLabel}>編集</Text>
                </Pressable>
                <Pressable
                  testID={`location-delete-${loc.id}`}
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => confirmDelete(loc)}
                  disabled={pending !== null}
                >
                  {pending?.kind === "delete" && pending.id === loc.id ? (
                    <ActivityIndicator size="small" color="#c0392b" />
                  ) : (
                    <Text style={styles.deleteLabel}>削除</Text>
                  )}
                </Pressable>
              </View>
            ),
          )}
        </View>
      )}

      {message ? (
        <Text
          style={message.kind === "ok" ? styles.ok : styles.error}
          testID={message.kind === "ok" ? "locations-message" : "locations-error"}
        >
          {message.text}
        </Text>
      ) : null}
    </KeyboardScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 12 },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  name: { flex: 1, fontSize: 15, marginRight: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  editInput: { flex: 1, paddingVertical: 6 },
  action: { paddingHorizontal: 8, paddingVertical: 8, minWidth: 44, alignItems: "center" },
  disabled: { opacity: 0.4 },
  editLabel: { color: "#2c7be5", fontSize: 14, fontWeight: "600" },
  deleteLabel: { color: "#c0392b", fontSize: 14, fontWeight: "600" },
  cancelLabel: { color: "#888", fontSize: 14 },
  empty: { color: "#666", fontSize: 13 },
  ok: { color: "#1e8449" },
  error: { color: "#c0392b" },
  retry: {
    marginTop: 4,
    backgroundColor: "#2c7be5",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  primaryLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
})
