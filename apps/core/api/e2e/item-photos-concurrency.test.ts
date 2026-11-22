import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { itemPhotos, type Db } from "@prep-hamster/db"
import { PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema"
import { photoPath } from "../src/photos/config"
import { checkCapEarly, signPaths, sweepPhotos } from "../src/photos/service"
import type { FakePhotoStorage } from "./fake-photo-storage"
import { bearer } from "./auth-helper"
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
const MIN = 60 * 1000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

// transaction の n 回目の呼び出しだけ差し替える。select など他の呼び出しは本物に通す
function wrapTransactions(
  real: Db,
  handler: (n: number, runReal: () => Promise<unknown>) => Promise<unknown>,
): Db {
  let n = 0
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "transaction") {
        return (fn: never, cfg?: never) => handler(++n, () => target.transaction(fn, cfg))
      }
      const v = Reflect.get(target, prop, target)
      return typeof v === "function" ? v.bind(target) : v
    },
  }) as Db
}

const insertPhotoRow = (
  tx: Pick<Db, "insert">,
  v: { id: string; groupId: string; itemId: string; userId: string; size: number },
) =>
  tx.insert(itemPhotos).values({
    id: v.id,
    groupId: v.groupId,
    itemId: v.itemId,
    storagePath: photoPath(v.groupId, v.id),
    contentType: "image/jpeg",
    byteSize: v.size,
    createdBy: v.userId,
  })

const rowsOf = (photoId: string) =>
  testDb.select().from(itemPhotos).where(eq(itemPhotos.id, photoId))

test("two uploads at the cap minus one: exactly one row, and the loser's object is deleted", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  for (let i = 0; i < PHOTOS_PER_ITEM_MAX - 1; i++) {
    // oxlint-disable-next-line no-await-in-loop
    await upload(itemId, { bytes: jpeg(100, i + 10) })
  }
  const gate = gateUploads(fake, 2)
  const a = crypto.randomUUID()
  const b = crypto.randomUUID()

  const pa = upload(itemId, { photoId: a, bytes: jpeg(100, 2) })
  const pb = upload(itemId, { photoId: b, bytes: jpeg(100, 3) })
  await gate.reached
  gate.release()
  const statuses = (await Promise.all([pa, pb])).map((r) => r.status).toSorted()

  expect(statuses).toEqual([201, 422])
  expect(await testDb.select().from(itemPhotos)).toHaveLength(PHOTOS_PER_ITEM_MAX)
  expect(fake.objects.size).toBe(PHOTOS_PER_ITEM_MAX)
  const loser = (await rowsOf(a)).length === 0 ? a : b
  expect(fake.callsOf("remove").map((c) => c.path)).toEqual([photoPath(groupId, loser)])
})

test("an upload against an item delete: 404, no live photo, and the object is gone", async () => {
  const { fake, upload, owner, itemId } = await setupPhotos()
  const gate = gateUploads(fake, 1)
  const photoId = crypto.randomUUID()

  const pending = upload(itemId, { photoId })
  await gate.reached
  const del = await owner.req("DELETE", `/v1/items/${itemId}`)
  gate.release()
  const res = await pending

  expect(del.status).toBe(204)
  expect(res.status).toBe(404)
  expect(await rowsOf(photoId)).toEqual([])
  expect(fake.objects.size).toBe(0)
})

test("no connection or item lock is held across the upload: a tag PUT finishes while Storage is blocked", async () => {
  const { fake, upload, app, ownerId, itemId } = await setupPhotos()
  const gate = gateUploads(fake, 1)

  const pending = upload(itemId)
  await gate.reached
  const put = await Promise.race([
    Promise.resolve(
      app.request(`/v1/items/${itemId}/tags`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: await bearer(ownerId) },
        body: JSON.stringify({ tagIds: [] }),
      }),
    ).then((r) => r.status),
    sleep(3000).then(() => "blocked" as const),
  ])
  gate.release()
  await pending

  expect(put).toBe(200)
})

test("identical concurrent uploads: one row, one object, both succeed, and the object is not deleted", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  const gate = gateUploads(fake, 2)
  const photoId = crypto.randomUUID()

  const p1 = upload(itemId, { photoId, bytes: jpeg(300) })
  const p2 = upload(itemId, { photoId, bytes: jpeg(300) })
  await gate.reached
  gate.release()
  const statuses = (await Promise.all([p1, p2])).map((r) => r.status).toSorted()

  expect(statuses).toEqual([200, 201])
  expect(await rowsOf(photoId)).toHaveLength(1)
  expect(fake.objects.size).toBe(1)
  expect(fake.callsOf("remove")).toEqual([])
})

test("same photoId for another item, found through the object-exists branch, is 422 not 200", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  // 2 本目の要求が最初の probe を済ませて upload に着いた時点で、1 本目 (別 item) を完走させる
  fake.control.onUploadReached = async () => {
    fake.control.onUploadReached = null
    expect((await upload(itemId, { photoId, bytes: jpeg(300) })).status).toBe(201)
  }

  const res = await upload(other, { photoId, bytes: jpeg(300) })

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  expect(await rowsOf(photoId)).toHaveLength(1)
  expect(fake.objects.size).toBe(1)
})

test("unclear commit, row committed: the fresh-connection probe answers 200 and the object stays", async () => {
  const flaky = wrapTransactions(testDb, async (n, runReal) => {
    if (n === 1) {
      await runReal()
      throw new Error("connection lost")
    }
    return runReal()
  })
  const { fake, upload, itemId } = await setupPhotos({ db: flaky })
  const photoId = crypto.randomUUID()

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(200)
  expect(await rowsOf(photoId)).toHaveLength(1)
  expect(fake.objects.size).toBe(1)
  expect(fake.callsOf("remove")).toEqual([])
})

test("unclear commit, no row: the object is deleted and the original error surfaces", async () => {
  const flaky = wrapTransactions(testDb, async (n, runReal) => {
    if (n === 1) throw new Error("connection lost")
    return runReal()
  })
  const { fake, upload, itemId, groupId } = await setupPhotos({ db: flaky })
  const photoId = crypto.randomUUID()

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(500)
  expect(await rowsOf(photoId)).toEqual([])
  expect(fake.objects.size).toBe(0)
  expect(fake.callsOf("remove")).toEqual([{ op: "remove", path: photoPath(groupId, photoId) }])
})

test("unclear commit, and a row of another item appeared: 422 and the object stays", async () => {
  let ctx!: Awaited<ReturnType<typeof setupPhotos>>
  const photoId = crypto.randomUUID()
  const flaky = wrapTransactions(testDb, async (n, runReal) => {
    if (n === 1) {
      const other = await seedItem(ctx.groupId, "Other")
      await insertPhotoRow(testDb, {
        id: photoId,
        groupId: ctx.groupId,
        itemId: other,
        userId: ctx.ownerId,
        size: 321,
      })
      throw new Error("connection lost")
    }
    return runReal()
  })
  ctx = await setupPhotos({ db: flaky })

  const res = await ctx.upload(ctx.itemId, { photoId, bytes: jpeg(321) })

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  expect(ctx.fake.callsOf("remove")).toEqual([])
})

test("unclear commit and the probe also fails: 503, and the object is left for the sweep", async () => {
  const flaky = wrapTransactions(testDb, async (n, runReal) => {
    if (n === 1) {
      await runReal()
      throw new Error("connection lost")
    }
    if (n === 2) throw new Error("still down")
    return runReal()
  })
  const { fake, upload, itemId } = await setupPhotos({ db: flaky })

  const res = await upload(itemId)

  expect(res.status).toBe(503)
  expect((await json(res)).error.code).toBe("TEMPORARILY_UNAVAILABLE")
  expect(fake.objects.size).toBe(1)
  expect(fake.callsOf("remove")).toEqual([])
})

test("unclear commit with the original transaction still running: the object is not deleted while its commit is pending", async () => {
  const photoId = crypto.randomUUID()
  const size = 321
  let inflight: Promise<unknown> = Promise.resolve()
  let ctx!: Awaited<ReturnType<typeof setupPhotos>>
  const flaky = wrapTransactions(testDb, async (n, runReal) => {
    if (n !== 1) return runReal()
    // 元の transaction が photoId の lock を持ったまま commit に向かっている状態を作る。
    // 登録 transaction そのものは走らせず、代わりにこれが 400ms 後に行を commit する
    const locked = Promise.withResolvers<void>()
    inflight = testDb.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${photoId}::text, 0))`)
      locked.resolve()
      await sleep(400)
      await insertPhotoRow(tx, {
        id: photoId,
        groupId: ctx.groupId,
        itemId: ctx.itemId,
        userId: ctx.ownerId,
        size,
      })
    })
    await locked.promise
    throw new Error("connection lost")
  })
  ctx = await setupPhotos({ db: flaky })

  const res = await ctx.upload(ctx.itemId, { photoId, bytes: jpeg(size) })
  await inflight

  expect(res.status).toBe(200)
  expect(await rowsOf(photoId)).toHaveLength(1)
  expect(ctx.fake.objects.size).toBe(1)
  expect(ctx.fake.callsOf("remove")).toEqual([])
})

test("a registration that outlives the 20 minute deadline is refused and its object is deleted", async () => {
  let t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos({ now: () => t })
  const gate = gateUploads(fake, 1)
  const photoId = crypto.randomUUID()

  const pending = upload(itemId, { photoId })
  await gate.reached
  t += 21 * MIN
  gate.release()
  const res = await pending

  expect(res.status).toBe(503)
  expect((await json(res)).error.code).toBe("TEMPORARILY_UNAVAILABLE")
  expect(await rowsOf(photoId)).toEqual([])
  expect(fake.objects.size).toBe(0)
})

test("a registration inside the 20 minute deadline succeeds", async () => {
  let t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId } = await setupPhotos({ now: () => t })
  const gate = gateUploads(fake, 1)

  const pending = upload(itemId)
  await gate.reached
  t += 19 * MIN
  gate.release()

  expect((await pending).status).toBe(201)
})

test("an orphan object of the same photoId that is young is adopted: no second upload, no delete", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.put(photoPath(groupId, photoId), 5 * MIN)

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(201)
  expect(await rowsOf(photoId)).toHaveLength(1)
  expect(fake.callsOf("remove")).toEqual([])
  expect(fake.callsOf("upload")).toHaveLength(1)
})

test("a stale orphan object of the same photoId is removed once its row is confirmed absent, then uploaded again", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 45 * MIN)

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(201)
  expect(fake.calls.map((c) => c.op).filter((o) => o === "upload" || o === "remove")).toEqual([
    "upload",
    "remove",
    "upload",
  ])
  expect(fake.objects.get(path)?.size).toBe(400)
})

test("an orphan whose row appeared in the meantime is replayed, not deleted", async () => {
  const { fake, upload, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 45 * MIN)
  fake.control.beforeCreatedAt = async () => {
    await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 400 })
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(200)
  expect(fake.objects.has(path)).toBe(true)
  expect(fake.callsOf("remove")).toEqual([])
})

test("an object that vanishes between the exists answer and the check is uploaded again", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN)
  fake.control.beforeCreatedAt = async () => {
    fake.objects.delete(path)
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(201)
  expect(fake.callsOf("upload")).toHaveLength(2)
  expect(fake.objects.get(path)?.size).toBe(400)
})

test("a stale orphan whose row belongs to another item is 422 and the object stays", async () => {
  const { fake, upload, itemId, groupId, ownerId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 45 * MIN)
  fake.control.beforeCreatedAt = async () => {
    await insertPhotoRow(testDb, {
      id: photoId,
      groupId,
      itemId: other,
      userId: ownerId,
      size: 400,
    })
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  expect(fake.objects.has(path)).toBe(true)
  expect(fake.callsOf("remove")).toEqual([])
})

test("a young orphan whose row exists for another item is 422", async () => {
  const { fake, upload, itemId, groupId, ownerId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  fake.put(photoPath(groupId, photoId), 5 * MIN)
  fake.control.beforeCreatedAt = async () => {
    await insertPhotoRow(testDb, {
      id: photoId,
      groupId,
      itemId: other,
      userId: ownerId,
      size: 400,
    })
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
})

test("a young orphan whose row exists for this item and size is replayed with 200", async () => {
  const { fake, upload, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.put(photoPath(groupId, photoId), 5 * MIN)
  fake.control.beforeCreatedAt = async () => {
    await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 400 })
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(200)
  expect(await rowsOf(photoId)).toHaveLength(1)
})

test("a row that appears after the early probe for another item is 422 at registration, and the shared object is kept", async () => {
  const { fake, upload, itemId, groupId, ownerId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const photoId = crypto.randomUUID()
  fake.control.onUploadReached = async () => {
    fake.control.onUploadReached = null
    await insertPhotoRow(testDb, {
      id: photoId,
      groupId,
      itemId: other,
      userId: ownerId,
      size: 400,
    })
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  expect(fake.objects.has(photoPath(groupId, photoId))).toBe(true)
  expect(fake.callsOf("remove")).toEqual([])
})

test("a row that appears after the early probe for this item and size is replayed at registration, object kept", async () => {
  const { fake, upload, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.onUploadReached = async () => {
    fake.control.onUploadReached = null
    await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 400 })
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(200)
  expect(await rowsOf(photoId)).toHaveLength(1)
  expect(fake.objects.has(photoPath(groupId, photoId))).toBe(true)
  expect(fake.callsOf("remove")).toEqual([])
})

// 行の group が item の group と食い違う不整合な行 (FK は別々に張られている) も、別物として扱う
test("a row of the same item and size that belongs to another group is reused, not a replay", async () => {
  const { upload, itemId, ownerId } = await setupPhotos()
  const strangerId = await seedUser()
  const strangerGroup = await seedGroupWithMembership(strangerId, "S")
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, {
    id: photoId,
    groupId: strangerGroup,
    itemId,
    userId: ownerId,
    size: 400,
  })
  const res = await upload(itemId, { photoId, bytes: jpeg(400) })

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
})

test("the registration holds the photoId lock: a sweep that runs while it is paused keeps the object", async () => {
  const entered = Promise.withResolvers<void>()
  const proceed = Promise.withResolvers<void>()
  const paused = new Proxy(testDb, {
    get(target, prop) {
      if (prop !== "transaction") {
        const v = Reflect.get(target, prop, target)
        return typeof v === "function" ? v.bind(target) : v
      }
      return (fn: (tx: unknown) => Promise<unknown>, cfg?: never) =>
        target.transaction(
          (tx) =>
            fn(
              new Proxy(tx, {
                get(t, p) {
                  if (p === "execute") {
                    // 登録 transaction の最初の execute は photoId の lock。取れた直後で止める
                    return async (...args: unknown[]) => {
                      const r = await (t.execute as (...a: unknown[]) => Promise<unknown>)(...args)
                      entered.resolve()
                      await proceed.promise
                      return r
                    }
                  }
                  const v = Reflect.get(t, p, t)
                  return typeof v === "function" ? v.bind(t) : v
                },
              }),
            ),
          cfg,
        )
    },
  }) as Db
  const { fake, upload, itemId, groupId } = await setupPhotos({ db: paused })
  const photoId = crypto.randomUUID()

  const pending = upload(itemId, { photoId })
  expect(await Promise.race([entered.promise.then(() => "locked"), sleep(3000)])).toBe("locked")
  const swept = sweepPhotos(testDb, fake.storage, () => Date.now() + 2 * 60 * MIN)
  await sleep(200)
  proceed.resolve()
  const [res, result] = await Promise.all([pending, swept])

  expect(res.status).toBe(201)
  expect(result).toMatchObject({ orphansRemoved: 0, orphansKept: 1 })
  expect(fake.objects.has(photoPath(groupId, photoId))).toBe(true)
  expect(await rowsOf(photoId)).toHaveLength(1)
})

test("an adopted object is not deleted when the registration is refused as too late", async () => {
  let t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId, groupId } = await setupPhotos({ now: () => t })
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN)
  fake.control.beforeCreatedAt = async () => {
    t += 21 * MIN
  }

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(503)
  expect(fake.objects.has(path)).toBe(true)
  expect(fake.callsOf("remove")).toEqual([])
})

test("unclear commit with no row, for an adopted object: the object is kept", async () => {
  const flaky = wrapTransactions(testDb, async (n, runReal) => {
    if (n === 1) throw new Error("connection lost")
    return runReal()
  })
  const { fake, upload, itemId, groupId } = await setupPhotos({ db: flaky })
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN)

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(500)
  expect(fake.objects.has(path)).toBe(true)
  expect(fake.callsOf("remove")).toEqual([])
})

test("when Storage cannot tell whether the existing object is young, the answer is 503 and nothing is deleted", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.put(photoPath(groupId, photoId), 5 * MIN)
  fake.control.failInfo = true

  const res = await upload(itemId, { photoId })

  expect(res.status).toBe(503)
  expect((await json(res)).error.code).toBe("TEMPORARILY_UNAVAILABLE")
  expect(fake.callsOf("remove")).toEqual([])
  expect(await testDb.select().from(itemPhotos)).toEqual([])
})

test("an object that keeps vanishing is given up on after two rounds with 503", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  fake.control.uploadAlwaysExists = true

  const res = await upload(itemId)

  expect(res.status).toBe(503)
  expect(fake.callsOf("upload")).toHaveLength(2)
  expect(await testDb.select().from(itemPhotos)).toEqual([])
})

test("signing is split into chunks of 100 paths", async () => {
  const { fake } = await setupPhotos()
  const paths = Array.from({ length: 250 }, (_, i) => `g/${i}.jpg`)
  for (const p of paths) fake.put(p)

  const urls = await signPaths(fake.storage, paths)

  expect(urls.size).toBe(250)
  expect(fake.callsOf("sign").map((c) => c.paths.length)).toEqual([100, 100, 50])
})

test("retrying with the same photoId after a failed attempt never mints a second row", async () => {
  const { fake, upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  fake.control.failUpload = true
  expect((await upload(itemId, { photoId })).status).toBe(502)
  fake.control.failUpload = false

  const retry = await upload(itemId, { photoId })

  expect(retry.status).toBe(201)
  expect(await testDb.select().from(itemPhotos)).toHaveLength(1)
})

test("checkCapEarly: below the cap is ok; at the cap a recorded match replays, a mismatch is reused, else limit", async () => {
  const { upload, itemId, groupId } = await setupPhotos()
  const other = await seedItem(groupId, "Other")
  const recorded = crypto.randomUUID()
  const onOther = crypto.randomUUID()
  await upload(other, { photoId: onOther, bytes: jpeg(150) })
  const expectOf = (byteSize: number) => ({ groupId, itemId, byteSize })
  expect((await checkCapEarly(testDb, crypto.randomUUID(), expectOf(100))).kind).toBe("ok")
  await upload(itemId, { photoId: recorded, bytes: jpeg(100) })
  for (let i = 0; i < PHOTOS_PER_ITEM_MAX - 1; i++) {
    // oxlint-disable-next-line no-await-in-loop
    await upload(itemId, { bytes: jpeg(100, i + 2) })
  }

  const replay = await checkCapEarly(testDb, recorded, expectOf(100))
  const otherSize = await checkCapEarly(testDb, recorded, expectOf(101))
  const otherItem = await checkCapEarly(testDb, onOther, expectOf(150))
  const unrelated = await checkCapEarly(testDb, crypto.randomUUID(), expectOf(100))

  expect(replay.kind).toBe("replay")
  expect(otherSize.kind).toBe("reused")
  expect(otherItem.kind).toBe("reused")
  expect(unrelated.kind).toBe("limit")
})

// ---- sweep ----

test("sweep: a removal that failed is retried until Storage reports it gone, then not touched again", async () => {
  const { fake, upload, owner, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  fake.control.failRemove = true
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: new Date(Date.now() - 10 * MIN) })
    .where(eq(itemPhotos.id, photoId))

  const failing = await sweepPhotos(testDb, fake.storage)
  expect(failing).toMatchObject({ pendingRemoved: 0, pendingFailed: 1 })
  expect((await rowsOf(photoId))[0]?.storageDeletedAt).toBeNull()

  fake.control.failRemove = false
  const working = await sweepPhotos(testDb, fake.storage)
  expect(working).toMatchObject({ pendingRemoved: 1, pendingFailed: 0 })
  expect((await rowsOf(photoId))[0]?.storageDeletedAt).not.toBeNull()
  expect(fake.objects.has(photoPath(groupId, photoId))).toBe(false)

  const removesBefore = fake.callsOf("remove").length
  const again = await sweepPhotos(testDb, fake.storage)
  expect(again).toMatchObject({ pendingRemoved: 0, pendingFailed: 0 })
  expect(fake.callsOf("remove").length).toBe(removesBefore)
})

test("sweep leaves a pending removal younger than 5 minutes to the API's own attempt", async () => {
  const { fake, upload, owner, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await upload(itemId, { photoId })
  fake.control.failRemove = true
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${photoId}`)
  fake.control.failRemove = false

  const result = await sweepPhotos(testDb, fake.storage)

  expect(result).toMatchObject({ pendingRemoved: 0, pendingFailed: 0 })
  expect(fake.objects.size).toBe(1)
})

test("sweep removes only old objects that have no row at all", async () => {
  const { fake, upload, itemId, groupId, owner } = await setupPhotos()
  const withRow = crypto.randomUUID()
  await upload(itemId, { photoId: withRow })
  fake.age(photoPath(groupId, withRow), 2 * 60 * MIN)
  const softDeleted = crypto.randomUUID()
  await upload(itemId, { photoId: softDeleted })
  fake.control.failRemove = true
  await owner.req("DELETE", `/v1/items/${itemId}/photos/${softDeleted}`)
  fake.control.failRemove = false
  fake.age(photoPath(groupId, softDeleted), 2 * 60 * MIN)
  const oldOrphan = photoPath(groupId, crypto.randomUUID())
  const youngOrphan = photoPath(groupId, crypto.randomUUID())
  const stranger = `${groupId}/readme.txt`
  fake.put(oldOrphan, 2 * 60 * MIN)
  fake.put(youngOrphan, 30 * MIN)
  fake.put(stranger, 2 * 60 * MIN)

  const result = await sweepPhotos(testDb, fake.storage)

  expect(result).toMatchObject({ orphansRemoved: 1, orphansKept: 2, orphansBusy: 0 })
  expect([...fake.objects.keys()].toSorted()).toEqual(
    [
      photoPath(groupId, withRow),
      photoPath(groupId, softDeleted),
      youngOrphan,
      stranger,
    ].toSorted(),
  )
})

test("sweep does not delete an object whose row is committed while the sweep waits on the photoId lock", async () => {
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 2 * 60 * MIN)
  const locked = Promise.withResolvers<void>()
  // 登録 transaction が photoId の lock を持ち、行を入れたがまだ commit していない
  const registration = testDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${photoId}::text, 0))`)
    await insertPhotoRow(tx, { id: photoId, groupId, itemId, userId: ownerId, size: 10 })
    locked.resolve()
    await sleep(300)
  })
  await locked.promise

  const result = await sweepPhotos(testDb, fake.storage)
  await registration

  expect(result).toMatchObject({ orphansRemoved: 0, orphansKept: 1 })
  expect(fake.objects.has(path)).toBe(true)
})

test("sweep skips an object whose lock it cannot get in time and does not delete it", async () => {
  const { fake, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 2 * 60 * MIN)
  const locked = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const holder = testDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${photoId}::text, 0))`)
    locked.resolve()
    await release.promise
  })
  await locked.promise

  const result = await sweepPhotos(testDb, fake.storage)
  release.resolve()
  await holder

  expect(result).toMatchObject({ orphansRemoved: 0, orphansBusy: 1 })
  expect(fake.objects.has(path)).toBe(true)
})

test("sweep: a row that appears between the listing and the check keeps the object", async () => {
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 2 * 60 * MIN)
  const listing = fake.storage.listObjects
  fake.storage.listObjects = async () => {
    const objects = await listing()
    await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 10 })
    return objects
  }

  const result = await sweepPhotos(testDb, fake.storage)

  expect(result).toMatchObject({ orphansRemoved: 0, orphansKept: 1 })
  expect(fake.objects.has(path)).toBe(true)
})

test("an upload form sent without a photoId field never reaches Storage", async () => {
  const { fake, owner, itemId } = await setupPhotos()

  const res = await owner.req("POST", `/v1/items/${itemId}/photos`, photoForm({ photoId: null }))

  expect(res.status).toBe(422)
  expect(fake.calls).toEqual([])
})
