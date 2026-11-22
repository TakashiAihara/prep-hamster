import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { itemTags, items, tags } from "@prep-hamster/db"
import { createApp } from "../src/app"
import {
  attachTags,
  seedGroupWithMembership,
  seedItem,
  seedLocation,
  seedMembership,
  seedStock,
  seedTag,
  seedUser,
} from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { bearer, e2eAuth } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

type TagBody = { id: string; name: string; itemCount: number }
type ApiErr = { error: { code: string; message: string } }
const sleep = () => new Promise((r) => setTimeout(r, 15))
const stamp = async (id: string) => {
  const [row] = await testDb.select().from(items).where(eq(items.id, id))
  return row?.updatedAt.getTime() ?? -1
}

async function setup() {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const app = createApp({ db: testDb, auth: e2eAuth })
  const auth = await bearer(userId)
  const call = (method: string, path: string, body?: unknown, authorization = auth) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", authorization },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const putTags = (itemId: string, tagIds: string[]) =>
    call("PUT", `/v1/items/${itemId}/tags`, { tagIds })
  const listTags = async (gid = groupId) => {
    const res = await call("GET", `/v1/tags?groupId=${gid}`)
    expect(res.status).toBe(200)
    return ((await res.json()) as { tags: TagBody[] }).tags
  }
  return { userId, groupId, app, auth, call, putTags, listTags }
}

async function attachedTagIds(itemId: string) {
  const rows = await testDb.select().from(itemTags).where(eq(itemTags.itemId, itemId))
  return rows.map((r) => r.tagId).toSorted()
}

test("POST /v1/tags creates a tag with itemCount 0", async () => {
  const { call, groupId } = await setup()

  const res = await call("POST", "/v1/tags", { groupId, name: "  防災  " })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { tag: TagBody }
  expect(body.tag.name).toBe("防災")
  expect(body.tag.itemCount).toBe(0)
})

test("POST /v1/tags by VIEWER returns 403", async () => {
  const { groupId, app } = await setup()
  const viewerId = await seedUser("Viewer")
  await seedMembership(viewerId, groupId, "VIEWER")

  const res = await app.request("/v1/tags", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(viewerId) },
    body: JSON.stringify({ groupId, name: "x" }),
  })

  expect(res.status).toBe(403)
})

test("POST /v1/tags rejects empty and over-long names with VALIDATION_ERROR", async () => {
  const { call, groupId } = await setup()

  const empty = await call("POST", "/v1/tags", { groupId, name: "   " })
  const long = await call("POST", "/v1/tags", { groupId, name: "a".repeat(51) })
  const ok = await call("POST", "/v1/tags", { groupId, name: "a".repeat(50) })

  expect(empty.status).toBe(422)
  expect(((await empty.json()) as ApiErr).error.code).toBe("VALIDATION_ERROR")
  expect(long.status).toBe(422)
  expect(((await long.json()) as ApiErr).error.code).toBe("VALIDATION_ERROR")
  expect(ok.status).toBe(201)
})

test("a name that normalizes to an existing tag is TAG_NAME_DUPLICATE (full-width, half-width, case)", async () => {
  const { call, groupId } = await setup()
  expect((await call("POST", "/v1/tags", { groupId, name: "Pet" })).status).toBe(201)

  for (const name of ["ＰＥＴ", "pet", " PET "]) {
    // oxlint-disable-next-line no-await-in-loop
    const res = await call("POST", "/v1/tags", { groupId, name })
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    expect(((await res.json()) as ApiErr).error.code).toBe("TAG_NAME_DUPLICATE")
  }
  expect(await testDb.select().from(tags)).toHaveLength(1)
})

test("the same name is allowed in another group", async () => {
  const { call, groupId, userId } = await setup()
  const otherGroup = await seedGroupWithMembership(userId, "Other")
  expect((await call("POST", "/v1/tags", { groupId, name: "water" })).status).toBe(201)

  const res = await call("POST", "/v1/tags", { groupId: otherGroup, name: "water" })

  expect(res.status).toBe(201)
})

test("PATCH rename stores the same normalized name as POST and detects duplicates", async () => {
  const { call, groupId } = await setup()
  const a = (
    (await (await call("POST", "/v1/tags", { groupId, name: "alpha" })).json()) as { tag: TagBody }
  ).tag
  await call("POST", "/v1/tags", { groupId, name: "Beta" })

  const renamed = await call("PATCH", `/v1/tags/${a.id}`, { name: "ＧＡＭＭＡ" })
  const dup = await call("PATCH", `/v1/tags/${a.id}`, { name: "ｂｅｔａ" })

  expect(renamed.status).toBe(200)
  expect(((await renamed.json()) as { tag: TagBody }).tag.name).toBe("ＧＡＭＭＡ")
  const [row] = await testDb.select().from(tags).where(eq(tags.id, a.id))
  expect(row?.normalizedName).toBe("gamma")
  expect(dup.status).toBe(422)
  expect(((await dup.json()) as ApiErr).error.code).toBe("TAG_NAME_DUPLICATE")
  // 同じ入力を POST しても、PATCH が保存した値と同じ重複判定になる
  const postDup = await call("POST", "/v1/tags", { groupId, name: "gamma" })
  expect(((await postDup.json()) as ApiErr).error.code).toBe("TAG_NAME_DUPLICATE")
})

test("PATCH / DELETE of a missing or deleted tag returns 404", async () => {
  const { call, groupId } = await setup()
  const id = await seedTag(groupId, "gone")
  expect((await call("DELETE", `/v1/tags/${id}`)).status).toBe(204)

  expect((await call("PATCH", `/v1/tags/${id}`, { name: "x" })).status).toBe(404)
  expect((await call("DELETE", `/v1/tags/${id}`)).status).toBe(404)
  expect((await call("PATCH", `/v1/tags/${crypto.randomUUID()}`, { name: "x" })).status).toBe(404)
})

test("a deleted tag name can be created again", async () => {
  const { call, groupId } = await setup()
  const id = await seedTag(groupId, "again")
  await call("DELETE", `/v1/tags/${id}`)

  const res = await call("POST", "/v1/tags", { groupId, name: "again" })

  expect(res.status).toBe(201)
})

test("GET /v1/tags orders by item count desc then name, and excludes soft-deleted items", async () => {
  const { listTags, groupId } = await setup()
  // 件数 3 / 1 / 1 / 0 を、名前順が件数と逆になるようにする
  const top = await seedTag(groupId, "zeta")
  const tieB = await seedTag(groupId, "mid-b")
  const tieA = await seedTag(groupId, "mid-a")
  await seedTag(groupId, "alpha")
  const i1 = await seedItem(groupId, "i1")
  const i2 = await seedItem(groupId, "i2")
  const i3 = await seedItem(groupId, "i3")
  const dead = await seedItem(groupId, "dead")
  await attachTags(i1, [top, tieB])
  await attachTags(i2, [top])
  await attachTags(i3, [top, tieA])
  // 削除済みの item に付いた行は数えない
  await attachTags(dead, [tieA, tieB])
  await testDb.update(items).set({ deletedAt: new Date() }).where(eq(items.id, dead))

  const list = await listTags()

  expect(list.map((t) => [t.name, t.itemCount])).toEqual([
    ["zeta", 3],
    ["mid-a", 1],
    ["mid-b", 1],
    ["alpha", 0],
  ])
})

test("GET /v1/tags does not list other groups' tags", async () => {
  const { listTags, groupId, userId } = await setup()
  const other = await seedGroupWithMembership(userId, "Other")
  await seedTag(other, "foreign")
  await seedTag(groupId, "mine")

  expect((await listTags()).map((t) => t.name)).toEqual(["mine"])
})

test("PUT /items/:id/tags replaces the set and returns item and tags", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const a = await seedTag(groupId, "a")
  const b = await seedTag(groupId, "b")
  const c = await seedTag(groupId, "c")

  const first = await putTags(itemId, [a, b])
  expect(first.status).toBe(200)
  const body = (await first.json()) as { item: { tagIds: string[] }; tags: TagBody[] }
  expect(body.item.tagIds).toEqual([a, b].toSorted())
  expect(body.tags.map((t) => t.id).toSorted()).toEqual([a, b].toSorted())

  const second = await putTags(itemId, [c])
  expect(second.status).toBe(200)
  expect(await attachedTagIds(itemId)).toEqual([c])

  const cleared = await putTags(itemId, [])
  expect(cleared.status).toBe(200)
  expect(await attachedTagIds(itemId)).toEqual([])
})

test("PUT treats duplicate ids as one", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const a = await seedTag(groupId, "a")

  const res = await putTags(itemId, [a, a])

  expect(res.status).toBe(200)
  expect(await attachedTagIds(itemId)).toEqual([a])
})

test("PUT with more than 20 tags returns TAG_LIMIT_EXCEEDED, exactly 20 is accepted", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const ids: string[] = []
  for (let i = 0; i < 21; i++) {
    // oxlint-disable-next-line no-await-in-loop
    ids.push(await seedTag(groupId, `t${i}`))
  }

  const over = await putTags(itemId, ids)
  const at = await putTags(itemId, ids.slice(0, 20))
  // 21 件目が重複なら 20 件と同じ扱い (重複を落としてから数える)
  const dupOver = await putTags(itemId, [...ids.slice(0, 20), ids[0]!])

  expect(over.status).toBe(422)
  expect(((await over.json()) as ApiErr).error.code).toBe("TAG_LIMIT_EXCEEDED")
  expect(at.status).toBe(200)
  expect(dupOver.status).toBe(200)
  expect(await attachedTagIds(itemId)).toHaveLength(20)
})

test("a rejected PUT leaves the existing set untouched", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const a = await seedTag(groupId, "a")
  await putTags(itemId, [a])

  const res = await putTags(itemId, [crypto.randomUUID()])

  expect(res.status).toBe(422)
  expect(await attachedTagIds(itemId)).toEqual([a])
})

test("PUT with missing, deleted and foreign-group tags gets byte-identical 422 bodies", async () => {
  const { putTags, groupId, userId, call } = await setup()
  const itemId = await seedItem(groupId, "water")
  const otherGroup = await seedGroupWithMembership(userId, "Other")
  const foreign = await seedTag(otherGroup, "foreign")
  const deleted = await seedTag(groupId, "deleted")
  await call("DELETE", `/v1/tags/${deleted}`)

  const bodies: string[] = []
  for (const id of [crypto.randomUUID(), deleted, foreign]) {
    // oxlint-disable-next-line no-await-in-loop
    const res = await putTags(itemId, [id])
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    bodies.push(await res.text())
  }

  expect(JSON.parse(bodies[0]!).error.code).toBe("TAG_GROUP_MISMATCH")
  expect(new Set(bodies).size).toBe(1)
})

test("PUT on a missing or soft-deleted item returns 404, by VIEWER returns 403", async () => {
  const { putTags, groupId, app } = await setup()
  const itemId = await seedItem(groupId, "water")
  const viewerId = await seedUser("Viewer")
  await seedMembership(viewerId, groupId, "VIEWER")

  const viewer = await app.request(`/v1/items/${itemId}/tags`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: await bearer(viewerId) },
    body: JSON.stringify({ tagIds: [] }),
  })
  await testDb.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId))

  expect(viewer.status).toBe(403)
  expect((await putTags(itemId, [])).status).toBe(404)
  expect((await putTags(crypto.randomUUID(), [])).status).toBe(404)
})

test("DELETE tag removes it from every item and the filters stop returning them", async () => {
  const { call, groupId, putTags } = await setup()
  const locationId = await seedLocation(groupId, "Pantry")
  const i1 = await seedItem(groupId, "i1")
  const i2 = await seedItem(groupId, "i2")
  await seedStock(groupId, i1, locationId)
  await seedStock(groupId, i2, locationId)
  const t = await seedTag(groupId, "temp")
  await putTags(i1, [t])
  await putTags(i2, [t])

  expect((await call("DELETE", `/v1/tags/${t}`)).status).toBe(204)

  expect(await attachedTagIds(i1)).toEqual([])
  expect(await attachedTagIds(i2)).toEqual([])
  const stocksRes = await call("GET", `/v1/stocks?groupId=${groupId}&tagId=${t}`)
  expect(((await stocksRes.json()) as { stocks: unknown[] }).stocks).toEqual([])
  const itemsRes = await call("GET", `/v1/items?groupId=${groupId}&tagId=${t}`)
  expect(((await itemsRes.json()) as { items: unknown[] }).items).toEqual([])
  const item = await call("GET", `/v1/items/${i1}`)
  expect(((await item.json()) as { item: { tagIds: string[] } }).item.tagIds).toEqual([])
})

test("item soft delete removes its item_tags rows", async () => {
  const { call, groupId, putTags } = await setup()
  const itemId = await seedItem(groupId, "water")
  const t = await seedTag(groupId, "t")
  await putTags(itemId, [t])

  expect((await call("DELETE", `/v1/items/${itemId}`)).status).toBe(204)

  expect(await attachedTagIds(itemId)).toEqual([])
})

test("GET /stocks and /items filter by tagId (items carry tagIds)", async () => {
  const { call, groupId, putTags } = await setup()
  const locationId = await seedLocation(groupId, "Pantry")
  const tagged = await seedItem(groupId, "tagged")
  const other = await seedItem(groupId, "other")
  const bare = await seedItem(groupId, "bare")
  const stockTagged = await seedStock(groupId, tagged, locationId)
  await seedStock(groupId, other, locationId)
  await seedStock(groupId, bare, locationId)
  const t = await seedTag(groupId, "t")
  const u = await seedTag(groupId, "u")
  await putTags(tagged, [t])
  await putTags(other, [u])

  const stocksRes = await call("GET", `/v1/stocks?groupId=${groupId}&tagId=${t}`)
  const itemsRes = await call("GET", `/v1/items?groupId=${groupId}&tagId=${t}`)
  const allItems = await call("GET", `/v1/items?groupId=${groupId}`)

  expect(
    ((await stocksRes.json()) as { stocks: { id: string }[] }).stocks.map((s) => s.id),
  ).toEqual([stockTagged])
  const filtered = ((await itemsRes.json()) as { items: { id: string; tagIds: string[] }[] }).items
  expect(filtered.map((i) => [i.id, i.tagIds])).toEqual([[tagged, [t]]])
  const all = ((await allItems.json()) as { items: { name: string; tagIds: string[] }[] }).items
  expect(all.map((i) => [i.name, i.tagIds.length])).toEqual([
    ["bare", 0],
    ["other", 1],
    ["tagged", 1],
  ])
})

test("anon and authenticated roles cannot read the tag tables", async () => {
  const roles = (await testDb.execute(
    sql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`,
  )) as unknown as { rolname: string }[]
  if (roles.length < 2) {
    console.warn("skipped: anon / authenticated roles are missing (plain Postgres)")
    return
  }

  for (const role of ["anon", "authenticated"]) {
    for (const table of ["tags", "item_tags"]) {
      // ロール切替の失敗はテストの失敗にする。拒否を期待して捕まえるのは対象表の SELECT だけで、
      // 失敗した文が外側の transaction を壊さないよう savepoint (入れ子の transaction) に入れる
      // oxlint-disable-next-line no-await-in-loop
      const result = await testDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${role}`))
        return tx
          .transaction(async (inner) => {
            await inner.execute(sql.raw(`select count(*) from public.${table}`))
            return "readable"
          })
          .catch((err: unknown) =>
            String((err as { cause?: { message?: string } }).cause?.message ?? err),
          )
      })
      expect(result).toContain("permission denied")
    }
  }
})

test("both tag tables have row level security enabled", async () => {
  const rows = (await testDb.execute(
    sql`select relname, relrowsecurity as rls from pg_class where relname in ('tags', 'item_tags') and relkind = 'r' order by relname`,
  )) as unknown as { relname: string; rls: boolean }[]

  expect(rows.map((r) => [r.relname, r.rls])).toEqual([
    ["item_tags", true],
    ["tags", true],
  ])
})

test("POST /v1/tags without a body is VALIDATION_ERROR, not a pass-through", async () => {
  const { app, auth } = await setup()

  const res = await app.request("/v1/tags", { method: "POST", headers: { authorization: auth } })

  expect(res.status).toBe(422)
  expect(((await res.json()) as ApiErr).error.code).toBe("VALIDATION_ERROR")
})

test("PUT treats ids that differ only in letter case as one", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const a = await seedTag(groupId, "a")

  const res = await putTags(itemId, [a, a.toUpperCase()])

  expect(res.status).toBe(200)
  expect(await attachedTagIds(itemId)).toEqual([a])
})

test("PUT bumps items.updatedAt only when the set changes", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const a = await seedTag(groupId, "a")
  const b = await seedTag(groupId, "b")
  const read = async () => {
    const [item] = await testDb.select().from(items).where(eq(items.id, itemId))
    const rows = await testDb.select().from(itemTags).where(eq(itemTags.itemId, itemId))
    return {
      updatedAt: item?.updatedAt.getTime(),
      createdAt: rows.map((r) => r.createdAt.getTime()),
    }
  }

  const before = await read()
  await sleep()
  const firstRes = await putTags(itemId, [a])
  const first = await read()
  expect(first.updatedAt).toBeGreaterThan(before.updatedAt ?? 0)
  // 応答の item も、保存した行の updatedAt を返す
  const firstBody = (await firstRes.json()) as { item: { updatedAt: string } }
  expect(new Date(firstBody.item.updatedAt).getTime()).toBe(first.updatedAt ?? -1)

  // 同じ集合の再送は何も書かない
  await sleep()
  const same = await putTags(itemId, [a])
  expect(same.status).toBe(200)
  expect(await read()).toEqual(first)

  await sleep()
  await putTags(itemId, [a, b])
  expect((await read()).updatedAt).toBeGreaterThan(first.updatedAt ?? 0)
})

test("PATCH and DELETE /v1/tags/:id by VIEWER return 403 and change nothing", async () => {
  const { groupId, app } = await setup()
  const viewerId = await seedUser("Viewer")
  await seedMembership(viewerId, groupId, "VIEWER")
  const tagId = await seedTag(groupId, "keep")
  const viewer = await bearer(viewerId)
  const send = (method: string, body?: unknown) =>
    app.request(`/v1/tags/${tagId}`, {
      method,
      headers: { "content-type": "application/json", authorization: viewer },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const patch = await send("PATCH", { name: "renamed" })
  const del = await send("DELETE")

  expect(patch.status).toBe(403)
  expect(del.status).toBe(403)
  const [row] = await testDb.select().from(tags).where(eq(tags.id, tagId))
  expect([row?.name, row?.deletedAt]).toEqual(["keep", null])
})

test("DELETE tag bumps updatedAt of exactly the items that lose it", async () => {
  const { call, groupId, putTags } = await setup()
  const attached1 = await seedItem(groupId, "attached-1")
  const attached2 = await seedItem(groupId, "attached-2")
  const other = await seedItem(groupId, "other")
  const t = await seedTag(groupId, "doomed")
  const keep = await seedTag(groupId, "keep")
  await putTags(attached1, [t, keep])
  await putTags(attached2, [t])
  await putTags(other, [keep])
  const before = [await stamp(attached1), await stamp(attached2), await stamp(other)]
  await sleep()

  expect((await call("DELETE", `/v1/tags/${t}`)).status).toBe(204)

  expect(await stamp(attached1)).toBeGreaterThan(before[0] ?? 0)
  expect(await stamp(attached2)).toBeGreaterThan(before[1] ?? 0)
  expect(await stamp(other)).toBe(before[2] ?? -1)
  // 残る tag は付いたまま
  expect(await attachedTagIds(attached1)).toEqual([keep])
})

test("PATCH rename answers from the renamed row with its item count", async () => {
  const { call, groupId, putTags } = await setup()
  const i1 = await seedItem(groupId, "i1")
  const i2 = await seedItem(groupId, "i2")
  const t = await seedTag(groupId, "before")
  await putTags(i1, [t])
  await putTags(i2, [t])

  const res = await call("PATCH", `/v1/tags/${t}`, { name: "after" })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { tag: TagBody & { deletedAt: string | null } }
  expect([body.tag.name, body.tag.itemCount, body.tag.deletedAt]).toEqual(["after", 2, null])
})

test("PUT response tags carry the item count after this write", async () => {
  const { putTags, groupId } = await setup()
  const other = await seedItem(groupId, "other")
  const itemId = await seedItem(groupId, "water")
  const kept = await seedTag(groupId, "kept")
  const added = await seedTag(groupId, "added")
  await putTags(other, [kept])
  await putTags(itemId, [kept])

  const res = await putTags(itemId, [kept, added])

  const body = (await res.json()) as { tags: { id: string; itemCount: number }[] }
  const counts = Object.fromEntries(body.tags.map((t) => [t.id, t.itemCount]))
  // kept は other と itemId の 2 件、added は新しく付いた 1 件
  expect(counts).toEqual({ [kept]: 2, [added]: 1 })
  // 同じ集合の再送 (書かない経路) でも同じ数
  const again = await putTags(itemId, [kept, added])
  const againBody = (await again.json()) as { tags: { id: string; itemCount: number }[] }
  expect(Object.fromEntries(againBody.tags.map((t) => [t.id, t.itemCount]))).toEqual(counts)
})

test("PUT keeps the rows of retained tags and only writes the difference", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const a = await seedTag(groupId, "a")
  const b = await seedTag(groupId, "b")
  const c = await seedTag(groupId, "c")
  await putTags(itemId, [a, b])
  const stamps = async () =>
    Object.fromEntries(
      (await testDb.select().from(itemTags).where(eq(itemTags.itemId, itemId))).map((r) => [
        r.tagId,
        r.createdAt.getTime(),
      ]),
    )
  const before = await stamps()
  await sleep()

  await putTags(itemId, [b, c])

  const after = await stamps()
  expect(Object.keys(after).toSorted()).toEqual([b, c].toSorted())
  expect(after[b]).toBe(before[b] ?? -1)
  expect(after[c]).toBeGreaterThan(before[b] ?? 0)
})

test("PATCH /v1/tags/:id rejects empty, whitespace and over-long names", async () => {
  const { call, groupId } = await setup()
  const id = await seedTag(groupId, "keep")

  for (const name of ["", "   ", "a".repeat(51)]) {
    // oxlint-disable-next-line no-await-in-loop
    const res = await call("PATCH", `/v1/tags/${id}`, { name })
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    expect(((await res.json()) as ApiErr).error.code).toBe("VALIDATION_ERROR")
  }
  const ok = await call("PATCH", `/v1/tags/${id}`, { name: "a".repeat(50) })
  expect(ok.status).toBe(200)
})

test("PUT rejects more than 100 tag ids with VALIDATION_ERROR, 100 reaches the cap check", async () => {
  const { putTags, groupId } = await setup()
  const itemId = await seedItem(groupId, "water")
  const ids = Array.from({ length: 101 }, () => crypto.randomUUID())

  const over = await putTags(itemId, ids)
  const at = await putTags(itemId, ids.slice(0, 100))

  expect(over.status).toBe(422)
  expect(((await over.json()) as ApiErr).error.code).toBe("VALIDATION_ERROR")
  // 100 件までは schema を通り、上限 (20) の検査で TAG_LIMIT_EXCEEDED になる
  expect(at.status).toBe(422)
  expect(((await at.json()) as ApiErr).error.code).toBe("TAG_LIMIT_EXCEEDED")
})
