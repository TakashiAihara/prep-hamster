import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { stockEvents, stocks } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedItem, seedLocation, seedStock, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { bearer, e2eAuth } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const EVENT_ID = "0b1e4c2a-7f3d-4e5b-9a6c-1d2e3f4a5b6c"
const OTHER_EVENT_ID = "9c8b7a6f-5e4d-4c3b-8a2f-1e0d9c8b7a6f"

type ActionBody = {
  stock: { id: string; quantity: number }
  event: { id: string; eventType: string; quantityDelta: number; reason: string | null }
}

async function setup(quantity = 10) {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const locationId = await seedLocation(groupId, "Pantry")
  const itemId = await seedItem(groupId, "Apple")
  const stockId = await seedStock(groupId, itemId, locationId, quantity)
  const app = createApp({ db: testDb, auth: e2eAuth })
  const auth = await bearer(userId)
  const post = (id: string, action: "consume" | "discard", body: Record<string, unknown>) =>
    app.request(`/v1/stocks/${id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
    })
  return { groupId, locationId, itemId, stockId, post }
}

async function quantityOf(stockId: string) {
  const [row] = await testDb.select().from(stocks).where(eq(stocks.id, stockId))
  return row?.quantity
}

async function eventsOf(stockId: string) {
  return testDb.select().from(stockEvents).where(eq(stockEvents.stockId, stockId))
}

test("consume with an eventId records the event under that id", async () => {
  const { stockId, post } = await setup(10)

  const res = await post(stockId, "consume", {
    quantityDelta: 3,
    reason: "lunch",
    eventId: EVENT_ID,
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as ActionBody
  expect(body.event.id).toBe(EVENT_ID)
  expect(body.stock.quantity).toBe(7)
  expect((await eventsOf(stockId)).map((e) => e.id)).toEqual([EVENT_ID])
})

test("resending the same consume returns the recorded event without applying it twice", async () => {
  const { stockId, post } = await setup(10)

  const first = await post(stockId, "consume", {
    quantityDelta: 3,
    reason: "lunch",
    eventId: EVENT_ID,
  })
  const second = await post(stockId, "consume", {
    quantityDelta: 3,
    reason: "lunch",
    eventId: EVENT_ID,
  })

  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  const firstBody = (await first.json()) as ActionBody
  const secondBody = (await second.json()) as ActionBody
  expect(secondBody.event).toEqual(firstBody.event)
  expect(secondBody.stock.quantity).toBe(7)
  expect(await quantityOf(stockId)).toBe(7)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("a resend is answered from the record even when the remaining quantity is now too small", async () => {
  // 5 から 4 を消費した後の再送は、残り 1 との比較で数量不足にせず、記録済みの結果を返す
  const { stockId, post } = await setup(5)

  await post(stockId, "consume", { quantityDelta: 4, eventId: EVENT_ID })
  const resend = await post(stockId, "consume", { quantityDelta: 4, eventId: EVENT_ID })

  expect(resend.status).toBe(200)
  expect(((await resend.json()) as ActionBody).stock.quantity).toBe(1)
  expect(await quantityOf(stockId)).toBe(1)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("resending the same discard returns the recorded event without applying it twice", async () => {
  const { stockId, post } = await setup(8)

  const first = await post(stockId, "discard", {
    quantityDelta: 2,
    reason: "expired",
    eventId: EVENT_ID,
  })
  const second = await post(stockId, "discard", {
    quantityDelta: 2,
    reason: "expired",
    eventId: EVENT_ID,
  })

  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  const secondBody = (await second.json()) as ActionBody
  expect(secondBody.event.id).toBe(EVENT_ID)
  expect(secondBody.event.eventType).toBe("DISCARD")
  expect(await quantityOf(stockId)).toBe(6)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("reusing an eventId with a different quantity returns 422 and changes nothing", async () => {
  const { stockId, post } = await setup(10)

  await post(stockId, "consume", { quantityDelta: 3, eventId: EVENT_ID })
  const res = await post(stockId, "consume", { quantityDelta: 2, eventId: EVENT_ID })

  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "IDEMPOTENCY_KEY_REUSED",
  )
  expect(await quantityOf(stockId)).toBe(7)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("reusing an eventId with a different reason returns 422", async () => {
  const { stockId, post } = await setup(10)

  await post(stockId, "consume", { quantityDelta: 3, reason: "lunch", eventId: EVENT_ID })
  const res = await post(stockId, "consume", {
    quantityDelta: 3,
    reason: "dinner",
    eventId: EVENT_ID,
  })

  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "IDEMPOTENCY_KEY_REUSED",
  )
  expect(await quantityOf(stockId)).toBe(7)
})

test("reusing a consume eventId for a discard returns 422", async () => {
  const { stockId, post } = await setup(10)

  await post(stockId, "consume", { quantityDelta: 3, eventId: EVENT_ID })
  const res = await post(stockId, "discard", { quantityDelta: 3, eventId: EVENT_ID })

  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "IDEMPOTENCY_KEY_REUSED",
  )
  expect(await quantityOf(stockId)).toBe(7)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("reusing an eventId on another stock returns 422 and leaves that stock alone", async () => {
  const { groupId, locationId, itemId, stockId, post } = await setup(10)
  const otherStockId = await seedStock(groupId, itemId, locationId, 4)

  await post(stockId, "consume", { quantityDelta: 3, eventId: EVENT_ID })
  const res = await post(otherStockId, "consume", { quantityDelta: 3, eventId: EVENT_ID })

  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
    "IDEMPOTENCY_KEY_REUSED",
  )
  expect(await quantityOf(otherStockId)).toBe(4)
  expect(await eventsOf(otherStockId)).toHaveLength(0)
})

test("concurrent requests with the same eventId apply the consume once", async () => {
  const { stockId, post } = await setup(10)

  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      post(stockId, "consume", { quantityDelta: 1, eventId: EVENT_ID }),
    ),
  )

  expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
  const bodies = (await Promise.all(responses.map((r) => r.json()))) as ActionBody[]
  expect(new Set(bodies.map((b) => b.event.id))).toEqual(new Set([EVENT_ID]))
  expect(await quantityOf(stockId)).toBe(9)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("different eventIds are applied separately", async () => {
  const { stockId, post } = await setup(10)

  await post(stockId, "consume", { quantityDelta: 3, eventId: EVENT_ID })
  await post(stockId, "consume", { quantityDelta: 3, eventId: OTHER_EVENT_ID })

  expect(await quantityOf(stockId)).toBe(4)
  expect((await eventsOf(stockId)).map((e) => e.id).toSorted()).toEqual(
    [EVENT_ID, OTHER_EVENT_ID].toSorted(),
  )
})

test("requests without an eventId keep being applied each time", async () => {
  const { stockId, post } = await setup(10)

  await post(stockId, "consume", { quantityDelta: 3 })
  await post(stockId, "consume", { quantityDelta: 3 })

  expect(await quantityOf(stockId)).toBe(4)
  expect(await eventsOf(stockId)).toHaveLength(2)
})

test("an eventId that is not a uuid is rejected with 422", async () => {
  const { stockId, post } = await setup(10)

  const res = await post(stockId, "consume", { quantityDelta: 3, eventId: "not-a-uuid" })

  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR")
  expect(await quantityOf(stockId)).toBe(10)
})

test("a discard resend is answered from the record even when the remaining quantity is now too small", async () => {
  const { stockId, post } = await setup(5)

  await post(stockId, "discard", { quantityDelta: 4, eventId: EVENT_ID })
  const resend = await post(stockId, "discard", { quantityDelta: 4, eventId: EVENT_ID })

  expect(resend.status).toBe(200)
  expect(((await resend.json()) as ActionBody).stock.quantity).toBe(1)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

// 別の接続で在庫の行を FOR UPDATE で押さえ、release で放して commit まで待つ
async function holdStockRow(stockId: string) {
  const held = Promise.withResolvers<void>()
  const taken = Promise.withResolvers<void>()
  const locker = testDb.transaction(async (tx) => {
    await tx.execute(sql`select id from stocks where id = ${stockId} for update`)
    taken.resolve()
    await held.promise
  })
  await taken.promise
  return {
    release: async () => {
      held.resolve()
      await locker
    },
  }
}

async function waitForLockWaiters(count: number) {
  // 待ちの数が揃うまで順に見に行くポーリングなので、ループの中で待つ
  for (let i = 0; i < 100; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const rows = (await testDb.execute(
      // 共有の Postgres なので、この DB で在庫を更新しようとして待っている要求だけを数える
      sql`select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and datname = current_database()
            and query ilike 'update "stocks"%'`,
    )) as unknown as Array<{ n: number }>
    if ((rows[0]?.n ?? 0) >= count) return
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`lock waiters did not reach ${count}`)
}

test("a duplicate that collides at the event insert is answered from the record", async () => {
  // 在庫の行を押さえて 2 本とも記録の照会を通り抜けさせ、数量更新で待たせてから放す。
  // 先に commit した 1 本の後、もう 1 本は eventId の主キー重複で rollback する経路に入る
  const { stockId, post } = await setup(10)
  const lock = await holdStockRow(stockId)

  const pending = [
    post(stockId, "consume", { quantityDelta: 1, eventId: EVENT_ID }),
    post(stockId, "consume", { quantityDelta: 1, eventId: EVENT_ID }),
  ]
  await waitForLockWaiters(2)
  await lock.release()
  const responses = await Promise.all(pending)

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  const bodies = (await Promise.all(responses.map((r) => r.json()))) as ActionBody[]
  expect(bodies.map((b) => b.event.id)).toEqual([EVENT_ID, EVENT_ID])
  expect(await quantityOf(stockId)).toBe(9)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("a duplicate that collides at the insert with different content returns 422", async () => {
  const { stockId, post } = await setup(10)
  const lock = await holdStockRow(stockId)

  const pending = [
    post(stockId, "consume", { quantityDelta: 1, eventId: EVENT_ID }),
    post(stockId, "consume", { quantityDelta: 2, eventId: EVENT_ID }),
  ]
  await waitForLockWaiters(2)
  await lock.release()
  const responses = await Promise.all(pending)
  const statuses = responses.map((r) => r.status).toSorted()

  expect(statuses).toEqual([200, 422])
  // 負けた 1 本の数量更新は rollback され、勝った 1 本の分だけが残る
  const winner = responses.find((r) => r.status === 200)
  const won = (await winner?.json()) as ActionBody
  expect(await quantityOf(stockId)).toBe(10 + won.event.quantityDelta)
  expect(won.stock.quantity).toBe(10 + won.event.quantityDelta)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("a discard duplicate that collides at the event insert is answered from the record", async () => {
  const { stockId, post } = await setup(10)
  const lock = await holdStockRow(stockId)

  const pending = [
    post(stockId, "discard", { quantityDelta: 1, eventId: EVENT_ID }),
    post(stockId, "discard", { quantityDelta: 1, eventId: EVENT_ID }),
  ]
  await waitForLockWaiters(2)
  await lock.release()
  const responses = await Promise.all(pending)

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  const bodies = (await Promise.all(responses.map((r) => r.json()))) as ActionBody[]
  expect(bodies.map((b) => [b.event.id, b.event.eventType, b.event.quantityDelta])).toEqual([
    [EVENT_ID, "DISCARD", -1],
    [EVENT_ID, "DISCARD", -1],
  ])
  expect(await quantityOf(stockId)).toBe(9)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("resending a quantity that a real column cannot store exactly still replays", async () => {
  // quantity_delta は単精度なので、保存値と送った倍精度の値は === では一致しない
  const { stockId, post } = await setup(10)

  for (const quantityDelta of [0.123456789, 1 / 3]) {
    const eventId = quantityDelta === 1 / 3 ? OTHER_EVENT_ID : EVENT_ID
    // oxlint-disable-next-line no-await-in-loop
    const first = await post(stockId, "consume", { quantityDelta, eventId })
    // oxlint-disable-next-line no-await-in-loop
    const resend = await post(stockId, "consume", { quantityDelta, eventId })
    expect(first.status).toBe(200)
    expect(resend.status).toBe(200)
  }
  expect(await eventsOf(stockId)).toHaveLength(2)
})

test("a quantity that differs beyond the real column precision is still treated as different", async () => {
  const { stockId, post } = await setup(10)

  await post(stockId, "consume", { quantityDelta: 0.5, eventId: EVENT_ID })
  const res = await post(stockId, "consume", { quantityDelta: 0.5001, eventId: EVENT_ID })

  expect(res.status).toBe(422)
})
