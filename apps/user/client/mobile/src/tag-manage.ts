import type { ApiClient } from "@prep-hamster/api-client"
import { TAG_NAME_MAX, normalizeTagName } from "@prep-hamster/schema/tag-name"

// タグの管理と item への付け外しの非 UI ロジック。画面から切り出して描画なしの unit test で固定する。
// 名前の同一判定は API と同じ normalizeTagName を通す。

export type TagDto = { id: string; name: string; itemCount: number }

export type TagResult<T> = ({ ok: true } & T) | { ok: false; message: string }

const TAG_NAME_DUPLICATE_CODE = "TAG_NAME_DUPLICATE"

export function parseTagName(
  input: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = input.trim()
  if (value === "") return { ok: false, message: "タグの名前を入力してください" }
  if (value.length > TAG_NAME_MAX) {
    return { ok: false, message: `タグの名前は ${TAG_NAME_MAX} 文字以内で入力してください` }
  }
  return { ok: true, value }
}

// 入力した名前と同じと見なせる既存のタグ。無ければ null
export function findTagByName<T extends { name: string }>(tags: T[], name: string): T | null {
  const wanted = normalizeTagName(name)
  return tags.find((t) => normalizeTagName(t.name) === wanted) ?? null
}

type ApiError = { code: string | null; message: string }

async function readApiError(
  res: { json: () => Promise<unknown> },
  fallback: string,
): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } }
    const rawMessage = body.error?.message
    const message = typeof rawMessage === "string" && rawMessage.length > 0 ? rawMessage : fallback
    const rawCode = body.error?.code
    return { code: typeof rawCode === "string" ? rawCode : null, message }
  } catch {
    return { code: null, message: fallback }
  }
}

const failure = (err: unknown): { ok: false; message: string } => ({
  ok: false,
  message: err instanceof Error ? err.message : "unknown",
})

export async function listTags(
  client: ApiClient,
  groupId: string,
): Promise<TagResult<{ tags: TagDto[] }>> {
  try {
    const res = await client.v1.tags.$get({ query: { groupId } })
    if (!res.ok)
      return { ok: false, message: (await readApiError(res, `HTTP ${res.status}`)).message }
    const { tags } = await res.json()
    return { ok: true, tags }
  } catch (err) {
    return failure(err)
  }
}

export async function renameTag(
  client: ApiClient,
  tagId: string,
  name: string,
): Promise<TagResult<{ name: string }>> {
  try {
    const res = await client.v1.tags[":id"].$patch({ param: { id: tagId }, json: { name } })
    if (!res.ok)
      return { ok: false, message: (await readApiError(res, `HTTP ${res.status}`)).message }
    const { tag } = await res.json()
    return { ok: true, name: tag.name }
  } catch (err) {
    return failure(err)
  }
}

export async function deleteTag(client: ApiClient, tagId: string): Promise<TagResult<object>> {
  try {
    const res = await client.v1.tags[":id"].$delete({ param: { id: tagId } })
    if (!res.ok)
      return { ok: false, message: (await readApiError(res, `HTTP ${res.status}`)).message }
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

// 削除の確認文。何件の商品からタグが外れるかを伝える
export function deleteTagDetail(tag: TagDto): { title: string; detail: string } {
  return {
    title: `「${tag.name}」を削除しますか？`,
    detail:
      tag.itemCount === 0
        ? "このタグを付けている商品はありません"
        : `${tag.itemCount} 件の商品からこのタグが外れます`,
  }
}

// item の tag 集合を丸ごと置き換える。応答の tagIds が API に保存された集合
export async function putItemTags(
  client: ApiClient,
  itemId: string,
  tagIds: string[],
): Promise<TagResult<{ tagIds: string[]; tags: TagDto[] }>> {
  try {
    const res = await client.v1.items[":id"].tags.$put({ param: { id: itemId }, json: { tagIds } })
    if (!res.ok)
      return { ok: false, message: (await readApiError(res, `HTTP ${res.status}`)).message }
    const { item, tags } = await res.json()
    return { ok: true, tagIds: item.tagIds, tags }
  } catch (err) {
    return failure(err)
  }
}

export async function removeTagFromItem(
  client: ApiClient,
  itemId: string,
  currentTagIds: string[],
  tagId: string,
): Promise<TagResult<{ tagIds: string[]; tags: TagDto[] }>> {
  return putItemTags(
    client,
    itemId,
    currentTagIds.filter((id) => id !== tagId),
  )
}

// 入力した名前のタグを item に付ける。既存のタグは使い回し、無ければ作ってから付ける。
// 同時に同名が作られて 422 TAG_NAME_DUPLICATE になったら、一覧を読み直して勝った側のタグで続ける
// (読み直すだけでは作られたタグが item に付かないまま終わる)。
export async function addTagToItem(
  client: ApiClient,
  args: {
    groupId: string
    itemId: string
    currentTagIds: string[]
    knownTags: TagDto[]
    name: string
  },
): Promise<TagResult<{ tagIds: string[]; tags: TagDto[]; tagId: string }>> {
  const parsed = parseTagName(args.name)
  if (!parsed.ok) return parsed

  // 重複の回復で読み直した一覧があれば、そちらを以降の DTO の出所にする (古い knownTags には勝った側の tag が無い)
  let source = args.knownTags
  let tagId = findTagByName(source, parsed.value)?.id ?? null
  if (!tagId) {
    try {
      const res = await client.v1.tags.$post({
        json: { groupId: args.groupId, name: parsed.value },
      })
      if (res.ok) {
        tagId = (await res.json()).tag.id
      } else {
        const err = await readApiError(res, `HTTP ${res.status}`)
        if (err.code !== TAG_NAME_DUPLICATE_CODE) return { ok: false, message: err.message }
        const reread = await listTags(client, args.groupId)
        if (!reread.ok) return reread
        source = reread.tags
        tagId = findTagByName(reread.tags, parsed.value)?.id ?? null
        if (!tagId) return { ok: false, message: err.message }
      }
    } catch (err) {
      return failure(err)
    }
  }

  if (args.currentTagIds.includes(tagId)) {
    const existing = source.filter((t) => args.currentTagIds.includes(t.id))
    return { ok: true, tagIds: args.currentTagIds, tags: existing, tagId }
  }
  const put = await putItemTags(client, args.itemId, [...args.currentTagIds, tagId])
  return put.ok ? { ok: true, tagIds: put.tagIds, tags: put.tags, tagId } : put
}

// 一覧に、PUT の応答に載った (付いている) tag を入れる。無ければ足し、有れば件数と名前を新しい値にする。
// 取り直しの往復を待たずに、付けたばかりの tag の chip を出すため
export function mergeTags(list: TagDto[], applied: TagDto[]): TagDto[] {
  const byId = new Map(applied.map((t) => [t.id, t]))
  const merged = list.map((t) => byId.get(t.id) ?? t)
  const known = new Set(list.map((t) => t.id))
  return [...merged, ...applied.filter((t) => !known.has(t.id))]
}

// 一覧の差し替え。対象が無ければ同じ配列を返す (React の再描画を省くため参照を保つ)
export function applyRenamedTag<T extends { id: string; name: string }>(
  tags: T[],
  id: string,
  name: string,
): T[] {
  if (!tags.some((t) => t.id === id)) return tags
  return tags.map((t) => (t.id === id ? { ...t, name } : t))
}

export function removeTag<T extends { id: string }>(tags: T[], id: string): T[] {
  if (!tags.some((t) => t.id === id)) return tags
  return tags.filter((t) => t.id !== id)
}
