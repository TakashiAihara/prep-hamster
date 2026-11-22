import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { createDb, itemPhotos, items as itemsTable, type Db } from "@prep-hamster/db"
import { PHOTOS_PER_ITEM_MAX } from "@prep-hamster/schema"
import { photoPath } from "../src/photos/config"
import { exitCodeFor } from "../src/jobs/photo-sweep"
import {
  checkCapEarly,
  registerPhoto,
  removeObjectOf,
  signPaths,
  sweepPhotos,
} from "../src/photos/service"
import type { FakePhotoStorage } from "./fake-photo-storage"
import { bearer } from "./auth-helper"
import { jpeg, photoForm, setupPhotos } from "./photo-helper"
import { seedGroupWithMembership, seedItem, seedUser } from "./seed"
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

// photoId の lock を待っている接続が現れるまで見に行く。固定時間の待ちでは、待ちに入ったことを確かめられない
async function waitForAdvisoryWaiter() {
  for (let i = 0; i < 60; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const rows = (await testDb.execute(
      sql`select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and wait_event = 'advisory' and datname = current_database()`,
    )) as unknown as Array<{ n: number }>
    if ((rows[0]?.n ?? 0) >= 1) return
    // oxlint-disable-next-line no-await-in-loop
    await sleep(25)
  }
  throw new Error("no advisory lock waiter appeared")
}

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
  fake.put(photoPath(groupId, photoId), 5 * MIN, 1000)

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
  fake.control.beforeStat = async () => {
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
  fake.control.beforeStat = async () => {
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
  fake.control.beforeStat = async () => {
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
  fake.put(photoPath(groupId, photoId), 5 * MIN, 400)
  fake.control.beforeStat = async () => {
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
  fake.put(photoPath(groupId, photoId), 5 * MIN, 400)
  fake.control.beforeStat = async () => {
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
  let executes = 0
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
                    // 登録 transaction の execute は 1 つ目が lock_timeout の設定、2 つ目が photoId の lock。取れた直後で止める
                    return async (...args: unknown[]) => {
                      const r = await (t.execute as (...a: unknown[]) => Promise<unknown>)(...args)
                      if (++executes === 2) {
                        entered.resolve()
                        await proceed.promise
                      }
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
  await waitForAdvisoryWaiter()
  proceed.resolve()
  const [res, result] = await Promise.all([pending, swept])

  expect(res.status).toBe(201)
  expect(result).toMatchObject({ orphansRemoved: 0, orphansKept: 1 })
  expect(fake.objects.has(photoPath(groupId, photoId))).toBe(true)
  expect(await rowsOf(photoId)).toHaveLength(1)
})

test("an adopted object is not deleted when the registration is refused as too late", async () => {
  const t = Date.parse("2026-11-22T00:00:00Z")
  // 時計の読みは object を置く (1)、route の開始 (2)、引き取りの確認 (3)、登録の期限の検査 (4)。4 回目から 6 分進める
  let reads = 0
  const { fake, upload, itemId, groupId } = await setupPhotos({
    now: () => t + (++reads >= 4 ? 6 * MIN : 0),
  })
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  // 引き取りの確認の時点では 15 分 (若い)。登録の期限の検査では object の作成から 21 分になる
  fake.put(path, 15 * MIN, 1000)

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
  fake.put(path, 5 * MIN, 1000)

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
  const commit = Promise.withResolvers<void>()
  // 登録 transaction が photoId の lock を持ち、行を入れたがまだ commit していない
  const registration = testDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${photoId}::text, 0))`)
    await insertPhotoRow(tx, { id: photoId, groupId, itemId, userId: ownerId, size: 10 })
    locked.resolve()
    await commit.promise
  })
  await locked.promise

  const swept = sweepPhotos(testDb, fake.storage)
  // sweep が lock の待ちに入ったことを見てから commit させる
  await waitForAdvisoryWaiter()
  commit.resolve()
  const result = await swept
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
  fake.storage.listObjects = async (olderThan, limit) => {
    const objects = await listing(olderThan, limit)
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

// ---- review follow-ups ----

test("a young object of another size is not adopted: 422, the object stays, nothing is deleted", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN, 999)

  const res = await upload(itemId, { photoId, bytes: jpeg(1000) })

  expect(res.status).toBe(422)
  expect((await json(res)).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
  expect(fake.objects.get(path)?.size).toBe(999)
  expect(fake.callsOf("remove")).toEqual([])
  expect(await rowsOf(photoId)).toEqual([])
})

test("an adopted object that is removed before the registration is uploaded again, and no row points at nothing", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN, 1000)
  // 引き取りの確認の直後に、元の要求の補償の削除が object を消す
  fake.control.afterStat = async () => {
    fake.objects.delete(path)
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(1000) })

  expect(res.status).toBe(201)
  expect(fake.objects.get(path)?.size).toBe(1000)
  expect(fake.callsOf("upload")).toHaveLength(2)
  expect(await rowsOf(photoId)).toHaveLength(1)
})

test("an object younger than 20 minutes is adopted and one older than 20 minutes is replaced", async () => {
  const young = await setupPhotos()
  const youngId = crypto.randomUUID()
  young.fake.put(photoPath(young.groupId, youngId), 19 * MIN, 1000)
  const youngRes = await young.upload(young.itemId, { photoId: youngId })
  expect(youngRes.status).toBe(201)
  expect(young.fake.callsOf("remove")).toEqual([])
  expect(young.fake.callsOf("upload")).toHaveLength(1)

  const stale = await setupPhotos()
  const staleId = crypto.randomUUID()
  stale.fake.put(photoPath(stale.groupId, staleId), 21 * MIN, 1000)
  const staleRes = await stale.upload(stale.itemId, { photoId: staleId })
  expect(staleRes.status).toBe(201)
  expect(stale.fake.callsOf("remove")).toHaveLength(1)
  expect(stale.fake.callsOf("upload")).toHaveLength(2)
})

test("sweep removes an object whose photoId row lives under another group's path, and keeps that row's object", async () => {
  const { fake, groupId, ownerId } = await setupPhotos()
  const otherGroup = await seedGroupWithMembership(ownerId, "B")
  const otherItem = await seedItem(otherGroup, "B item")
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, {
    id: photoId,
    groupId: otherGroup,
    itemId: otherItem,
    userId: ownerId,
    size: 10,
  })
  const lost = photoPath(groupId, photoId)
  const owned = photoPath(otherGroup, photoId)
  fake.put(lost, 2 * 60 * MIN)
  fake.put(owned, 2 * 60 * MIN)

  const result = await sweepPhotos(testDb, fake.storage)

  expect(result).toMatchObject({ orphansRemoved: 1, orphansKept: 1 })
  expect(fake.objects.has(lost)).toBe(false)
  expect(fake.objects.has(owned)).toBe(true)
})

test("sweep removes an object left at the path of a row whose object removal already finished", async () => {
  const { fake, itemId, groupId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  await insertPhotoRow(testDb, { id: photoId, groupId, itemId, userId: ownerId, size: 10 })
  await testDb
    .update(itemPhotos)
    .set({ deletedAt: new Date("2026-01-01T00:00:00Z"), storageDeletedAt: new Date("2026-01-01") })
    .where(eq(itemPhotos.id, photoId))
  const path = photoPath(groupId, photoId)
  fake.put(path, 2 * 60 * MIN)

  const result = await sweepPhotos(testDb, fake.storage)

  expect(result).toMatchObject({ orphansRemoved: 1 })
  expect(fake.objects.has(path)).toBe(false)
})

test("sweep reads an upper-case object name as the same photoId and removes the orphan", async () => {
  const { fake, groupId } = await setupPhotos()
  const path = `${groupId}/${crypto.randomUUID().toUpperCase()}.jpg`
  fake.put(path, 2 * 60 * MIN)

  const result = await sweepPhotos(testDb, fake.storage)

  expect(result).toMatchObject({ orphansRemoved: 1 })
  expect(fake.objects.has(path)).toBe(false)
})

test("the photoId lock is the same for upper and lower case: a held lower-case lock makes the sweep of an upper-case name busy", async () => {
  const { fake, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = `${groupId}/${photoId.toUpperCase()}.jpg`
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

  expect(result).toMatchObject({ orphansRemoved: 0, orphansBusy: 1, orphansFailed: 0 })
  expect(fake.objects.has(path)).toBe(true)
})

test("sweep counts a Storage failure on an orphan as failed, not busy, and the job exits non-zero", async () => {
  const { fake, groupId } = await setupPhotos()
  const path = photoPath(groupId, crypto.randomUUID())
  fake.put(path, 2 * 60 * MIN)
  fake.control.failRemove = true

  const result = await sweepPhotos(testDb, fake.storage)

  expect(result).toMatchObject({ orphansFailed: 1, orphansBusy: 0, orphansRemoved: 0 })
  expect(exitCodeFor(result)).toBe(1)
})

test("the sweep job exits 0 when nothing failed, also when objects were only busy", () => {
  const base = {
    pendingRemoved: 0,
    pendingFailed: 0,
    orphansRemoved: 0,
    orphansKept: 0,
    orphansBusy: 3,
    orphansFailed: 0,
  }

  expect(exitCodeFor(base)).toBe(0)
  expect(exitCodeFor({ ...base, pendingFailed: 1 })).toBe(1)
})

test("sweep asks Storage for objects older than 60 minutes, at most 500", async () => {
  const { fake } = await setupPhotos()
  const t = Date.parse("2026-11-22T00:00:00Z")

  await sweepPhotos(testDb, fake.storage, () => t)

  expect(fake.callsOf("list")).toEqual([
    { op: "list", olderThan: new Date(t - 60 * MIN), limit: 500 },
  ])
})

test("a database error after the object was removed leaves the row pending instead of throwing", async () => {
  const { fake } = await setupPhotos()
  const brokenDb = {
    update: () => {
      throw new Error("connection lost")
    },
  } as unknown as Db
  fake.put("g/p.jpg")

  const result = await removeObjectOf(
    brokenDb,
    fake.storage,
    { id: "p", storagePath: "g/p.jpg" },
    Date.now,
  )

  expect(result).toBe("failed")
  expect(fake.objects.has("g/p.jpg")).toBe(false)
})

test("a registration waits for the photoId lock only up to its lock timeout", async () => {
  const { groupId, itemId, ownerId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const locked = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const holder = testDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${photoId}::text, 0))`)
    locked.resolve()
    await release.promise
  })
  await locked.promise
  const input = {
    groupId,
    itemId,
    byteSize: 10,
    photoId,
    userId: ownerId,
    storagePath: photoPath(groupId, photoId),
    width: null,
    height: null,
    uploadStartedAt: Date.now(),
  }

  const started = Date.now()
  await expect(registerPhoto(testDb, input, Date.now, 5, "200ms")).rejects.toThrow()
  const waited = Date.now() - started
  release.resolve()
  await holder

  expect(waited).toBeGreaterThanOrEqual(150)
  expect(waited).toBeLessThan(3000)
})

test("a cover needs the item to belong to the group the photo row names", async () => {
  const { fake, groupId, itemId, ownerId, as } = await setupPhotos()
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
  // 署名できる object があるので、item の group の条件が無ければ cover に入ってしまう
  fake.put(photoPath(strangerGroup, photoId))
  const stranger = await as(strangerId)

  const res = await stranger.req("GET", `/v1/items/photos?groupId=${strangerGroup}`)

  expect(groupId).not.toBe(strangerGroup)
  expect(await json(res)).toEqual({ covers: [] })
})

test("an upper-case item id in the path still replays a recorded photo with 200", async () => {
  const { upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const first = await upload(itemId.toUpperCase(), { photoId, bytes: jpeg(300) })

  const again = await upload(itemId.toUpperCase(), { photoId, bytes: jpeg(300) })

  expect(first.status).toBe(201)
  expect(again.status).toBe(200)
})

test("no connection is held across the upload: with a single database connection a tag PUT still completes", async () => {
  const single = createDb(TEST_DB_URL, { max: 1 })
  const { fake, upload, app, ownerId, itemId } = await setupPhotos({ db: single })
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

test("a registration waits out a short hold of the photoId lock and then succeeds", async () => {
  const { upload, itemId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const locked = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const holder = testDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${photoId}::text, 0))`)
    locked.resolve()
    await release.promise
  })
  await locked.promise

  const pending = upload(itemId, { photoId })
  await waitForAdvisoryWaiter()
  await sleep(200)
  release.resolve()
  await holder
  const res = await pending

  expect(res.status).toBe(201)
})

test("an adopted object that vanishes is uploaded again; the new object is cleaned up if the registration then fails", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN, 1000)
  // 最初の確認 (stat) の後で object を消す。2 回目の upload の時に item を消して、2 回目の登録を失敗させる
  fake.control.afterStat = async () => {
    fake.objects.delete(path)
  }
  let uploads = 0
  fake.control.onUploadReached = async () => {
    if (++uploads === 2) {
      await testDb
        .update(itemsTable)
        .set({ deletedAt: new Date() })
        .where(eq(itemsTable.id, itemId))
    }
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(1000) })

  expect(res.status).toBe(404)
  expect(fake.callsOf("remove")).toEqual([{ op: "remove", path }])
  expect(fake.objects.has(path)).toBe(false)
  // 引き取り (inspect) と、最初の登録の確認の 2 回。置き直した後の登録は確認しない
  expect(fake.callsOf("stat")).toHaveLength(2)
})

test("after an adopted object vanished, the new registration deadline counts from the new upload", async () => {
  let t = Date.parse("2026-11-22T00:00:00Z")
  const { fake, upload, itemId, groupId } = await setupPhotos({ now: () => t })
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 1 * MIN, 1000)
  fake.control.afterStat = async () => {
    fake.objects.delete(path)
    t += 10 * MIN
  }
  let uploads = 0
  fake.control.onUploadReached = () => {
    // 2 回目の upload が Storage で 12 分かかった
    if (++uploads === 2) t += 12 * MIN
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(1000) })

  expect(res.status).toBe(201)
})

test("when the re-upload of a vanished adopted object fails, the answer is 502 and no row exists", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN, 1000)
  fake.control.afterStat = async () => {
    fake.objects.delete(path)
  }
  let uploads = 0
  fake.control.onUploadReached = () => {
    if (++uploads === 2) fake.control.failUpload = true
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(1000) })

  expect(res.status).toBe(502)
  expect(await rowsOf(photoId)).toEqual([])
})

test("when the re-upload of a vanished adopted object meets an existing object again, the answer is 503", async () => {
  const { fake, upload, itemId, groupId } = await setupPhotos()
  const photoId = crypto.randomUUID()
  const path = photoPath(groupId, photoId)
  fake.put(path, 5 * MIN, 1000)
  fake.control.afterStat = async () => {
    fake.objects.delete(path)
  }
  let uploads = 0
  fake.control.onUploadReached = () => {
    if (++uploads === 2) fake.control.uploadAlwaysExists = true
  }

  const res = await upload(itemId, { photoId, bytes: jpeg(1000) })

  expect(res.status).toBe(503)
  expect(await rowsOf(photoId)).toEqual([])
})
