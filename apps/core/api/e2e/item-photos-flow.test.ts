import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { createDb, itemPhotos, itemTags, items as itemsTable } from "@prep-hamster/db"
import { PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema"
import { exitCodeFor } from "../src/jobs/photo-sweep"
import { LATE_UPLOAD_WINDOW_MS, photoPath } from "../src/photos/config"
import {
  claimPhoto,
  discardUploaded,
  markReady,
  removeObjectOf,
  removeObjectsOf,
  signPaths,
  sweepPhotos,
} from "../src/photos/service"
import { bearer } from "./auth-helper"
import type { FakePhotoStorage } from "./fake-photo-storage"
import { insertPhotoRow, jpeg, setupPhotos } from "./photo-helper"
import { attachTags, seedGroupWithMembership, seedItem, seedTag, seedUser } from "./seed"
import { ensureMigrated, TEST_DB_URL, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const json = async (res: Response) => (await res.json()) as any
const MIN = 60 * 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const rowOf = async (photoId: string) => {
  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  return row
}

// n 本の upload が Storage に着くまで待たせ、release で一斉に進める (Storage が遅い状況)
function gateUploads(fake: FakePhotoStorage, n: number) {
  const gate = Promise.withResolvers<void>()
  const reached = Promise.withResolvers<void>()
  let count = 0
  fake.control.uploadGate = gate.promise
  fake.control.onUploadReached = () => {
    if (++count >= n) reached.resolve()
  }
  return { release: () => gate.resolve(), reached: reached.promise }
}

// DB に開きっぱなしの transaction (idle in transaction) が無いこと。Storage を呼ぶ瞬間に見る
const openTransactions = async () => {
  const rows = (await testDb.execute(
    sql`select count(*)::int as n from pg_stat_activity
        where state like 'idle in transaction%' and datname = current_database()`,
  )) as unknown as Array<{ n: number }>
  return rows[0]?.n ?? 0
}

// 別の接続が行を押さえている間、prefix で始まる文が lock の待ちに入るのを待つ。入らなければ失敗にする
// (待ちを見ないまま lock を離すと、競合を作れておらず、壊しても通るテストになる)
async function waitForLockWait(prefix: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    const rows = (await testDb.execute(
      sql`select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and datname = current_database()
            and query ilike ${`${prefix}%`}`,
    )) as unknown as Array<{ n: number }>
    if ((rows[0]?.n ?? 0) >= 1) return
    // oxlint-disable-next-line no-await-in-loop
    await sleep(50)
  }
  throw new Error(`no statement starting with ${prefix} waited on a lock within ${timeoutMs} ms`)
}

// ---- the order of the flow: row first, then the object, then ready ----

test("the row exists as pending while the object is being uploaded, and readers do not see it", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const seen: { status: string | undefined; list: unknown; covers: unknown } = {
    status: undefined,
    list: null,
    covers: null,
  }
  fake.control.onUploadReached = async () => {
    seen.status = (await rowOf(photoId))?.status
    seen.list = (await json(await owner.req("GET", `/v1/items/${itemId}/photos`))).photos
    seen.covers = (await json(await owner.req("GET", `/v1/items/photos?groupId=${groupId}`))).covers
  }

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(201)
  expect(seen).toEqual({ status: "pending", list: [], covers: [] })
  expect((await rowOf(photoId))?.status).toBe("ready")
})

test("no database transaction is open while Storage is called: upload, remove and signing", async () => {
  const { fake, upload, owner, itemId } = await setupPhotos()
  const open: Record<string, number> = {}
  fake.control.beforeCall = async (op) => {
    open[op] = Math.max(open[op] ?? 0, await openTransactions())
  }
  const photoId = crypto.randomUUID()

  await upload(itemId, { photoId })
  await owner.req("GET", `/v1/items/${itemId}/photos`)
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  await upload(itemId, { bytes: jpeg(200, 3) })
  await owner.req("DELETE", `/v1/items/${itemId}`)

  expect(Object.keys(open).toSorted()).toEqual(["remove", "sign", "upload"])
  expect(open).toEqual({ upload: 0, remove: 0, sign: 0 })
})

test("no connection is held across the upload: with a single database connection a tag PUT still completes", async () => {
  const single = createDb(TEST_DB_URL, { max: 1 })
  const { fake, upload, app, ownerId, itemId } = await setupPhotos({ db: single })
  const gate = gateUploads(fake, 1)

  const pending = upload(itemId)
  let put: number | "blocked"
  try {
    await gate.reached
    put = await Promise.race([
      Promise.resolve(
        app.request(`/v1/items/${itemId}/tags`, {
          method: "PUT",
          headers: { "content-type": "application/json", authorization: await bearer(ownerId) },
          body: JSON.stringify({ tagIds: [] }),
        }),
      ).then((r) => r.status),
      sleep(3000).then(() => "blocked" as const),
    ])
  } finally {
    gate.release()
  }
  const res = await pending

  expect(put).toBe(200)
  expect(res.status).toBe(201)
})

test("createDb with max 1 really allows one connection at a time", async () => {
  const single = createDb(TEST_DB_URL, { max: 1 })
  const hold = Promise.withResolvers<void>()
  const taken = Promise.withResolvers<void>()
  const holder = single.transaction(async (tx) => {
    await tx.execute(sql`select 1`)
    taken.resolve()
    await hold.promise
  })
  await taken.promise

  const second = await Promise.race([
    single.execute(sql`select 1`).then(() => "ran" as const),
    sleep(300).then(() => "blocked" as const),
  ])
  hold.resolve()
  await holder

  expect(second).toBe("blocked")
})

// ---- a failed upload leaves a pending row, and the retry continues from it ----

test("a failed upload leaves a pending row that readers do not see; the same photoId continues it", async () => {
  const { fake, upload, owner, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  const failed = await upload(itemId, { photoId, bytes: jpeg(300) })
  expect(failed.status).toBe(502)
  expect((await rowOf(photoId))?.status).toBe("pending")
  expect((await json(await owner.req("GET", `/v1/items/${itemId}/photos`))).photos).toEqual([])
  fake.control.failUpload = false

  const retry = await upload(itemId, { photoId, bytes: jpeg(300) })

  expect(retry.status).toBe(200)
  expect((await json(retry)).photo.id).toBe(photoId)
  expect((await rowOf(photoId))?.status).toBe("ready")
  expect(await testDb.select().from(itemPhotos)).toHaveLength(1)
  expect(fake.callsOf("upload")).toHaveLength(2)
})

test("a retry of a pending row with another size or for another item is 422 and keeps the row", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId, bytes: jpeg(300) })
  fake.control.failUpload = false

  const size = await upload(itemId, { photoId, bytes: jpeg(301) })
  const item = await upload(other, { photoId, bytes: jpeg(300) })

  for (const res of [size, item]) {
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  }
  const row = await rowOf(photoId)
  expect(row).toMatchObject({ status: "pending", itemId, byteSize: 300 })
})

test("a retry with other dimensions is 422 IDEMPOTENCY_KEY_REUSED, for a pending row and for a ready row", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  const pending = crypto.randomUUID()
  const ready = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId: pending, width: "100", height: "200" })
  fake.control.failUpload = false
  await upload(itemId, { photoId: ready, bytes: jpeg(1000, 2), width: "100", height: "200" })

  const results = [
    await upload(itemId, { photoId: pending, width: "101", height: "200" }),
    await upload(itemId, { photoId: pending, width: "100", height: "201" }),
    await upload(itemId, { photoId: pending, width: "100" }),
    await upload(itemId, { photoId: ready, bytes: jpeg(1000, 2), width: "100", height: "201" }),
  ]

  for (const res of results) {
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  }
  expect(await upload(itemId, { photoId: pending, width: "100", height: "200" })).toMatchObject({
    status: 200,
  })
})

test("pending rows count toward the cap, and a full item uploads nothing", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  fake.control.failUpload = true
  for (let i = 0; i < 5; i++) {
    // oxlint-disable-next-line no-await-in-loop
    expect((await upload(itemId, { bytes: jpeg(100, i + 2) })).status).toBe(502)
  }
  const uploads = fake.callsOf("upload").length

  const res = await upload(itemId)

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("PHOTO_LIMIT_EXCEEDED")
  expect(fake.callsOf("upload")).toHaveLength(uploads)
})

test("a retry of a pending row counts as its latest activity", async () => {
  let t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos({ now: () => t })
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId })
  const first = (await rowOf(photoId))?.updatedAt.getTime() ?? 0
  t += 5 * MIN

  await upload(itemId, { photoId })

  const second = (await rowOf(photoId))?.updatedAt.getTime() ?? 0
  expect(second - first).toBe(5 * MIN)
})

test("identical concurrent uploads: one row, one ready photo, both succeed, nothing is removed", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  const gate = gateUploads(fake, 2)
  const photoId = crypto.randomUUID()

  const p1 = upload(itemId, { photoId, bytes: jpeg(300) })
  const p2 = upload(itemId, { photoId, bytes: jpeg(300) })
  await gate.reached
  gate.release()
  const statuses = (await Promise.all([p1, p2])).map((r) => r.status).toSorted()

  expect(statuses).toEqual([200, 201])
  expect(await testDb.select().from(itemPhotos)).toHaveLength(1)
  expect((await rowOf(photoId))?.status).toBe("ready")
  expect(fake.objects.size).toBe(1)
  expect(fake.callsOf("remove")).toEqual([])
})

test("two uploads at the cap minus one: exactly one is accepted, and the loser never touches Storage", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  for (let i = 0; i < PHOTOS_PER_ITEM_MAX - 1; i++) {
    // oxlint-disable-next-line no-await-in-loop
    await upload(itemId, { bytes: jpeg(100, i + 10) })
  }
  const before = fake.callsOf("upload").length
  const gate = gateUploads(fake, 1)

  const pa = upload(itemId, { bytes: jpeg(100, 2) })
  const pb = upload(itemId, { bytes: jpeg(100, 3) })
  await gate.reached
  gate.release()
  const statuses = (await Promise.all([pa, pb])).map((r) => r.status).toSorted()

  expect(statuses).toEqual([201, 422])
  expect(fake.callsOf("upload")).toHaveLength(before + 1)
  expect(await testDb.select().from(itemPhotos)).toHaveLength(PHOTOS_PER_ITEM_MAX)
})

// ---- the row is deleted while the object is being uploaded ----

test("an item deleted during the upload: 404, and the object that was just put is removed", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.control.afterUploadStored = async () => {
    fake.control.afterUploadStored = null
    expect((await owner.req("DELETE", `/v1/items/${itemId}`)).status).toBe(204)
  }

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(404)
  expect((await json(res)).error.message).toBe("写真が見つかりません")
  expect((await rowOf(photoId))?.deletedAt).toBeInstanceOf(Date)
  expect(fake.objects.has(path)).toBe(false)
  expect(await testDb.select().from(itemPhotos).where(eq(itemPhotos.status, "ready"))).toEqual([])
})

test("a stale-pending sweep during a slow upload takes the row: the upload ends in 404 and removes its object", async () => {
  let t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId, groupId } = await setupPhotos({ now: () => t })
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.control.afterUploadStored = async () => {
    fake.control.afterUploadStored = null
    // 要求が止まっている間に 21 分が経ち、sweep が回る
    t += 21 * MIN
    const swept = await sweepPhotos(testDb, fake.storage, () => t)
    expect(swept.staleClaimed).toBe(1)
  }

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(404)
  expect(fake.objects.has(path)).toBe(false)
  expect((await rowOf(photoId))?.status).toBe("pending")
  expect((await rowOf(photoId))?.deletedAt).toBeInstanceOf(Date)
})

test("when the object of a deleted row cannot be removed, the row goes back to pending removal for the sweep", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.control.afterUploadStored = async () => {
    fake.control.afterUploadStored = null
    fake.control.failRemove = true
    await owner.req("DELETE", `/v1/items/${itemId}`)
    // 削除の側の片付けが済んだ後 (storage_deleted_at が立った後) に置かれた object を、自分も消せない
    await testDb
      .update(itemPhotos)
      .set({ storageDeletedAt: new Date() })
      .where(eq(itemPhotos.id, photoId))
  }

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(404)
  expect(fake.objects.has(path)).toBe(true)
  expect((await rowOf(photoId))?.storageDeletedAt).toBeNull()
})

test("an upload that fails after the object was stored removes it when the item was deleted in between", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.control.afterUploadStored = async () => {
    fake.control.afterUploadStored = null
    await owner.req("DELETE", `/v1/items/${itemId}`)
    // 削除の側の片付けは object が着く前に済んだ扱いで (storage_deleted_at が立つ)、object は遅れて着く
    await testDb
      .update(itemPhotos)
      .set({ storageDeletedAt: new Date() })
      .where(eq(itemPhotos.id, photoId))
    fake.put(path)
    throw new Error("socket closed after the object was stored")
  }

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(502)
  expect(fake.objects.has(path)).toBe(false)
})

test("an upload that fails after the object was stored leaves it alone while the row is alive", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.control.afterUploadStored = async () => {
    fake.control.afterUploadStored = null
    throw new Error("socket closed after the object was stored")
  }

  expect((await upload(itemId, { photoId })).status).toBe(502)
  expect(fake.objects.has(path)).toBe(true)
  expect(fake.callsOf("remove")).toEqual([])

  // 同じ photoId の送り直しがそのまま続けて ready にする
  expect((await upload(itemId, { photoId })).status).toBe(200)
  expect((await rowOf(photoId))?.status).toBe("ready")
})

test("a late removal result does not overwrite a row that went back to pending removal", async () => {
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 10 })
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: new Date(), updatedAt: new Date("2026-11-22T00:00:00Z") })
    .where(eq(itemPhotos.id, photoId))
  const seen = (await rowOf(photoId))!
  // removeObjectOf が Storage を呼んでいる間に、discardUploaded が行を削除待ちに戻す
  fake.control.beforeCall = async () => {
    fake.control.beforeCall = null
    fake.control.failRemove = false
    await testDb
      .update(itemPhotos)
      .set({ storageDeletedAt: new Date() })
      .where(eq(itemPhotos.id, photoId))
    fake.control.failRemove = true
    await discardUploaded(testDb, fake.storage, seen, () => Date.parse("2026-11-22T00:00:00Z"))
    fake.control.failRemove = false
  }

  const r = await removeObjectOf(testDb, fake.storage, seen, () => Date.now())

  expect(r).toBe("requeued")
  const row = await rowOf(photoId)
  expect(row?.storageDeletedAt).toBeNull()
  expect(row!.updatedAt.getTime()).toBeGreaterThan(seen.updatedAt.getTime())
})

test("removeObjectsOf counts a row that went back to pending removal as requeued, not removed", async () => {
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const [requeuedId, doneId] = [crypto.randomUUID(), crypto.randomUUID()]
  for (const id of [requeuedId, doneId]) {
    // oxlint-disable-next-line no-await-in-loop
    await insertPhotoRow(testDb, { id, groupId, itemId, userId: ownerId, size: 10 })
  }
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: new Date(), updatedAt: new Date("2026-11-22T00:00:00Z") })
  const rows = await testDb.select().from(itemPhotos)
  fake.control.beforeCall = async () => {
    fake.control.beforeCall = null
    await testDb
      .update(itemPhotos)
      .set({ updatedAt: new Date("2026-11-22T00:00:01Z") })
      .where(eq(itemPhotos.id, requeuedId))
  }

  const r = await removeObjectsOf(testDb, fake.storage, rows, () => Date.now())

  expect(r).toEqual({ removed: 1, requeued: 1, failed: 0 })
  expect((await rowOf(requeuedId))?.storageDeletedAt).toBeNull()
  expect((await rowOf(doneId))?.storageDeletedAt).not.toBeNull()
})

test("the same new photoId used at once on two items: one wins, the other is 422 IDEMPOTENCY_KEY_REUSED", async () => {
  const { fake, upload, itemId, groupId, ownerId } = await setupPhotos()
  const otherItem = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  // 相手の claim が INSERT まで進み、まだ commit していない状態を作る
  const held = Promise.withResolvers<void>()
  const inserted = Promise.withResolvers<void>()
  const other = testDb.transaction(async (tx) => {
    await insertPhotoRow(tx, {
      id: photoId,
      groupId,
      itemId: otherItem,
      userId: ownerId,
      size: jpeg().length,
      status: "pending",
    })
    inserted.resolve()
    await held.promise
  })
  await inserted.promise
  const mine = upload(itemId, { photoId })
  // こちらの INSERT が主キーの待ちに入るのを待つ
  try {
    await waitForLockWait(`insert into "item_photos"`)
  } finally {
    held.resolve()
    await Promise.allSettled([other, mine])
  }

  const res = await mine

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  expect(fake.calls).toEqual([])
  expect((await rowOf(photoId))?.itemId).toBe(otherItem)
})

test("a retry whose pending row became ready between the probe and the touch is existing, not reused", async () => {
  const { itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, {
    id: photoId,
    groupId,
    itemId,
    userId: ownerId,
    size: 100,
    status: "pending",
  })
  const held = Promise.withResolvers<void>()
  const marked = Promise.withResolvers<void>()
  const other = testDb.transaction(async (tx) => {
    await tx.update(itemPhotos).set({ status: "ready" }).where(eq(itemPhotos.id, photoId))
    marked.resolve()
    await held.promise
  })
  await marked.promise

  const claiming = claimPhoto(
    testDb,
    {
      groupId,
      itemId,
      byteSize: 100,
      photoId,
      userId: ownerId,
      storagePath: photoPath(groupId, photoId),
      width: null,
      height: null,
    },
    () => Date.now(),
  )
  try {
    await waitForLockWait(`update "item_photos"`)
  } finally {
    held.resolve()
    await Promise.allSettled([other, claiming])
  }

  const claim = await claiming
  expect(claim.kind).toBe("existing")
  expect(claim.kind === "existing" && claim.row.status).toBe("ready")
})

test("a retry whose row is soft-deleted between the probe and the touch is not reported as existing", async () => {
  const { itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, {
    id: photoId,
    groupId,
    itemId,
    userId: ownerId,
    size: 100,
    status: "pending",
  })
  const held = Promise.withResolvers<void>()
  const deleted = Promise.withResolvers<void>()
  const deleter = testDb.transaction(async (tx) => {
    await tx.update(itemPhotos).set({ deletedAt: new Date() }).where(eq(itemPhotos.id, photoId))
    deleted.resolve()
    await held.promise
  })
  await deleted.promise

  const claiming = claimPhoto(
    testDb,
    {
      groupId,
      itemId,
      byteSize: 100,
      photoId,
      userId: ownerId,
      storagePath: photoPath(groupId, photoId),
      width: null,
      height: null,
    },
    () => Date.now(),
  )
  try {
    await waitForLockWait(`update "item_photos"`)
  } finally {
    held.resolve()
    await Promise.allSettled([deleter, claiming])
  }

  expect((await claiming).kind).toBe("reused")
})

test("deleting an item stamps its photos with the photo clock", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { upload, owner, itemId } = await setupPhotos({ now: () => t })
  const photoId = crypto.randomUUID()
  expect((await upload(itemId, { photoId })).status).toBe(201)

  expect((await owner.req("DELETE", `/v1/items/${itemId}`)).status).toBe(204)

  const row = await rowOf(photoId)
  expect(row?.deletedAt?.getTime()).toBe(t)
  expect(row?.updatedAt.getTime()).toBe(t)
})

test("deleting an item takes its photo rows before its tag rows, so a writer holding a photo and wanting the tags does not deadlock with it", async () => {
  const { upload, owner, itemId, groupId } = await setupPhotos()
  await attachTags(itemId, [await seedTag(groupId, "t")])
  const photoId = crypto.randomUUID()
  expect((await upload(itemId, { photoId })).status).toBe(201)
  const held = Promise.withResolvers<void>()
  const locked = Promise.withResolvers<void>()
  const other = testDb.transaction(async (tx) => {
    await tx.execute(sql`select 1 from item_photos where id = ${photoId} for update`)
    locked.resolve()
    await held.promise
    await tx.delete(itemTags).where(eq(itemTags.itemId, itemId))
  })
  await locked.promise
  const deleting = Promise.resolve(owner.req("DELETE", `/v1/items/${itemId}`))
  let settled: PromiseSettledResult<unknown>[] = []
  try {
    await waitForLockWait(`update "item_photos"`)
  } finally {
    held.resolve()
    settled = await Promise.allSettled([other, deleting])
  }

  const [otherResult, deleteResult] = settled as [
    PromiseSettledResult<void>,
    PromiseSettledResult<Response>,
  ]

  expect(otherResult.status).toBe("fulfilled")
  expect(deleteResult.status === "fulfilled" && deleteResult.value.status).toBe(204)
})

test("the removal is recorded with the time it started, so a response that returns after the late-upload window does not make it final", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 10 })
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: new Date(t), updatedAt: new Date(t) })
    .where(eq(itemPhotos.id, photoId))
  const path = photoPath(groupId, photoId)
  fake.put(path)
  const startedAt = t + LATE_UPLOAD_WINDOW_MS - 1000
  let clock = startedAt
  // the removal call itself takes longer than what is left of the window
  fake.control.beforeCall = () => {
    clock = t + LATE_UPLOAD_WINDOW_MS + 5000
  }

  const first = await sweepPhotos(testDb, fake.storage, () => clock)

  expect(first.removed).toBe(1)
  expect((await rowOf(photoId))?.storageDeletedAt?.getTime()).toBe(startedAt)
  // an upload that was still in flight puts its object after the removal took effect
  fake.put(path)
  fake.control.beforeCall = null
  const second = await sweepPhotos(testDb, fake.storage, () => clock)
  expect(second.removed).toBe(1)
  expect(fake.objects.has(path)).toBe(false)
})

test("deleting an item stamps its photos with the clock read after the item lock was taken", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  let clock = t
  const { upload, owner, itemId } = await setupPhotos({ now: () => clock })
  const photoId = crypto.randomUUID()
  expect((await upload(itemId, { photoId })).status).toBe(201)
  const held = Promise.withResolvers<void>()
  const locked = Promise.withResolvers<void>()
  const other = testDb.transaction(async (tx) => {
    await tx.execute(sql`select 1 from items where id = ${itemId} for update`)
    locked.resolve()
    await held.promise
  })
  await locked.promise
  const deleting = Promise.resolve(owner.req("DELETE", `/v1/items/${itemId}`))
  let result: PromiseSettledResult<unknown>[] = []
  try {
    await waitForLockWait(`select "id" from "items"`)
    // time passes while the delete waits for the lock
    clock = t + 60 * MIN
  } finally {
    held.resolve()
    result = await Promise.allSettled([deleting, other])
  }

  expect(result[0]?.status === "fulfilled" && (result[0].value as Response).status).toBe(204)
  expect((await rowOf(photoId))?.deletedAt?.getTime()).toBe(t + 60 * MIN)
})

test("removeObjectsOf makes one Storage call per 100 rows, and a failed call fails only its rows", async () => {
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const ids = Array.from({ length: 101 }, () => crypto.randomUUID())
  for (const id of ids) {
    // oxlint-disable-next-line no-await-in-loop
    await insertPhotoRow(testDb, { id, groupId, itemId, userId: ownerId, size: 1 })
    fake.put(photoPath(groupId, id))
  }
  await testDb.update(itemPhotos).set({ deletedAt: new Date() })
  const rows = await testDb.select().from(itemPhotos).orderBy(itemPhotos.id)
  const origRemove = fake.storage.remove
  let call = 0
  fake.storage.remove = async (paths) => {
    // the second call (the 101st row alone) fails
    if (++call === 2) throw new Error("storage down")
    return origRemove(paths)
  }

  const r = await removeObjectsOf(testDb, fake.storage, rows, () => Date.now())

  expect(r).toEqual({ removed: 100, requeued: 0, failed: 1 })
  expect(call).toBe(2)
  const done = await testDb
    .select()
    .from(itemPhotos)
    .where(sql`storage_deleted_at is not null`)
  expect(done).toHaveLength(100)
})

test("deleting an item with several photos removes all their objects in one Storage call", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  for (const photoId of ids) {
    // oxlint-disable-next-line no-await-in-loop
    expect((await upload(itemId, { photoId })).status).toBe(201)
  }

  expect((await owner.req("DELETE", `/v1/items/${itemId}`)).status).toBe(204)

  const removes = fake.callsOf("remove")
  expect(removes).toHaveLength(1)
  expect(removes[0]?.paths.toSorted()).toEqual(ids.map((id) => photoPath(groupId, id)).toSorted())
  expect(
    await testDb
      .select()
      .from(itemPhotos)
      .where(sql`storage_deleted_at is null`),
  ).toEqual([])
})

// A concurrent writer holds the row (uncommitted) while the sweep's claiming UPDATE waits for the lock; it then commits `change`.
// The sweep's subquery result is fixed at statement start, so only the outer conditions can notice the change
async function sweepWhileRowHeld(change: Partial<typeof itemPhotos.$inferInsert>) {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId })
  await agePending(photoId, new Date(t - 21 * MIN))
  const held = Promise.withResolvers<void>()
  const touched = Promise.withResolvers<void>()
  const writer = testDb.transaction(async (tx) => {
    await tx.update(itemPhotos).set(change).where(eq(itemPhotos.id, photoId))
    touched.resolve()
    await held.promise
  })
  await touched.promise

  const sweeping = sweepPhotos(testDb, fake.storage, () => t)
  try {
    await waitForLockWait(`update "item_photos"`)
  } finally {
    held.resolve()
    await Promise.allSettled([writer, sweeping])
  }
  const result = await sweeping
  return { result, row: await rowOf(photoId), fake }
}

test("the sweep leaves a pending row that a retry touched while the sweep waited for the row lock", async () => {
  const { result, row } = await sweepWhileRowHeld({ updatedAt: new Date("2026-11-22T00:00:00Z") })

  expect(result.staleClaimed).toBe(0)
  expect(row?.deletedAt).toBeNull()
})

test("the sweep leaves a stale row that became ready while the sweep waited for the row lock", async () => {
  const { result, row, fake } = await sweepWhileRowHeld({ status: "ready" })

  expect(result.staleClaimed).toBe(0)
  expect(row?.status).toBe("ready")
  expect(row?.deletedAt).toBeNull()
  expect(fake.callsOf("remove")).toEqual([])
})

test("the sweep does not re-delete a stale row that was deleted while the sweep waited for the row lock", async () => {
  const deletedAt = new Date("2026-11-21T23:59:00Z")
  const { result, row } = await sweepWhileRowHeld({ deletedAt })

  expect(result.staleClaimed).toBe(0)
  expect(row?.deletedAt?.getTime()).toBe(deletedAt.getTime())
})

test("discardUploaded survives a database failure while it hands the row back", async () => {
  const { fake } = await setupPhotos()
  const brokenDb = {
    update: () => {
      throw new Error("connection lost")
    },
  } as never
  fake.put("g/p.jpg")
  fake.control.failRemove = true

  await expect(
    discardUploaded(brokenDb, fake.storage, { id: "p", storagePath: "g/p.jpg" }, () => Date.now()),
  ).resolves.toBeUndefined()
})

// ---- the claim and markReady ----

test("claimPhoto answers gone, limit, reused, existing and created from one short transaction", async () => {
  const { itemId, groupId, ownerId } = await setupPhotos()
  const input = (photoId: string, over: Partial<{ itemId: string; byteSize: number }> = {}) => ({
    groupId,
    itemId: over.itemId ?? itemId,
    byteSize: over.byteSize ?? 100,
    photoId,
    userId: ownerId,
    storagePath: photoPath(groupId, photoId),
    width: null,
    height: null,
  })
  const a = crypto.randomUUID()

  expect((await claimPhoto(testDb, input(a), Date.now)).kind).toBe("created")
  expect((await claimPhoto(testDb, input(a), Date.now)).kind).toBe("existing")
  expect((await claimPhoto(testDb, input(a, { byteSize: 101 }), Date.now)).kind).toBe("reused")
  expect((await claimPhoto(testDb, input(crypto.randomUUID()), Date.now, 1)).kind).toBe("limit")
  expect((await claimPhoto(testDb, input(a), Date.now, 1)).kind).toBe("existing")
  expect(
    (
      await claimPhoto(
        testDb,
        input(crypto.randomUUID(), { itemId: crypto.randomUUID() }),
        Date.now,
      )
    ).kind,
  ).toBe("gone")
})

test("a claim that finds the item deleted in the meantime answers 404 without touching Storage", async () => {
  // claim の transaction が始まる直前に item が削除される
  const racing = new Proxy(testDb, {
    get(target, prop) {
      if (prop === "transaction") {
        return async (fn: never, cfg?: never) => {
          await target.update(itemsTable).set({ deletedAt: new Date() })
          return target.transaction(fn, cfg)
        }
      }
      const v = Reflect.get(target, prop, target)
      return typeof v === "function" ? v.bind(target) : v
    },
  }) as typeof testDb
  const { fake, upload, itemId } = await setupPhotos({ db: racing })

  const res = await upload(itemId, {})

  expect(res.status).toBe(404)
  expect(fake.calls).toEqual([])
  expect(await testDb.select().from(itemPhotos)).toEqual([])
})

test("claimPhoto: a row of the same item and size in another group is reused, a deleted item is gone, a ready row is not touched", async () => {
  let t = Date.parse("2026-11-22T00:00:00Z")
  const { itemId, groupId, ownerId } = await setupPhotos()
  const otherGroup = await seedGroupWithMembership(ownerId, "B")
  const input = (photoId: string, over: { groupId?: string; itemId?: string } = {}) => ({
    groupId: over.groupId ?? groupId,
    itemId: over.itemId ?? itemId,
    byteSize: 100,
    photoId,
    userId: ownerId,
    storagePath: photoPath(groupId, photoId),
    width: null,
    height: null,
  })
  const a = crypto.randomUUID()
  const created = await claimPhoto(testDb, input(a), () => t)
  expect(created.kind).toBe("created")
  expect((await rowOf(a))?.createdAt.getTime()).toBe(t)
  expect((await rowOf(a))?.updatedAt.getTime()).toBe(t)

  const otherGroupClaim = await claimPhoto(testDb, input(a, { groupId: otherGroup }), () => t)
  expect(otherGroupClaim.kind).toBe("reused")

  await testDb.update(itemPhotos).set({ status: "ready" }).where(eq(itemPhotos.id, a))
  t += 5 * MIN
  const again = await claimPhoto(testDb, input(a), () => t)
  expect(again.kind).toBe("existing")
  expect((await rowOf(a))?.updatedAt.getTime()).toBe(t - 5 * MIN)

  await testDb.update(itemsTable).set({ deletedAt: new Date() }).where(eq(itemsTable.id, itemId))
  expect((await claimPhoto(testDb, input(crypto.randomUUID()), () => t)).kind).toBe("gone")
})

test("markReady leaves a ready row as it is, and a ready row that was deleted is gone", async () => {
  const { itemId, groupId, ownerId } = await setupPhotos()
  const ready = crypto.randomUUID()
  const readyDeleted = crypto.randomUUID()
  await insertPhotoRow(testDb, { id: ready, groupId, itemId, userId: ownerId, size: 5 })
  await insertPhotoRow(testDb, { id: readyDeleted, groupId, itemId, userId: ownerId, size: 5 })
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: new Date() })
    .where(eq(itemPhotos.id, readyDeleted))
  const before = (await rowOf(ready))?.updatedAt.getTime()

  expect((await markReady(testDb, ready, () => before! + 10 * MIN)).kind).toBe("ready")
  expect((await markReady(testDb, readyDeleted, Date.now)).kind).toBe("gone")
  expect((await rowOf(ready))?.updatedAt.getTime()).toBe(before)
})

test("sweep takes at most 500 stale pending rows per run", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const old = new Date(t - 30 * MIN)
  await testDb.insert(itemPhotos).values(
    Array.from({ length: 501 }, () => {
      const id = crypto.randomUUID()
      return {
        id,
        groupId,
        itemId,
        storagePath: photoPath(groupId, id),
        contentType: "image/jpeg",
        byteSize: 1,
        status: "pending",
        createdBy: ownerId,
        createdAt: old,
        updatedAt: old,
      }
    }),
  )

  const first = await sweepPhotos(testDb, fake.storage, () => t)
  const second = await sweepPhotos(testDb, fake.storage, () => t)

  expect(first).toEqual({ staleClaimed: 500, removed: 500, requeued: 0, failed: 0 })
  expect(second).toEqual({ staleClaimed: 1, removed: 1, requeued: 0, failed: 0 })
})

test("markReady is a no-op for a row that is already ready, deleted, or missing", async () => {
  const { itemId, groupId, ownerId } = await setupPhotos()
  const ready = crypto.randomUUID()
  const deleted = crypto.randomUUID()
  await insertPhotoRow(testDb, { id: ready, groupId, itemId, userId: ownerId, size: 5 })
  await insertPhotoRow(testDb, {
    id: deleted,
    groupId,
    itemId,
    userId: ownerId,
    size: 5,
    status: "pending",
  })
  await testDb.update(itemPhotos).set({ deletedAt: new Date() }).where(eq(itemPhotos.id, deleted))

  expect((await markReady(testDb, ready, Date.now)).kind).toBe("ready")
  expect((await markReady(testDb, deleted, Date.now)).kind).toBe("gone")
  expect((await markReady(testDb, crypto.randomUUID(), Date.now)).kind).toBe("gone")
  expect((await rowOf(deleted))?.status).toBe("pending")
})

test("the status column accepts only pending and ready", async () => {
  const { itemId, groupId, ownerId } = await setupPhotos()

  const insertDone = async () => {
    await testDb.execute(
      sql`insert into item_photos (id, group_id, item_id, storage_path, content_type, byte_size, status, created_by)
          values (${crypto.randomUUID()}, ${groupId}, ${itemId}, 'p', 'image/jpeg', 1, 'done', ${ownerId})`,
    )
  }

  await expect(insertDone()).rejects.toMatchObject({
    cause: { constraint_name: "item_photos_status_check" },
  })
})

// ---- readers ----

test("covers and the list leave pending rows out; an active item keeps its ready photo when another one is deleted", async () => {
  const { upload, owner, itemId, groupId, ownerId } = await setupPhotos()
  const second = await seedItem(groupId, "Second")
  const a = crypto.randomUUID()
  const b = crypto.randomUUID()
  await upload(itemId, { photoId: a, bytes: jpeg(100, 2) })
  await upload(itemId, { photoId: b, bytes: jpeg(100, 3) })
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${a}`)
  const onSecond = crypto.randomUUID()
  await upload(second, { photoId: onSecond, bytes: jpeg(100, 4) })
  // 先頭になりうる古い pending の行。readers が status を見なければ、これが second の cover になる
  const olderPending = crypto.randomUUID()
  await insertPhotoRow(testDb, {
    id: olderPending,
    groupId,
    itemId: second,
    userId: ownerId,
    size: 9,
    status: "pending",
  })
  await testDb
    .update(itemPhotos)
    .set({ createdAt: new Date("2020-01-01T00:00:00Z") })
    .where(eq(itemPhotos.id, olderPending))

  const { covers } = await json(await owner.req("GET", `/v1/items/photos?groupId=${groupId}`))

  expect(covers.map((c: any) => [c.itemId, c.photoId]).toSorted()).toEqual(
    [
      [itemId, b],
      [second, onSecond],
    ].toSorted(),
  )
})

test("a pending row cannot be deleted through the API", async () => {
  const { upload, owner, itemId, fake } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId })

  const res = await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)

  expect(res.status).toBe(404)
  expect((await rowOf(photoId))?.deletedAt).toBeNull()
})

test("deleting an item soft-deletes its pending rows as well", async () => {
  const { upload, owner, itemId, fake } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId })

  await owner.req("DELETE", `/v1/items/${itemId}`)

  expect((await rowOf(photoId))?.deletedAt).toBeInstanceOf(Date)
})

test("signing is split into chunks of 100 paths", async () => {
  const { fake } = await setupPhotos()
  const paths = Array.from({ length: 250 }, (_, i) => `g/${i}.jpg`)
  for (const p of paths) fake.put(p)

  const urls = await signPaths(fake.storage, paths)

  expect(urls.size).toBe(250)
  expect(fake.callsOf("sign").map((c) => c.paths.length)).toEqual([100, 100, 50])
})

test("a cover needs the item to belong to the group the photo row names", async () => {
  const { fake, itemId, ownerId, as } = await setupPhotos()
  const strangerId = await seedUser()
  const strangerGroup = await seedGroupWithMembership(strangerId, "S")
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, {
    id: photoId,
    groupId: strangerGroup,
    itemId,
    userId: ownerId,
    size: 10,
  })
  fake.put(photoPath(strangerGroup, photoId))
  const stranger = await as(strangerId)

  const res = await stranger.req("GET", `/v1/items/photos?groupId=${strangerGroup}`)

  expect(await json(res)).toEqual({ covers: [] })
})

// ---- sweep ----

const agePending = (photoId: string, at: Date) =>
  testDb.update(itemPhotos).set({ updatedAt: at }).where(eq(itemPhotos.id, photoId))

test("sweep takes a pending row that has been quiet for 20 minutes, removes its object, and marks the removal done", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.control.failUpload = true
  await upload(itemId, { photoId })
  fake.control.failUpload = false
  fake.put(path)
  await agePending(photoId, new Date(t - 21 * MIN))

  const result = await sweepPhotos(testDb, fake.storage, () => t)

  expect(result).toEqual({ staleClaimed: 1, removed: 1, requeued: 0, failed: 0 })
  const row = await rowOf(photoId)
  expect(row?.deletedAt?.getTime()).toBe(t)
  expect(row?.storageDeletedAt?.getTime()).toBe(t)
  expect(fake.callsOf("remove")).toEqual([{ op: "remove", paths: [path] }])
})

test("sweep leaves a pending row quiet for less than 20 minutes, and ready rows of any age", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos()
  const fresh = crypto.randomUUID()
  const ready = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId: fresh, bytes: jpeg(100, 2) })
  fake.control.failUpload = false
  await upload(itemId, { photoId: ready, bytes: jpeg(100, 3) })
  await agePending(fresh, new Date(t - 19 * MIN))
  await agePending(ready, new Date(t - 24 * 60 * MIN))

  const result = await sweepPhotos(testDb, fake.storage, () => t)

  expect(result).toEqual({ staleClaimed: 0, removed: 0, requeued: 0, failed: 0 })
  expect((await rowOf(fresh))?.deletedAt).toBeNull()
  expect((await rowOf(ready))?.deletedAt).toBeNull()
})

test("a removal that failed is retried, and a deleted row younger than 5 minutes is left to the API's own attempt", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  fake.control.failRemove = true
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  fake.control.failRemove = false
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: new Date(t - 4 * MIN) })
    .where(eq(itemPhotos.id, photoId))

  const early = await sweepPhotos(testDb, fake.storage, () => t)
  expect(early).toEqual({ staleClaimed: 0, removed: 0, requeued: 0, failed: 0 })
  expect(fake.objects.has(photoPath(groupId, photoId))).toBe(true)

  const later = await sweepPhotos(testDb, fake.storage, () => t + 2 * MIN)
  expect(later).toEqual({ staleClaimed: 0, removed: 1, requeued: 0, failed: 0 })
  expect((await rowOf(photoId))?.storageDeletedAt).not.toBeNull()
  expect(fake.objects.size).toBe(0)

  const removesBefore = fake.callsOf("remove").length
  expect(await sweepPhotos(testDb, fake.storage, () => t + 3 * MIN)).toEqual({
    staleClaimed: 0,
    removed: 0,
    requeued: 0,
    failed: 0,
  })
  expect(fake.callsOf("remove")).toHaveLength(removesBefore)
})

// ---- the late object of a request that never got to clean up ----

const lateRow = async (status: "pending" | "ready", t: number) => {
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 10, status })
  // deleted at t, its object removed 1 s later; then a request that was still in flight put its object
  await testDb
    .update(itemPhotos)
    .set({
      deletedAt: new Date(t),
      updatedAt: new Date(t),
      storageDeletedAt: new Date(t + 1000),
    })
    .where(eq(itemPhotos.id, photoId))
  const path = photoPath(groupId, photoId)
  fake.put(path)
  return { fake, photoId, path }
}

// a ready row is included: two requests with one photoId can both continue the upload, one marks the row ready, and the other puts its object after the photo was deleted
test.each(["pending", "ready"] as const)(
  "a row deleted while %s gets its object removed again once the late-upload window has passed, and not before",
  async (status) => {
    const t = Date.parse("2026-11-22T00:00:00Z")
    const { fake, photoId, path } = await lateRow(status, t)

    const before = await sweepPhotos(testDb, fake.storage, () => t + LATE_UPLOAD_WINDOW_MS - 1000)
    expect(before).toEqual({ staleClaimed: 0, removed: 0, requeued: 0, failed: 0 })
    expect(fake.objects.has(path)).toBe(true)

    const after = await sweepPhotos(testDb, fake.storage, () => t + LATE_UPLOAD_WINDOW_MS + 1000)
    expect(after).toEqual({ staleClaimed: 0, removed: 1, requeued: 0, failed: 0 })
    expect(fake.objects.has(path)).toBe(false)
    expect((await rowOf(photoId))?.storageDeletedAt?.getTime()).toBe(
      t + LATE_UPLOAD_WINDOW_MS + 1000,
    )

    // the record made after the window is final
    fake.put(path)
    const again = await sweepPhotos(testDb, fake.storage, () => t + LATE_UPLOAD_WINDOW_MS + 5000)
    expect(again).toEqual({ staleClaimed: 0, removed: 0, requeued: 0, failed: 0 })
    expect(fake.objects.has(path)).toBe(true)
  },
)

test("a failing Storage removal is counted as failed, keeps the row pending removal, and makes the job exit non-zero", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId })
  await agePending(photoId, new Date(t - 21 * MIN))
  fake.control.failRemove = true

  const failing = await sweepPhotos(testDb, fake.storage, () => t)

  expect(failing).toEqual({ staleClaimed: 1, removed: 0, requeued: 0, failed: 1 })
  expect(exitCodeFor(failing)).toBe(1)
  expect((await rowOf(photoId))?.storageDeletedAt).toBeNull()

  fake.control.failRemove = false
  const working = await sweepPhotos(testDb, fake.storage, () => t + 6 * MIN)
  expect(working).toEqual({ staleClaimed: 0, removed: 1, requeued: 0, failed: 0 })
  expect(exitCodeFor(working)).toBe(0)
})

test("the sweep never calls Storage inside a database transaction", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId })
  await agePending(photoId, new Date(t - 21 * MIN))
  fake.control.failUpload = false
  let open = -1
  fake.control.beforeCall = async () => {
    open = Math.max(open, await openTransactions())
  }

  await sweepPhotos(testDb, fake.storage, () => t)

  expect(open).toBe(0)
})

test("the sweep job fails only on failures: nothing to do is exit 0", () => {
  expect(exitCodeFor({ staleClaimed: 3, removed: 3, requeued: 0, failed: 0 })).toBe(0)
  expect(exitCodeFor({ staleClaimed: 0, removed: 0, requeued: 0, failed: 1 })).toBe(1)
  // a requeued row is retried by the next run and is not a failure
  expect(exitCodeFor({ staleClaimed: 0, removed: 0, requeued: 2, failed: 0 })).toBe(0)
  expect(exitCodeFor({ staleClaimed: 0, removed: 0, requeued: 2, failed: 1 })).toBe(1)
})

test("a row the sweep took cannot be marked ready afterwards", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  await upload(itemId, { photoId })
  await agePending(photoId, new Date(t - 21 * MIN))
  await sweepPhotos(testDb, fake.storage, () => t)

  const res = await markReady(testDb, photoId, () => t)

  expect(res.kind).toBe("gone")
  expect((await rowOf(photoId))?.status).toBe("pending")
})

test("items table is untouched by photo claims for an item that is deleted", async () => {
  const { upload, owner, itemId } = await setupPhotos()
  await owner.req("DELETE", `/v1/items/${itemId}`)

  const res = await upload(itemId)

  expect(res.status).toBe(404)
  const [item] = await testDb.select().from(itemsTable).where(eq(itemsTable.id, itemId))
  expect(item?.deletedAt).not.toBeNull()
  expect(await testDb.select().from(itemPhotos)).toEqual([])
})
