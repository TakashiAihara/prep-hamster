import { beforeAll, beforeEach, expect, test } from "bun:test"
import { and, eq, sql } from "drizzle-orm"
import { itemPhotos } from "@prep-hamster/db"
import { PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema"
import { createApp } from "../src/app"
import { photoPath } from "../src/photos/config"
import { bearer, e2eAuth } from "./auth-helper"
import { jpeg, photoForm, setupPhotos } from "./photo-helper"
import { seedGroupWithMembership, seedItem, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const json = async (res: Response) => (await res.json()) as any

const MIB = 1024 * 1024

test("upload then list returns the photo with a signed URL; delete removes it", async () => {
  const { fake, owner, upload, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()

  const res = await upload(itemId, { photoId, bytes: jpeg(1234), width: "1280", height: "960" })

  expect(res.status).toBe(201)
  const { photo } = await json(res)
  expect(photo).toMatchObject({
    id: photoId,
    itemId,
    groupId,
    byteSize: 1234,
    width: 1280,
    height: 960,
    contentType: "image/jpeg",
    createdBy: ownerId,
  })
  expect(new Date(photo.createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000)
  expect(photo.url).toStartWith("https://storage.test/sign/")

  const list = await json(await owner.req("GET", `/v1/items/${itemId}/photos`))
  expect(list.photos.map((p: any) => p.id)).toEqual([photoId])
  expect(list.photos[0].url).toStartWith("https://storage.test/sign/")

  const del = await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  expect(del.status).toBe(204)
  const after = await json(await owner.req("GET", `/v1/items/${itemId}/photos`))
  expect(after.photos).toEqual([])
  expect(fake.objects.size).toBe(0)
})

test("what the fake recorded: bucket-relative path, content type, signing call with an expiry", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()

  await upload(itemId, { photoId, bytes: jpeg(500) })
  await owner.req("GET", `/v1/items/${itemId}/photos`)

  expect(fake.callsOf("upload")).toEqual([
    { op: "upload", path: `${groupId}/${photoId}.jpg`, contentType: "image/jpeg", size: 500 },
  ])
  expect(photoPath(groupId, photoId.toUpperCase())).toBe(`${groupId}/${photoId}.jpg`)
  const signs = fake.callsOf("sign")
  expect(signs.length).toBeGreaterThan(0)
  expect(signs.every((s) => s.expiresIn === 3600)).toBe(true)
  expect(signs.at(-1)?.paths).toEqual([`${groupId}/${photoId}.jpg`])
})

test("a non-JPEG is rejected: wrong content type, and JPEG content type with other bytes", async () => {
  const { fake, upload, itemId } = await setupPhotos()

  const png = await upload(itemId, { type: "image/png" })
  const spoof = await upload(itemId, { bytes: new Uint8Array(100).fill(7) })

  for (const res of [png, spoof]) {
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    expect((await json(res)).error.code).toBe("PHOTO_TYPE_UNSUPPORTED")
  }
  expect(fake.calls).toEqual([])
})

test("a file over the 2 MiB cap is 413 without touching the item; exactly 2 MiB is accepted", async () => {
  const { fake, upload, itemId } = await setupPhotos()

  const over = await upload(itemId, { bytes: jpeg(2 * MIB + 1) })
  expect(over.status).toBe(413)
  expect((await json(over)).error.code).toBe("PAYLOAD_TOO_LARGE")
  expect(fake.calls).toEqual([])

  const exact = await upload(itemId, { bytes: jpeg(2 * MIB) })
  expect(exact.status).toBe(201)
})

test("a body over the route limit (file cap + 64 KiB) is 413 before validation, even with a file at the cap", async () => {
  const { fake, owner, itemId } = await setupPhotos()
  const form = photoForm({ bytes: jpeg(2 * MIB) })
  form.set("junk", "x".repeat(70 * 1024))

  const res = await owner.req("POST", `/v1/items/${itemId}/photos`, form)

  expect(res.status).toBe(413)
  expect((await json(res)).error.code).toBe("PAYLOAD_TOO_LARGE")
  expect(fake.calls).toEqual([])
})

test("the higher limit applies to POST /v1/items/{id}/photos only", async () => {
  const { app, ownerId, itemId } = await setupPhotos()
  const authorization = await bearer(ownerId)
  const big = "x".repeat(MIB + 1024)

  const put = await app.request(`/v1/items/${itemId}/photos`, {
    method: "PUT",
    headers: { authorization },
    body: big,
  })
  const deeper = await app.request(`/v1/items/${itemId}/photos/extra`, {
    method: "POST",
    headers: { authorization },
    body: big,
  })

  expect(put.status).toBe(413)
  expect(deeper.status).toBe(413)
})

test("JPEG signature is checked byte by byte", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  const bad = [
    [0x00, 0xd8, 0xff],
    [0xff, 0x00, 0xff],
    [0xff, 0xd8, 0x00],
  ]

  for (const head of bad) {
    const bytes = new Uint8Array(100).fill(9)
    bytes.set(head)
    // oxlint-disable-next-line no-await-in-loop
    const res = await upload(itemId, { bytes })
    expect(res.status).toBe(422)
  }
  expect(fake.calls).toEqual([])
})

test("a signing failure answers 502 for the list and the covers, and a null url for a fresh upload", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  await upload(itemId)
  fake.control.failSign = true

  const list = await owner.req("GET", `/v1/items/${itemId}/photos`)
  const covers = await owner.req("GET", `/v1/items/photos?groupId=${groupId}`)
  const fresh = await upload(itemId, { bytes: jpeg(120, 5) })

  expect(list.status).toBe(502)
  expect(covers.status).toBe(502)
  expect((await json(list)).error.code).toBe("STORAGE_UNAVAILABLE")
  expect(fresh.status).toBe(201)
  expect((await json(fresh)).photo.url).toBeNull()
})

test("other routes keep the 1 MiB body limit", async () => {
  const { app, ownerId, groupId } = await setupPhotos()

  const res = await app.request("/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(ownerId) },
    body: JSON.stringify({ groupId, name: "x".repeat(MIB + 1) }),
  })

  expect(res.status).toBe(413)
})

test("missing file, missing photoId and bad dimensions are 422 VALIDATION_ERROR", async () => {
  const { fake, upload, itemId } = await setupPhotos()

  const cases = [
    await upload(itemId, { omitFile: true }),
    await upload(itemId, { photoId: null }),
    await upload(itemId, { photoId: "not-a-uuid" }),
    await upload(itemId, { width: "0" }),
    await upload(itemId, { height: "10001" }),
    await upload(itemId, { width: "abc" }),
  ]

  for (const res of cases) {
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    expect((await json(res)).error.code).toBe("VALIDATION_ERROR")
  }
  expect(fake.calls).toEqual([])
})

test("VIEWER cannot upload or delete; a non-member gets 403; a missing item is 404", async () => {
  const { as, upload, itemId, groupId, seedMembership: seedM, owner } = await setupPhotos()
  const viewer = await seedUser()
  await seedM(viewer, groupId, "VIEWER")
  const outsider = await seedUser()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })

  const v = await as(viewer)
  const o = await as(outsider)
  const up = await v.req("POST", `/v1/items/${itemId}/photos`, photoForm())
  const del = await v.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  const read = await v.req("GET", `/v1/items/${itemId}/photos`)
  const outsiderRead = await o.req("GET", `/v1/items/${itemId}/photos`)
  const missing = await owner.req("POST", `/v1/items/${crypto.randomUUID()}/photos`, photoForm())

  expect(up.status).toBe(403)
  expect((await json(up)).error.code).toBe("INSUFFICIENT_ROLE")
  expect(del.status).toBe(403)
  expect(read.status).toBe(200)
  expect(outsiderRead.status).toBe(403)
  expect(missing.status).toBe(404)
})

test("the cap: the Nth photo succeeds, the next is 422 PHOTO_LIMIT_EXCEEDED and uploads nothing", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  for (let i = 0; i < PHOTOS_PER_ITEM_MAX; i++) {
    // oxlint-disable-next-line no-await-in-loop
    expect((await upload(itemId, { bytes: jpeg(100, i + 2) })).status).toBe(201)
  }
  const uploadsBefore = fake.callsOf("upload").length

  const res = await upload(itemId)

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("PHOTO_LIMIT_EXCEEDED")
  expect(fake.callsOf("upload").length).toBe(uploadsBefore)
})

test("a deleted photo frees a slot under the cap", async () => {
  const { upload, owner, itemId } = await setupPhotos()
  const ids: string[] = []
  for (let i = 0; i < PHOTOS_PER_ITEM_MAX; i++) {
    const photoId = crypto.randomUUID()
    ids.push(photoId)
    // oxlint-disable-next-line no-await-in-loop
    expect((await upload(itemId, { photoId })).status).toBe(201)
  }
  expect((await upload(itemId)).status).toBe(422)
  const del = await owner.req("DELETE", `/v1/items/${itemId}/photos/${ids[0]}`)

  expect(del.status).toBe(204)
  expect((await upload(itemId)).status).toBe(201)
})

test("replay: same photoId and body again is 200 with one row and one object", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId, bytes: jpeg(300) })

  const again = await upload(itemId, { photoId, bytes: jpeg(300) })

  expect(again.status).toBe(200)
  expect((await json(again)).photo.id).toBe(photoId)
  expect(await testDb.select().from(itemPhotos)).toHaveLength(1)
  expect(fake.callsOf("upload")).toHaveLength(1)
})

test("replay at the cap: the recorded photo answers 200, not PHOTO_LIMIT_EXCEEDED", async () => {
  const { upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId, bytes: jpeg(300) })
  for (let i = 0; i < PHOTOS_PER_ITEM_MAX - 1; i++) {
    // oxlint-disable-next-line no-await-in-loop
    await upload(itemId, { bytes: jpeg(100, i + 2) })
  }

  const again = await upload(itemId, { photoId, bytes: jpeg(300) })

  expect(again.status).toBe(200)
})

test("an upper-case item id in the path still replays a recorded photo with 200", async () => {
  const { upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const first = await upload(itemId.toUpperCase(), { photoId, bytes: jpeg(300) })

  const again = await upload(itemId.toUpperCase(), { photoId, bytes: jpeg(300) })

  expect(first.status).toBe(201)
  expect(again.status).toBe(200)
})

test("an upper-case photoId is the same photo as its lower-case form", async () => {
  const { upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })

  const again = await upload(itemId, { photoId: photoId.toUpperCase() })

  expect(again.status).toBe(200)
})

test("the same photoId with another size, for another item, or after delete is 422 IDEMPOTENCY_KEY_REUSED", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId, bytes: jpeg(300) })

  const size = await upload(itemId, { photoId, bytes: jpeg(301) })
  const item = await upload(other, { photoId, bytes: jpeg(300) })
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  const afterDelete = await upload(itemId, { photoId, bytes: jpeg(300) })

  for (const res of [size, item, afterDelete]) {
    expect(res.status).toBe(422)
    // oxlint-disable-next-line no-await-in-loop
    expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  }
  // 早い段階で断るので、Storage には 1 回 (最初の upload) しか触れていない
  expect(fake.callsOf("upload")).toHaveLength(1)
})

test("a photoId from another group answers the same 422 body as an unrelated taken id", async () => {
  const { upload, itemId, as } = await setupPhotos()
  const strangerId = await seedUser()
  const strangerGroup = await seedGroupWithMembership(strangerId, "Other")
  const strangerItem = await seedItem(strangerGroup, "Theirs")
  const theirs = crypto.randomUUID()
  const stranger = await as(strangerId)
  await stranger.req("POST", `/v1/items/${strangerItem}/photos`, photoForm({ photoId: theirs }))
  const mine = crypto.randomUUID()
  await upload(itemId, { photoId: mine, bytes: jpeg(300) })

  const foreign = await upload(itemId, { photoId: theirs })
  const taken = await upload(itemId, { photoId: mine, bytes: jpeg(301) })

  expect(foreign.status).toBe(422)
  expect(await json(foreign)).toEqual(await json(taken))
})

test("a failed Storage upload answers 502 and leaves only a pending row", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  fake.control.failUpload = true

  const res = await upload(itemId)

  expect(res.status).toBe(502)
  expect((await json(res)).error.code).toBe("STORAGE_UNAVAILABLE")
  const rows = await testDb.select().from(itemPhotos)
  expect(rows.map((r) => r.status)).toEqual(["pending"])
})

test("without a Storage secret key every photo route answers 503 and other routes still work", async () => {
  const ownerId = await seedUser()
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  const itemId = await seedItem(groupId)
  const app = createApp({ db: testDb, auth: e2eAuth })
  const authorization = await bearer(ownerId)

  const calls = [
    app.request(`/v1/items/${itemId}/photos`, { headers: { authorization } }),
    app.request(`/v1/items/photos?groupId=${groupId}`, { headers: { authorization } }),
    app.request(`/v1/items/${itemId}/photos`, {
      method: "POST",
      headers: { authorization },
      body: photoForm(),
    }),
    app.request(`/v1/items/${itemId}/photos/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { authorization },
    }),
  ]
  for (const res of await Promise.all(calls)) {
    expect(res.status).toBe(503)
    // oxlint-disable-next-line no-await-in-loop
    expect((await json(res)).error.code).toBe("PHOTO_STORAGE_NOT_CONFIGURED")
  }
  const item = await app.request(`/v1/items/${itemId}`, { headers: { authorization } })
  expect(item.status).toBe(200)
})

test("batch covers: one per item, none for items without photos, tie on created_at goes to the smaller id", async () => {
  const { upload, owner, itemId, groupId } = await setupPhotos()
  const bare = await seedItem(groupId, "Bare")
  const [small, large] = [crypto.randomUUID(), crypto.randomUUID()].toSorted() as [string, string]
  // 大きい id を先に入れて、id 順の ORDER BY が無ければ挿入順 (大きい方) が勝つようにする
  await upload(itemId, { photoId: large, bytes: jpeg(100, 2) })
  await upload(itemId, { photoId: small, bytes: jpeg(100, 3) })
  await testDb
    .update(itemPhotos)
    .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
    .where(eq(itemPhotos.itemId, itemId))

  const res = await owner.req("GET", `/v1/items/photos?groupId=${groupId}`)

  expect(res.status).toBe(200)
  const { covers } = await json(res)
  expect(covers).toHaveLength(1)
  expect(covers[0]).toMatchObject({ itemId, photoId: small })
  expect(covers[0].url).toStartWith("https://storage.test/sign/")
  expect(covers.some((c: any) => c.itemId === bare)).toBe(false)
})

test("batch covers is routed before /items/{id}: it answers covers, not a validation error", async () => {
  const { owner, groupId } = await setupPhotos()

  const res = await owner.req("GET", `/v1/items/photos?groupId=${groupId}`)

  expect(res.status).toBe(200)
  expect(await json(res)).toEqual({ covers: [] })
})

test("batch covers skip soft-deleted photos and items, and other groups", async () => {
  const { upload, owner, itemId, groupId, as, fake } = await setupPhotos()
  const deletedPhotoItem = await seedItem(groupId, "A")
  const deletedItem = await seedItem(groupId, "B")
  const keptPhoto = crypto.randomUUID()
  const gone = crypto.randomUUID()
  await upload(itemId, { photoId: keptPhoto })
  await upload(deletedPhotoItem, { photoId: gone })
  const alive = crypto.randomUUID()
  await upload(deletedItem, { photoId: alive })
  // Storage の削除を失敗させて object を残す。object が消えると、行を除外する条件が外れても署名できず結果が同じになる
  fake.control.failRemove = true
  await owner.req("DELETE", `/v1/items/${deletedPhotoItem}/photos/${gone}`)
  await owner.req("DELETE", `/v1/items/${deletedItem}`)
  // 写真が active のまま item だけが削除済みの行 (item の削除が写真を巻き込まない経路) も出さない
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: null, storageDeletedAt: null })
    .where(eq(itemPhotos.id, alive))
  const strangerId = await seedUser()
  const strangerGroup = await seedGroupWithMembership(strangerId, "S")
  const strangerItem = await seedItem(strangerGroup)
  await (await as(strangerId)).req("POST", `/v1/items/${strangerItem}/photos`, photoForm())

  const { covers } = await json(await owner.req("GET", `/v1/items/photos?groupId=${groupId}`))

  expect(covers.map((c: any) => c.photoId)).toEqual([keptPhoto])
})

test("the cover is the earliest photo by created_at even when its id is the larger one", async () => {
  const { upload, owner, itemId, groupId } = await setupPhotos()
  const [small, large] = [crypto.randomUUID(), crypto.randomUUID()].toSorted() as [string, string]
  await upload(itemId, { photoId: small, bytes: jpeg(100, 2) })
  await upload(itemId, { photoId: large, bytes: jpeg(100, 3) })
  await testDb
    .update(itemPhotos)
    .set({ createdAt: new Date("2026-02-01T00:00:00Z") })
    .where(eq(itemPhotos.id, small))
  await testDb
    .update(itemPhotos)
    .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
    .where(eq(itemPhotos.id, large))

  const { covers } = await json(await owner.req("GET", `/v1/items/photos?groupId=${groupId}`))

  expect(covers.map((c: any) => c.photoId)).toEqual([large])
})

test("the list shows only this item's photos, oldest first", async () => {
  const { upload, owner, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  // a は id が小さいが created_at は遅い。id 順なら a, b、created_at 順なら b, a
  const [a, b] = [crypto.randomUUID(), crypto.randomUUID()].toSorted() as [string, string]
  const c = crypto.randomUUID()
  await upload(itemId, { photoId: a, bytes: jpeg(100, 2) })
  await upload(itemId, { photoId: b, bytes: jpeg(100, 3) })
  await upload(other, { photoId: c, bytes: jpeg(100, 4) })
  await testDb
    .update(itemPhotos)
    .set({ createdAt: new Date("2026-03-01T00:00:00Z") })
    .where(eq(itemPhotos.id, a))
  await testDb
    .update(itemPhotos)
    .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
    .where(eq(itemPhotos.id, b))

  const { photos } = await json(await owner.req("GET", `/v1/items/${itemId}/photos`))

  expect(photos.map((p: any) => p.id)).toEqual([b, a])
})

test("GET and DELETE for a missing item are 404", async () => {
  const { owner } = await setupPhotos()
  const missing = crypto.randomUUID()

  const list = await owner.req("GET", `/v1/items/${missing}/photos`)
  const del = await owner.req("DELETE", `/v1/items/${missing}/photos/${crypto.randomUUID()}`)

  expect(list.status).toBe(404)
  expect(del.status).toBe(404)
})

test("photos of other items do not count toward the cap", async () => {
  const { upload, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  for (let i = 0; i < 5; i++) {
    // oxlint-disable-next-line no-await-in-loop
    await upload(other, { bytes: jpeg(100, i + 2) })
  }

  const res = await upload(itemId)

  expect(res.status).toBe(201)
})

test("the cap is five photos", async () => {
  const { upload, itemId } = await setupPhotos()
  const statuses: number[] = []
  for (let i = 0; i < 6; i++) {
    // oxlint-disable-next-line no-await-in-loop
    statuses.push((await upload(itemId, { bytes: jpeg(100, i + 2) })).status)
  }

  expect(statuses).toEqual([201, 201, 201, 201, 201, 422])
})

test("deleting one photo leaves the item's other photos active", async () => {
  const { upload, owner, itemId } = await setupPhotos()
  const gone = crypto.randomUUID()
  const kept = crypto.randomUUID()
  await upload(itemId, { photoId: gone, bytes: jpeg(100, 2) })
  await upload(itemId, { photoId: kept, bytes: jpeg(100, 3) })

  await owner.req("DELETE", `/v1/items/${itemId}/photos/${gone}`)

  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, kept))
  expect(row?.deletedAt).toBeNull()
})

test("deleting an item keeps the deleted_at of a photo that was already deleted", async () => {
  const { upload, owner, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  const early = new Date("2026-01-01T00:00:00Z")
  await testDb.update(itemPhotos).set({ deletedAt: early }).where(eq(itemPhotos.id, photoId))

  await owner.req("DELETE", `/v1/items/${itemId}`)

  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  expect(row?.deletedAt).toEqual(early)
})

test("a cover whose object cannot be signed is left out instead of returned with an empty url", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  fake.objects.delete(`${groupId}/${photoId}.jpg`)

  const { covers } = await json(await owner.req("GET", `/v1/items/photos?groupId=${groupId}`))

  expect(covers).toEqual([])
})

test("deleting a photo twice: the second is 404 and the first deleted_at is unchanged", async () => {
  const { upload, owner, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  const [first] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))

  const again = await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)

  expect(again.status).toBe(404)
  const [after] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  expect(after?.deletedAt).toEqual(first?.deletedAt ?? null)
})

test("deleting an item leaves the photos of other items active", async () => {
  const { upload, owner, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const kept = crypto.randomUUID()
  await upload(itemId, { bytes: jpeg(100, 2) })
  await upload(other, { photoId: kept, bytes: jpeg(100, 3) })

  await owner.req("DELETE", `/v1/items/${itemId}`)

  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, kept))
  expect(row?.deletedAt).toBeNull()
})

test("batch covers need membership of the group", async () => {
  const { as, groupId } = await setupPhotos()
  const outsider = await as(await seedUser())

  const res = await outsider.req("GET", `/v1/items/photos?groupId=${groupId}`)

  expect(res.status).toBe(403)
})

test("DELETE with a photo of another item is 404 and the photo stays active; same body as an unknown id", async () => {
  const { upload, owner, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  await upload(other, { photoId })

  const wrongItem = await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  const unknown = await owner.req("DELETE", `/v1/items/${itemId}/photos/${crypto.randomUUID()}`)

  expect(wrongItem.status).toBe(404)
  expect(await json(wrongItem)).toEqual(await json(unknown))
  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  expect(row?.deletedAt).toBeNull()
})

test("a photo of another group is 404 under my item, same as an unknown id", async () => {
  const { owner, itemId, as } = await setupPhotos()
  const strangerId = await seedUser()
  const strangerGroup = await seedGroupWithMembership(strangerId, "S")
  const strangerItem = await seedItem(strangerGroup)
  const theirs = crypto.randomUUID()
  await (
    await as(strangerId)
  ).req("POST", `/v1/items/${strangerItem}/photos`, photoForm({ photoId: theirs }))

  const foreign = await owner.req("DELETE", `/v1/items/${itemId}/photos/${theirs}`)
  const unknown = await owner.req("DELETE", `/v1/items/${itemId}/photos/${crypto.randomUUID()}`)

  expect(foreign.status).toBe(404)
  expect(await json(foreign)).toEqual(await json(unknown))
  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, theirs))
  expect(row?.deletedAt).toBeNull()
})

test("delete: a failing Storage removal still answers 204 and leaves storage_deleted_at null", async () => {
  const { fake, upload, owner, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  fake.control.failRemove = true

  const res = await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)

  expect(res.status).toBe(204)
  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  expect(row?.deletedAt).not.toBeNull()
  expect(row?.storageDeletedAt).toBeNull()
  expect(fake.objects.size).toBe(1)
})

test("delete: a working Storage removal sets storage_deleted_at", async () => {
  const { upload, owner, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })

  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)

  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  expect(row?.storageDeletedAt).not.toBeNull()
})

test("deleting an item soft-deletes its photos and removes the objects after the commit", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })

  const res = await owner.req("DELETE", `/v1/items/${itemId}`)

  expect(res.status).toBe(204)
  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  expect(row?.deletedAt).not.toBeNull()
  expect(row?.storageDeletedAt).not.toBeNull()
  expect(fake.objects.has(`${groupId}/${photoId}.jpg`)).toBe(false)
})

test("deleting an item with a failing Storage leaves a pending-removal row", async () => {
  const { fake, upload, owner, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  fake.control.failRemove = true

  const res = await owner.req("DELETE", `/v1/items/${itemId}`)

  expect(res.status).toBe(204)
  const [row] = await testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))
  expect(row?.deletedAt).not.toBeNull()
  expect(row?.storageDeletedAt).toBeNull()
})

test("a non-member uploading to a deleted item gets 404, the same as for a missing one", async () => {
  const { owner, as, itemId } = await setupPhotos()
  await owner.req("DELETE", `/v1/items/${itemId}`)
  const outsider = await as(await seedUser())

  const deleted = await outsider.req("POST", `/v1/items/${itemId}/photos`, photoForm())
  const missing = await outsider.req("POST", `/v1/items/${crypto.randomUUID()}/photos`, photoForm())

  expect(deleted.status).toBe(404)
  expect(await json(deleted)).toEqual(await json(missing))
})

test("upload to a deleted item is 404 and uploads nothing", async () => {
  const { fake, upload, owner, itemId } = await setupPhotos()
  await owner.req("DELETE", `/v1/items/${itemId}`)

  const res = await upload(itemId)

  expect(res.status).toBe(404)
  expect(fake.callsOf("upload")).toEqual([])
})

test("anon and authenticated roles cannot read item_photos", async () => {
  const roles = (await testDb.execute(
    sql`select rolname from pg_roles where rolname in ('anon', 'authenticated')`,
  )) as unknown as { rolname: string }[]
  if (roles.length < 2) {
    console.warn(
      "skipped: anon / authenticated roles are missing (plain database without Supabase)",
    )
    return
  }

  for (const role of ["anon", "authenticated"]) {
    // oxlint-disable-next-line no-await-in-loop
    const result = await testDb.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local role ${role}`))
      return tx
        .transaction(async (inner) => {
          await inner.execute(sql`select count(*) from public.item_photos`)
          return "readable"
        })
        .catch((err: unknown) =>
          String((err as { cause?: { message?: string } }).cause?.message ?? err),
        )
    })
    expect(result).toContain("permission denied")
  }
})

test("item_photos has row level security enabled", async () => {
  const rows = (await testDb.execute(
    sql`select relrowsecurity as rls from pg_class where relname = 'item_photos' and relkind = 'r'`,
  )) as unknown as { rls: boolean }[]

  expect(rows).toEqual([{ rls: true }])
})

test("the photo row records who took it and the stored path", async () => {
  const { upload, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })

  const [row] = await testDb
    .select()
    .from(itemPhotos)
    .where(and(eq(itemPhotos.id, photoId), eq(itemPhotos.createdBy, ownerId)))

  expect(row?.storagePath).toBe(`${groupId}/${photoId}.jpg`)
  expect(row?.contentType).toBe("image/jpeg")
})
