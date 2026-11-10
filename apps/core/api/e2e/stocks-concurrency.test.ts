import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { stockEvents, stocks } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedItem, seedLocation, seedStock, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { bearer, e2eAuth } from "./auth-helper"
import { holdStockRow, waitForLockWaiters } from "./lock-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

async function setup(quantity: number) {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const locationId = await seedLocation(groupId, "Pantry")
  const itemId = await seedItem(groupId, "Apple")
  const stockId = await seedStock(groupId, itemId, locationId, quantity)
  const app = createApp({ db: testDb, auth: e2eAuth })
  const auth = await bearer(userId)
  const remove = () =>
    app.request(`/v1/stocks/${stockId}`, { method: "DELETE", headers: { authorization: auth } })
  const move = (toLocationId: string) =>
    app.request(`/v1/stocks/${stockId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ toLocationId }),
    })
  const addLocation = (name: string) => seedLocation(groupId, name)
  const post = (action: "consume" | "discard", quantityDelta: number, eventId?: string) =>
    app.request(`/v1/stocks/${stockId}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(eventId ? { quantityDelta, eventId } : { quantityDelta }),
    })
  return { stockId, locationId, post, remove, move, addLocation }
}

async function quantityOf(stockId: string) {
  const [row] = await testDb.select().from(stocks).where(eq(stocks.id, stockId))
  return row?.quantity
}

async function eventsOf(stockId: string) {
  return testDb.select().from(stockEvents).where(eq(stockEvents.stockId, stockId))
}

// 在庫の行を押さえて、全部が数量を読んだ後の更新で待たせてから放す。
// 読んだ数量から計算した値を書き戻す作りだと、後の 1 本が先の減算を上書きする。
// 1 本ずつ待ち行列に入れるので、行ロックを取る順は配列の順になる
async function race(stockId: string, requests: Array<() => Response | Promise<Response>>) {
  const lock = await holdStockRow(stockId)
  const pending: Array<Response | Promise<Response>> = []
  try {
    for (const send of requests) {
      pending.push(send())
      // oxlint-disable-next-line no-await-in-loop -- 順に並べるため 1 本ずつ待つ
      await waitForLockWaiters(pending.length)
    }
  } finally {
    await lock.release()
  }
  return Promise.all(pending)
}

test("two concurrent consumes both subtract their quantity", async () => {
  const { stockId, post } = await setup(10)

  const responses = await race(stockId, [() => post("consume", 3), () => post("consume", 4)])

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  expect(await quantityOf(stockId)).toBe(3)
  expect(await eventsOf(stockId)).toHaveLength(2)
})

test("a concurrent consume and discard both subtract their quantity", async () => {
  const { stockId, post } = await setup(10)

  const responses = await race(stockId, [() => post("consume", 2), () => post("discard", 5)])

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  expect(await quantityOf(stockId)).toBe(3)
  expect(await eventsOf(stockId)).toHaveLength(2)
})

test("each response returns the quantity left after its own subtraction", async () => {
  const { stockId, post } = await setup(10)

  const responses = await race(stockId, [() => post("consume", 3), () => post("consume", 4)])

  const quantities = (await Promise.all(responses.map((r) => r.json()))) as Array<{
    stock: { quantity: number }
  }>
  // 3 を引く要求と 4 を引く要求のどちらが先に通るかで、応答の組は 2 通りに決まる
  const pair = quantities.map((b) => b.stock.quantity).join(",")
  expect(["7,3", "3,6"]).toContain(pair)
})

test("when concurrent consumes together exceed the stock, only the ones that fit are applied", async () => {
  const { stockId, post } = await setup(5)

  const responses = await race(stockId, [() => post("consume", 3), () => post("consume", 3)])

  expect(responses.map((r) => r.status).toSorted()).toEqual([200, 422])
  const rejected = responses.find((r) => r.status === 422)
  if (!rejected) throw new Error("no rejected response")
  expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
    "INSUFFICIENT_QUANTITY",
  )
  expect(await quantityOf(stockId)).toBe(2)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

// 削除する側が行を押さえたまま削除を済ませ、要求は早期チェック (まだ削除前に見える) を通ってから待たされる
async function raceAgainstDelete(stockId: string, send: () => Response | Promise<Response>) {
  const held = Promise.withResolvers<void>()
  const taken = Promise.withResolvers<void>()
  const deleter = testDb.transaction(async (tx) => {
    await tx.execute(sql`select id from stocks where id = ${stockId} for update`)
    await tx.execute(sql`update stocks set deleted_at = now() where id = ${stockId}`)
    taken.resolve()
    await held.promise
  })
  await Promise.race([taken.promise, deleter])
  const pending = send()
  try {
    await waitForLockWaiters(1)
  } finally {
    held.resolve()
    await deleter
  }
  return pending
}

test("a consume that loses the race to a delete returns 404 without recording an event", async () => {
  const { stockId, post } = await setup(10)

  const res = await raceAgainstDelete(stockId, () => post("consume", 3))

  expect(res.status).toBe(404)
  expect(await eventsOf(stockId)).toHaveLength(0)
  expect(await quantityOf(stockId)).toBe(10)
})

test("a discard that loses the race to a delete returns 404 without recording an event", async () => {
  const { stockId, post } = await setup(10)

  const res = await raceAgainstDelete(stockId, () => post("discard", 3))

  expect(res.status).toBe(404)
  expect(await eventsOf(stockId)).toHaveLength(0)
  expect(await quantityOf(stockId)).toBe(10)
})

test("when concurrent discards together exceed the stock, only the ones that fit are applied", async () => {
  const { stockId, post } = await setup(5)

  const responses = await race(stockId, [() => post("discard", 3), () => post("discard", 3)])

  expect(responses.map((r) => r.status).toSorted()).toEqual([200, 422])
  expect(await quantityOf(stockId)).toBe(2)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("a resend that finds the stock already too low after the race is answered from the record", async () => {
  // 5 に同じ eventId の消費 4 が 2 本。後の 1 本は残量 1 で更新できないが、正しい再送なので記録済みの結果を返す
  const eventId = "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f"
  const { stockId, post } = await setup(5)

  const responses = await race(stockId, [
    () => post("consume", 4, eventId),
    () => post("consume", 4, eventId),
  ])

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{
    event: { id: string }
  }>
  expect(bodies.map((b) => b.event.id)).toEqual([eventId, eventId])
  expect(await quantityOf(stockId)).toBe(1)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("a discard resend that finds the stock already too low after the race is answered from the record", async () => {
  const eventId = "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d"
  const { stockId, post } = await setup(5)

  const responses = await race(stockId, [
    () => post("discard", 4, eventId),
    () => post("discard", 4, eventId),
  ])

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  expect(await quantityOf(stockId)).toBe(1)
  expect(await eventsOf(stockId)).toHaveLength(1)
})

test("a delete that waits behind a consume discards only what the consume left", async () => {
  // 削除は消費より前に数量 10 を読んでいるが、廃棄として残すのは消費後の 7
  const { stockId, post, remove } = await setup(10)

  const statuses = (await race(stockId, [() => post("consume", 3), () => remove()])).map(
    (r) => r.status,
  )

  expect(statuses).toEqual([200, 204])
  const events = await eventsOf(stockId)
  expect(events.map((e) => [e.eventType, e.quantityDelta]).toSorted()).toEqual([
    ["CONSUME", -3],
    ["DISCARD", -7],
  ])
})

test("a delete that waits behind a consume emptying the stock records no discard", async () => {
  const { stockId, post, remove } = await setup(10)

  const statuses = (await race(stockId, [() => post("consume", 10), () => remove()])).map(
    (r) => r.status,
  )

  expect(statuses).toEqual([200, 204])
  const events = await eventsOf(stockId)
  expect(events.map((e) => [e.eventType, e.quantityDelta])).toEqual([["CONSUME", -10]])
})

test("two concurrent deletes record a single discard event", async () => {
  const { stockId, remove } = await setup(10)

  const responses = await race(stockId, [() => remove(), () => remove()])

  expect(responses.map((r) => r.status).toSorted()).toEqual([204, 404])
  const events = await eventsOf(stockId)
  expect(events.map((e) => [e.eventType, e.quantityDelta])).toEqual([["DISCARD", -10]])
})

test("two concurrent moves record the location each move actually left", async () => {
  const { stockId, locationId, move, addLocation } = await setup(10)
  const fridge = await addLocation("Fridge")
  const shelf = await addLocation("Shelf")

  const responses = await race(stockId, [() => move(fridge), () => move(shelf)])

  expect(responses.map((r) => r.status)).toEqual([200, 200])
  const events = await eventsOf(stockId)
  const first = events.find((e) => e.fromLocationId === locationId)
  const second = events.find((e) => e !== first)
  if (!first || !second) throw new Error("expected two move events")
  expect(second.fromLocationId).toBe(first.toLocationId)
  const [row] = await testDb.select().from(stocks).where(eq(stocks.id, stockId))
  expect(row?.locationId).toBe(second.toLocationId ?? "")
})

test("a move that loses the race to a delete returns 404 without recording an event", async () => {
  const { stockId, move, addLocation } = await setup(10)
  const fridge = await addLocation("Fridge")

  const res = await raceAgainstDelete(stockId, () => move(fridge))

  expect(res.status).toBe(404)
  expect(await eventsOf(stockId)).toHaveLength(0)
})

test("two concurrent moves to the same location record one move and reject the other", async () => {
  const { stockId, move, addLocation } = await setup(10)
  const fridge = await addLocation("Fridge")

  const responses = await race(stockId, [() => move(fridge), () => move(fridge)])

  expect(responses.map((r) => r.status).toSorted()).toEqual([200, 422])
  const rejected = responses.find((r) => r.status === 422)
  if (!rejected) throw new Error("no rejected response")
  expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe("MOVE_NOOP")
  expect(await eventsOf(stockId)).toHaveLength(1)
})
