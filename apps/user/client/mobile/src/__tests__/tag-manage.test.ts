import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import {
  addTagToItem,
  applyRenamedTag,
  deleteTagDetail,
  findTagByName,
  mergeTags,
  parseTagName,
  removeTag,
  removeTagFromItem,
  type TagDto,
} from "../tag-manage"

const GROUP = "55555555-5555-4555-8555-555555555555"
const ITEM = "66666666-6666-4666-8666-666666666666"
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const T3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const tag = (id: string, name: string, itemCount = 0): TagDto => ({ id, name, itemCount })
const tagDto = (id: string, name: string) => ({
  id,
  groupId: GROUP,
  name,
  itemCount: 0,
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
  deletedAt: null,
})

// 応答は送った集合を逆順で返し、tag の名前も別の値にする (応答ではなくリクエストを返す実装を落とす)
const respond = (ids: string[]) =>
  json({
    item: { tagIds: ids.toReversed() },
    tags: ids.map((id) => tagDto(id, `saved-${id.slice(0, 1)}`)),
  })

// hono client の v1.tags.$get / $post と v1.items[":id"].tags.$put の形だけを模した偽物
function fakeClient(opts: {
  post?: () => Response
  get?: () => Response
  put?: (tagIds: string[]) => Response
}) {
  const calls = { post: [] as unknown[], get: 0, put: [] as unknown[] }
  const client = {
    v1: {
      tags: {
        $get: async () => {
          calls.get += 1
          return (opts.get ?? (() => json({ tags: [] })))()
        },
        $post: async (args: unknown) => {
          calls.post.push(args)
          return (opts.post ?? (() => json({ tag: tagDto(T3, "new") }, 201)))()
        },
      },
      items: {
        ":id": {
          tags: {
            $put: async (args: { json: { tagIds: string[] } }) => {
              calls.put.push(args)
              return (opts.put ?? respond)(args.json.tagIds)
            },
          },
        },
      },
    },
  } as unknown as ApiClient
  return { client, calls }
}

test("parseTagName trims, rejects empty and over 50 characters", () => {
  expect(parseTagName("  防災 ")).toEqual({ ok: true, value: "防災" })
  expect(parseTagName("   ").ok).toBe(false)
  expect(parseTagName("a".repeat(51)).ok).toBe(false)
  expect(parseTagName("a".repeat(50)).ok).toBe(true)
})

test("findTagByName matches full-width, half-width and case differences", () => {
  const tags = [tag(T1, "Pet"), tag(T2, "水")]
  expect(findTagByName(tags, "ＰＥＴ")?.id).toBe(T1)
  expect(findTagByName(tags, " pet ")?.id).toBe(T1)
  expect(findTagByName(tags, "犬")).toBeNull()
})

test("addTagToItem reuses an existing tag without calling POST", async () => {
  const { client, calls } = fakeClient({})
  const res = await addTagToItem(client, {
    groupId: GROUP,
    itemId: ITEM,
    currentTagIds: [T2],
    knownTags: [tag(T1, "Pet")],
    name: "ＰＥＴ",
  })
  expect(res).toEqual({
    ok: true,
    tagIds: [T1, T2],
    tags: [tagDto(T2, "saved-b"), tagDto(T1, "saved-a")],
    tagId: T1,
  })
  expect(calls.post).toEqual([])
  expect(calls.put).toEqual([{ param: { id: ITEM }, json: { tagIds: [T2, T1] } }])
})

test("addTagToItem creates a missing tag and then applies it", async () => {
  const { client, calls } = fakeClient({})
  const res = await addTagToItem(client, {
    groupId: GROUP,
    itemId: ITEM,
    currentTagIds: [],
    knownTags: [],
    name: " new ",
  })
  expect(res).toEqual({ ok: true, tagIds: [T3], tags: [tagDto(T3, "saved-c")], tagId: T3 })
  expect(calls.post).toEqual([{ json: { groupId: GROUP, name: "new" } }])
  expect(calls.put).toEqual([{ param: { id: ITEM }, json: { tagIds: [T3] } }])
})

test("addTagToItem on TAG_NAME_DUPLICATE re-reads the list and applies the winner's tag", async () => {
  const { client, calls } = fakeClient({
    post: () => json({ error: { code: "TAG_NAME_DUPLICATE", message: "dup" } }, 422),
    get: () => json({ tags: [tagDto(T1, "Winner")] }),
  })
  const res = await addTagToItem(client, {
    groupId: GROUP,
    itemId: ITEM,
    currentTagIds: [],
    knownTags: [],
    name: "winner",
  })
  expect(res).toEqual({ ok: true, tagIds: [T1], tags: [tagDto(T1, "saved-a")], tagId: T1 })
  expect(calls.get).toBe(1)
  expect(calls.put).toEqual([{ param: { id: ITEM }, json: { tagIds: [T1] } }])
})

test("addTagToItem returns the API message for other POST failures and does not PUT", async () => {
  const { client, calls } = fakeClient({
    post: () => json({ error: { code: "FORBIDDEN", message: "権限がありません" } }, 403),
  })
  const res = await addTagToItem(client, {
    groupId: GROUP,
    itemId: ITEM,
    currentTagIds: [],
    knownTags: [],
    name: "x",
  })
  expect(res).toEqual({ ok: false, message: "権限がありません" })
  expect(calls.put).toEqual([])
})

test("addTagToItem skips the PUT when the item already has the tag", async () => {
  const { client, calls } = fakeClient({})
  const res = await addTagToItem(client, {
    groupId: GROUP,
    itemId: ITEM,
    currentTagIds: [T1],
    knownTags: [tag(T1, "Pet")],
    name: "pet",
  })
  expect(res).toEqual({ ok: true, tagIds: [T1], tags: [tag(T1, "Pet")], tagId: T1 })
  expect(calls.put).toEqual([])
})

test("addTagToItem surfaces the API's TAG_LIMIT_EXCEEDED message", async () => {
  const { client } = fakeClient({
    put: () => json({ error: { code: "TAG_LIMIT_EXCEEDED", message: "20 件までです" } }, 422),
  })
  const res = await addTagToItem(client, {
    groupId: GROUP,
    itemId: ITEM,
    currentTagIds: [],
    knownTags: [tag(T1, "Pet")],
    name: "pet",
  })
  expect(res).toEqual({ ok: false, message: "20 件までです" })
})

test("removeTagFromItem puts the set without the removed tag", async () => {
  const { client, calls } = fakeClient({})
  const res = await removeTagFromItem(client, ITEM, [T1, T2], T1)
  expect(res).toEqual({ ok: true, tagIds: [T2], tags: [tagDto(T2, "saved-b")] })
  expect(calls.put).toEqual([{ param: { id: ITEM }, json: { tagIds: [T2] } }])
})

test("deleteTagDetail states how many items lose the tag", () => {
  expect(deleteTagDetail(tag(T1, "Pet", 3))).toEqual({
    title: "「Pet」を削除しますか？",
    detail: "3 件の商品からこのタグが外れます",
  })
  expect(deleteTagDetail(tag(T1, "Pet", 0)).detail).toBe("このタグを付けている商品はありません")
})

test("mergeTags adds new tags, refreshes existing ones and keeps the rest", () => {
  const list = [tag(T1, "a", 1), tag(T2, "b", 2)]
  const merged = mergeTags(list, [tag(T2, "b2", 3), tag(T3, "c", 0)])
  expect(merged).toEqual([tag(T1, "a", 1), tag(T2, "b2", 3), tag(T3, "c", 0)])
  expect(mergeTags(list, [])).toEqual(list)
})

test("applyRenamedTag and removeTag keep the reference when the id is absent", () => {
  const tags = [tag(T1, "a"), tag(T2, "b")]
  expect(applyRenamedTag(tags, T1, "z").map((t) => t.name)).toEqual(["z", "b"])
  expect(applyRenamedTag(tags, T3, "z")).toBe(tags)
  expect(removeTag(tags, T1).map((t) => t.id)).toEqual([T2])
  expect(removeTag(tags, T3)).toBe(tags)
})
