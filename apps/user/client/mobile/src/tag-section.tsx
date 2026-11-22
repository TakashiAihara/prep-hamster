import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native"
import { getApiClient } from "@/api"
import { apiErrorMessage } from "@/api-error"
import { addTagToItem, listTags, removeTagFromItem, type TagDto } from "@/tag-manage"

// 在庫詳細のタグ欄。タグは item に付くので、同じ item の別の在庫でも同じタグが出る。
// 詳細画面の state とは独立に、item のタグと group のタグ一覧を自分で読む。
export function TagSection({ groupId, itemId }: { groupId: string; itemId: string }) {
  const [tags, setTags] = useState<TagDto[] | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // キーボード送信の 2 連打は state ではなく同期フラグで止める
  const busyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const client = getApiClient()
        const [list, itemRes] = await Promise.all([
          listTags(client, groupId),
          client.v1.items[":id"].$get({ param: { id: itemId } }),
        ])
        if (cancelled) return
        if (!list.ok) return setError(list.message)
        if (!itemRes.ok) return setError(await apiErrorMessage(itemRes, `HTTP ${itemRes.status}`))
        const { item } = await itemRes.json()
        if (cancelled) return
        setTags(list.tags)
        setTagIds(item.tagIds)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "unknown")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [groupId, itemId])

  async function run(
    job: () => Promise<{ ok: true; tagIds: string[] } | { ok: false; message: string }>,
  ) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await job()
      if (!res.ok) return setError(res.message)
      setTagIds(res.tagIds)
      setDraft("")
      // 新しく作ったタグを候補に出すため、一覧を取り直す
      const list = await listTags(getApiClient(), groupId)
      if (list.ok) setTags(list.tags)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const onAdd = (name: string) =>
    run(() =>
      addTagToItem(getApiClient(), {
        groupId,
        itemId,
        currentTagIds: tagIds,
        knownTags: tags ?? [],
        name,
      }),
    )
  const onRemove = (tagId: string) =>
    run(() => removeTagFromItem(getApiClient(), itemId, tagIds, tagId))

  if (tags === null) {
    return error ? (
      <Text style={styles.error} testID="detail-tags-error">
        {error}
      </Text>
    ) : (
      <ActivityIndicator />
    )
  }

  const applied = tags.filter((t) => tagIds.includes(t.id))
  const suggestions = tags.filter((t) => !tagIds.includes(t.id))

  return (
    <View style={styles.section} testID="detail-tags">
      <Text style={styles.sectionTitle}>タグ</Text>
      <View style={styles.chips}>
        {applied.length === 0 ? <Text style={styles.meta}>タグはありません</Text> : null}
        {applied.map((t) => (
          <Pressable
            key={t.id}
            testID={`detail-tag-${t.id}`}
            accessibilityRole="button"
            accessibilityLabel={`タグ ${t.name} を外す`}
            disabled={busy}
            onPress={() => void onRemove(t.id)}
            style={[styles.chip, styles.chipOn, busy && styles.disabled]}
          >
            <Text style={styles.chipOnLabel}>{t.name} ×</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          testID="detail-tag-input"
          value={draft}
          onChangeText={setDraft}
          editable={!busy}
          maxLength={50}
          returnKeyType="done"
          onSubmitEditing={() => void onAdd(draft)}
          style={styles.input}
          placeholder="タグを追加"
        />
        <Pressable
          testID="detail-tag-add"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void onAdd(draft)}
          style={[styles.add, busy && styles.disabled]}
        >
          <Text style={styles.addLabel}>追加</Text>
        </Pressable>
      </View>
      {suggestions.length > 0 ? (
        <View style={styles.chips}>
          {suggestions.map((t) => (
            <Pressable
              key={t.id}
              testID={`detail-tag-suggest-${t.id}`}
              accessibilityRole="button"
              accessibilityLabel={`タグ ${t.name} を付ける`}
              disabled={busy}
              onPress={() => void onAdd(t.name)}
              style={[styles.chip, busy && styles.disabled]}
            >
              <Text style={styles.chipLabel}>{t.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} testID="detail-tags-error">
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#333" },
  meta: { fontSize: 13, color: "#555" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#aaa",
  },
  chipOn: { backgroundColor: "#2c7be5", borderColor: "#2c7be5" },
  chipLabel: { fontSize: 13, color: "#333" },
  chipOnLabel: { fontSize: 13, color: "#fff", fontWeight: "600" },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  add: { paddingHorizontal: 12, paddingVertical: 10 },
  addLabel: { color: "#2c7be5", fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.4 },
  error: { color: "#c0392b" },
})
