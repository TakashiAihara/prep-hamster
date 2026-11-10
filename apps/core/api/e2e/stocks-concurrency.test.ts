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
  const post = (action: "consume" | "discard", quantityDelta: number, eventId?: string) =>
    app.request(`/v1/stocks/${stockId}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(eventId ? { quantityDelta, eventId } : { quantityDelta }),
    })
  return { stockId, post }
}

async function quantityOf(stockId: string) {
  const [row] = await testDb.select().from(stocks).where(eq(stocks.id, stockId))
  return row?.quantity
}

async function eventsOf(stockId: string) {
  return testDb.select().from(stockEvents).where(eq(stockEvents.stockId, stockId))
}

// 在庫の行を押さえて、2 本とも数量を読んだ後の更新で待たせてから放す。
// 読んだ数量から計算した値を書き戻す作りだと、後の 1 本が先の減算を上書きする
async function race(stockId: string, requests: Array<() => Response | Promise<Response>>) {
  const lock = await holdStockRow(stockId)
  const pending = requests.map((send) => send())
  await waitForLockWaiters(requests.length)
  await lock.release()
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
  // どちらが先に通るかは決まらないが、後の 1 本の応答は 3 (両方を引いた残り)
  expect(quantities.map((b) => b.stock.quantity).toSorted((a, b) => a - b)).toContain(3)
  expect(quantities.map((b) => b.stock.quantity).some((q) => q === 7 || q === 6)).toBe(true)
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

test("a consume that loses the race to a delete returns 404 without recording an event", async () => {
  // 削除する側が行を押さえたまま削除を済ませ、消費は早期チェック (まだ削除前に見える) を通ってから待たされる
  const { stockId, post } = await setup(10)
  const held = Promise.withResolvers<void>()
  const taken = Promise.withResolvers<void>()
  const deleter = testDb.transaction(async (tx) => {
    await tx.execute(sql`select id from stocks where id = ${stockId} for update`)
    await tx.execute(sql`update stocks set deleted_at = now() where id = ${stockId}`)
    taken.resolve()
    await held.promise
  })
  await taken.promise

  const pending = post("consume", 3)
  await waitForLockWaiters(1)
  held.resolve()
  await deleter
  const res = await pending

  expect(res.status).toBe(404)
  expect(await eventsOf(stockId)).toHaveLength(0)
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
  expect(await quantityOf(stockId)).toBe(1)
  expect(await eventsOf(stockId)).toHaveLength(1)
})
