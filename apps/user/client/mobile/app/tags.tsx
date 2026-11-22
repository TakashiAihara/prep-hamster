import { Redirect, useFocusEffect } from "expo-router"
import { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
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
import {
  applyRenamedTag,
  deleteTag,
  deleteTagDetail,
  listTags,
  parseTagName,
  removeTag,
  renameTag,
  type TagDto,
} from "@/tag-manage"

type LoadState =
  | { status: "loading" }
  | { status: "ok"; tags: TagDto[] }
  | { status: "error"; message: string }

type Pending = { kind: "rename" | "delete"; id: string }

// タグ管理画面 (/tags)。root の Stack の modal として /groups から開く。
// 一覧は API が返す使用数の多い順。rename / delete は EDITOR 以上で、403 は API の message をそのまま出す
// (locations と同じ形)。
export default function TagsScreen() {
  const { status, group } = useCurrentGroup()
  if (status !== "ok" || !group) return <Redirect href="/" />
  return <TagsBody key={group.id} groupId={group.id} />
}

function TagsBody({ groupId }: { groupId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      setLoad((prev) => (prev.status === "ok" ? prev : { status: "loading" }))
      void (async () => {
        const res = await listTags(getApiClient(), groupId)
        if (cancelled) return
        setLoad(
          res.ok ? { status: "ok", tags: res.tags } : { status: "error", message: res.message },
        )
      })()
      return () => {
        cancelled = true
      }
    }, [groupId, reloadKey]),
  )

  async function onRename(tag: TagDto) {
    if (pendingRef.current !== null) return
    const parsed = parseTagName(draftName)
    if (!parsed.ok) {
      setMessage({ kind: "error", text: parsed.message })
      return
    }
    if (parsed.value === tag.name) {
      setEditingId(null)
      setMessage(null)
      return
    }
    pendingRef.current = { kind: "rename", id: tag.id }
    setPending(pendingRef.current)
    setMessage(null)
    try {
      const res = await renameTag(getApiClient(), tag.id, parsed.value)
      if (!res.ok) {
        setMessage({ kind: "error", text: res.message })
        return
      }
      setLoad((prev) =>
        prev.status === "ok"
          ? { ...prev, tags: applyRenamedTag(prev.tags, tag.id, res.name) }
          : prev,
      )
      setEditingId(null)
      setMessage({ kind: "ok", text: "タグの名前を変更しました" })
    } finally {
      pendingRef.current = null
      setPending(null)
      setReloadKey((n) => n + 1)
    }
  }

  function confirmDelete(tag: TagDto) {
    if (pendingRef.current !== null) return
    pendingRef.current = { kind: "delete", id: tag.id }
    const { title, detail } = deleteTagDetail(tag)
    // react-native-web の Alert.alert は何もせず解決しないので、web は window.confirm を使う
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n${detail}`)) void onDelete(tag)
      else pendingRef.current = null
      return
    }
    Alert.alert(
      title,
      detail,
      [
        {
          text: "キャンセル",
          style: "cancel",
          onPress: () => {
            pendingRef.current = null
          },
        },
        { text: "削除", style: "destructive", onPress: () => void onDelete(tag) },
      ],
      { cancelable: false },
    )
  }

  async function onDelete(tag: TagDto) {
    if (pendingRef.current?.kind !== "delete" || pendingRef.current.id !== tag.id) return
    setPending(pendingRef.current)
    setMessage(null)
    try {
      const res = await deleteTag(getApiClient(), tag.id)
      if (!res.ok) {
        setMessage({ kind: "error", text: res.message })
        return
      }
      setLoad((prev) =>
        prev.status === "ok" ? { ...prev, tags: removeTag(prev.tags, tag.id) } : prev,
      )
      if (editingId === tag.id) setEditingId(null)
      setMessage({ kind: "ok", text: "タグを削除しました" })
    } finally {
      pendingRef.current = null
      setPending(null)
      setReloadKey((n) => n + 1)
    }
  }

  if (load.status === "loading") {
    return (
      <View style={styles.center} testID="tags-loading">
        <ActivityIndicator />
      </View>
    )
  }
  if (load.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error} testID="tags-load-error">
          取得失敗: {load.message}
        </Text>
        <Pressable
          testID="tags-retry"
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
      {load.tags.length === 0 ? (
        <Text style={styles.empty}>タグがまだありません。在庫の詳細から追加できます</Text>
      ) : (
        <View style={styles.list}>
          {load.tags.map((tag) =>
            editingId === tag.id ? (
              <View key={tag.id} style={styles.row} testID={`tag-edit-row-${tag.id}`}>
                <TextInput
                  testID="tag-edit-input"
                  value={draftName}
                  onChangeText={setDraftName}
                  editable={pending === null}
                  autoFocus
                  maxLength={50}
                  returnKeyType="done"
                  onSubmitEditing={() => void onRename(tag)}
                  style={styles.input}
                />
                <Pressable
                  testID="tag-edit-save"
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => void onRename(tag)}
                  disabled={pending !== null}
                >
                  <Text style={styles.editLabel}>保存</Text>
                </Pressable>
                <Pressable
                  testID="tag-edit-cancel"
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => setEditingId(null)}
                  disabled={pending !== null}
                >
                  <Text style={styles.cancelLabel}>キャンセル</Text>
                </Pressable>
              </View>
            ) : (
              <View key={tag.id} style={styles.row} testID={`tag-row-${tag.id}`}>
                <Text style={styles.name}>{tag.name}</Text>
                <Text style={styles.count} testID={`tag-count-${tag.id}`}>
                  {tag.itemCount} 件
                </Text>
                <Pressable
                  testID={`tag-edit-${tag.id}`}
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => {
                    setEditingId(tag.id)
                    setDraftName(tag.name)
                    setMessage(null)
                  }}
                  disabled={pending !== null}
                >
                  <Text style={styles.editLabel}>編集</Text>
                </Pressable>
                <Pressable
                  testID={`tag-delete-${tag.id}`}
                  accessibilityRole="button"
                  style={[styles.action, pending !== null && styles.disabled]}
                  onPress={() => confirmDelete(tag)}
                  disabled={pending !== null}
                >
                  <Text style={styles.deleteLabel}>削除</Text>
                </Pressable>
              </View>
            ),
          )}
        </View>
      )}

      {message ? (
        <Text
          style={message.kind === "ok" ? styles.ok : styles.error}
          testID={message.kind === "ok" ? "tags-message" : "tags-error"}
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
  count: { fontSize: 13, color: "#666" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 15,
  },
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
