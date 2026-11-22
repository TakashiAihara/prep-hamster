import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { itemTags, tags } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { attachTags, seedGroupWithMembership, seedItem, seedTag, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { bearer, e2eAuth } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

async function setup() {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const app = createApp({ db: testDb, auth: e2eAuth })
  const auth = await bearer(userId)
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", authorization: auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { groupId, call }
}

// 並行する 2 要求の勝ち負けは毎回変わるので、どちらが先でも成り立つ不変条件を繰り返し確かめる
const ROUNDS = 15

test("PUT against tag delete never leaves an item_tags row for a deleted tag", async () => {
  const { groupId, call } = await setup()

  for (let i = 0; i < ROUNDS; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const itemId = await seedItem(groupId, `item-${i}`)
    // oxlint-disable-next-line no-await-in-loop
    const tagId = await seedTag(groupId, `tag-${i}`)

    // oxlint-disable-next-line no-await-in-loop
    const [put, del] = await Promise.all([
      call("PUT", `/v1/items/${itemId}/tags`, { tagIds: [tagId] }),
      call("DELETE", `/v1/tags/${tagId}`),
    ])

    expect(del.status).toBe(204)
    expect([200, 422]).toContain(put.status)
  }

  const stray = await testDb
    .select({ tagId: itemTags.tagId })
    .from(itemTags)
    .innerJoin(tags, eq(tags.id, itemTags.tagId))
    .where(sql`${tags.deletedAt} IS NOT NULL`)
  expect(stray).toEqual([])
})

test("two PUTs against one item serialize: the final set is exactly one request's set", async () => {
  const { groupId, call } = await setup()
  const ids: string[] = []
  for (let i = 0; i < 20; i++) {
    // oxlint-disable-next-line no-await-in-loop
    ids.push(await seedTag(groupId, `t${i}`))
  }
  const extra = await seedTag(groupId, "extra")

  for (let i = 0; i < ROUNDS; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const itemId = await seedItem(groupId, `item-${i}`)
    // oxlint-disable-next-line no-await-in-loop
    await attachTags(itemId, ids)

    // 上限ちょうどの item に、1 件だけ入れ替える PUT と 20 件に戻す PUT を同時に流す
    const swapped = [...ids.slice(1), extra].toSorted()
    // oxlint-disable-next-line no-await-in-loop
    const [a, b] = await Promise.all([
      call("PUT", `/v1/items/${itemId}/tags`, { tagIds: swapped }),
      call("PUT", `/v1/items/${itemId}/tags`, { tagIds: ids }),
    ])
    expect([a.status, b.status]).toEqual([200, 200])

    // oxlint-disable-next-line no-await-in-loop
    const rows = await testDb.select().from(itemTags).where(eq(itemTags.itemId, itemId))
    const final = rows.map((r) => r.tagId).toSorted()
    expect(final.length).toBe(20)
    expect([swapped.join(), [...ids].toSorted().join()]).toContain(final.join())
  }
})

test("rename against delete never revives a deleted tag", async () => {
  const { groupId, call } = await setup()

  for (let i = 0; i < ROUNDS; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const tagId = await seedTag(groupId, `tag-${i}`)

    // oxlint-disable-next-line no-await-in-loop
    const [rename, del] = await Promise.all([
      call("PATCH", `/v1/tags/${tagId}`, { name: `renamed-${i}` }),
      call("DELETE", `/v1/tags/${tagId}`),
    ])

    expect(del.status).toBe(204)
    expect([200, 404]).toContain(rename.status)
    // oxlint-disable-next-line no-await-in-loop
    const [row] = await testDb.select().from(tags).where(eq(tags.id, tagId))
    expect(row?.deletedAt).not.toBeNull()
  }
})

test("two renames to the same name: one succeeds, the other is TAG_NAME_DUPLICATE", async () => {
  const { groupId, call } = await setup()

  for (let i = 0; i < ROUNDS; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const a = await seedTag(groupId, `a-${i}`)
    // oxlint-disable-next-line no-await-in-loop
    const b = await seedTag(groupId, `b-${i}`)

    // oxlint-disable-next-line no-await-in-loop
    const [ra, rb] = await Promise.all([
      call("PATCH", `/v1/tags/${a}`, { name: `same-${i}` }),
      call("PATCH", `/v1/tags/${b}`, { name: `same-${i}` }),
    ])

    expect([ra.status, rb.status].toSorted()).toEqual([200, 422])
    const loser = ra.status === 422 ? ra : rb
    // oxlint-disable-next-line no-await-in-loop
    expect(((await loser.json()) as { error: { code: string } }).error.code).toBe(
      "TAG_NAME_DUPLICATE",
    )
  }
})

test("two creates of the same name: one 201, one TAG_NAME_DUPLICATE", async () => {
  const { groupId, call } = await setup()

  for (let i = 0; i < ROUNDS; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const [a, b] = await Promise.all([
      call("POST", "/v1/tags", { groupId, name: `dup-${i}` }),
      call("POST", "/v1/tags", { groupId, name: `ＤＵＰ-${i}` }),
    ])
    expect([a.status, b.status].toSorted()).toEqual([201, 422])
  }
})

test("tag delete against PUTs on its attached and new items never deadlocks or leaves stray rows", async () => {
  const { groupId, call } = await setup()

  for (let i = 0; i < ROUNDS; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const tagId = await seedTag(groupId, `tag-${i}`)
    // oxlint-disable-next-line no-await-in-loop
    const a = await seedItem(groupId, `a-${i}`)
    // oxlint-disable-next-line no-await-in-loop
    const b = await seedItem(groupId, `b-${i}`)
    // oxlint-disable-next-line no-await-in-loop
    const c = await seedItem(groupId, `c-${i}`)
    // oxlint-disable-next-line no-await-in-loop
    await attachTags(a, [tagId])
    // oxlint-disable-next-line no-await-in-loop
    await attachTags(b, [tagId])

    // 付いている item の外し (a) と、新しく付ける (c) を、削除と同時に流す
    // oxlint-disable-next-line no-await-in-loop
    const res = await Promise.all([
      call("DELETE", `/v1/tags/${tagId}`),
      call("PUT", `/v1/items/${a}/tags`, { tagIds: [] }),
      call("PUT", `/v1/items/${c}/tags`, { tagIds: [tagId] }),
    ])

    expect(res[0].status).toBe(204)
    expect([200]).toContain(res[1].status)
    expect([200, 422]).toContain(res[2].status)
    // oxlint-disable-next-line no-await-in-loop
    const rows = await testDb.select().from(itemTags).where(eq(itemTags.tagId, tagId))
    expect(rows).toEqual([])
  }
})
