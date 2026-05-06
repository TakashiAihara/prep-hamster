import { beforeAll, beforeEach, expect, test } from "bun:test"
import { and, eq } from "drizzle-orm"
import { stockEvents, stocks } from "@prep-hamster/db"
import { createApp } from "../src/app"
import {
  seedGroupWithMembership,
  seedItem,
  seedLocation,
  seedMembership,
  seedStock,
  seedUser,
} from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

async function setupGroupWithStock(quantity = 10) {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const locationId = await seedLocation(groupId, "Pantry")
  const itemId = await seedItem(groupId, "Apple")
  const stockId = await seedStock(groupId, itemId, locationId, quantity)
  return { userId, groupId, locationId, itemId, stockId }
}

test("POST /v1/stocks/:id/consume reduces quantity + records CONSUME event", async () => {
  const { userId, stockId, groupId } = await setupGroupWithStock(10)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ quantityDelta: 3, reason: "lunch" }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    stock: { quantity: number }
    event: { eventType: string; quantityDelta: number; reason: string | null }
  }
  expect(body.stock.quantity).toBe(7)
  expect(body.event.eventType).toBe("CONSUME")
  expect(body.event.quantityDelta).toBe(-3)
  expect(body.event.reason).toBe("lunch")

  const events = await testDb.select().from(stockEvents).where(eq(stockEvents.stockId, stockId))
  expect(events).toHaveLength(1)
  expect(events[0]?.groupId).toBe(groupId)
})

test("POST /v1/stocks/:id/consume rejects when result would be negative", async () => {
  const { userId, stockId } = await setupGroupWithStock(2)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ quantityDelta: 10 }),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_QUANTITY")

  // 失敗時に stock も event も触らないことを確認
  const [row] = await testDb.select().from(stocks).where(eq(stocks.id, stockId))
  expect(row?.quantity).toBe(2)
  const events = await testDb.select().from(stockEvents).where(eq(stockEvents.stockId, stockId))
  expect(events).toHaveLength(0)
})

test("POST /v1/stocks/:id/consume by VIEWER returns 403 INSUFFICIENT_ROLE", async () => {
  const ownerId = await seedUser("Owner")
  const viewerId = await seedUser("Viewer")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(viewerId, groupId, "VIEWER")
  const locationId = await seedLocation(groupId, "Pantry")
  const itemId = await seedItem(groupId, "Apple")
  const stockId = await seedStock(groupId, itemId, locationId, 5)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": viewerId },
    body: JSON.stringify({ quantityDelta: 1 }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})

test("POST /v1/stocks/:id/consume on soft-deleted stock returns 404", async () => {
  const { userId, stockId } = await setupGroupWithStock(5)
  await testDb.update(stocks).set({ deletedAt: new Date() }).where(eq(stocks.id, stockId))

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ quantityDelta: 1 }),
  })

  expect(res.status).toBe(404)
})

test("POST /v1/stocks/:id/discard records DISCARD event", async () => {
  const { userId, stockId } = await setupGroupWithStock(8)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/discard`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ quantityDelta: 2, reason: "expired" }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    stock: { quantity: number }
    event: { eventType: string; quantityDelta: number }
  }
  expect(body.stock.quantity).toBe(6)
  expect(body.event.eventType).toBe("DISCARD")
  expect(body.event.quantityDelta).toBe(-2)
})

test("POST /v1/stocks/:id/move updates locationId + records MOVE event", async () => {
  const { userId, groupId, locationId, stockId } = await setupGroupWithStock(5)
  const otherLocationId = await seedLocation(groupId, "Garage")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ toLocationId: otherLocationId, reason: "rearrange" }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    stock: { locationId: string; quantity: number }
    event: {
      eventType: string
      quantityDelta: number
      fromLocationId: string | null
      toLocationId: string | null
    }
  }
  expect(body.stock.locationId).toBe(otherLocationId)
  expect(body.stock.quantity).toBe(5) // 数量は変わらない
  expect(body.event.eventType).toBe("MOVE")
  expect(body.event.quantityDelta).toBe(0)
  expect(body.event.fromLocationId).toBe(locationId)
  expect(body.event.toLocationId).toBe(otherLocationId)
})

test("POST /v1/stocks/:id/move to same location returns 422 MOVE_NOOP", async () => {
  const { userId, locationId, stockId } = await setupGroupWithStock(5)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ toLocationId: locationId }),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("MOVE_NOOP")
})

test("POST /v1/stocks/:id/move to other group's location returns 422 LOCATION_GROUP_MISMATCH", async () => {
  const { userId, stockId } = await setupGroupWithStock(5)
  // 別 group の location を seed
  const otherOwner = await seedUser("Other")
  const otherGroupId = await seedGroupWithMembership(otherOwner, "Other")
  const otherLocationId = await seedLocation(otherGroupId, "Foreign")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ toLocationId: otherLocationId }),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("LOCATION_GROUP_MISMATCH")
})

test("DELETE /v1/stocks/:id soft-deletes + records final DISCARD event for remaining qty", async () => {
  const { userId, stockId, groupId } = await setupGroupWithStock(4)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(204)

  const [row] = await testDb.select().from(stocks).where(eq(stocks.id, stockId))
  expect(row?.deletedAt).not.toBeNull()
  expect(row?.quantity).toBe(4) // quantity は残す (履歴のため)

  // 残数量分の DISCARD event が記録されている
  const events = await testDb
    .select()
    .from(stockEvents)
    .where(and(eq(stockEvents.stockId, stockId), eq(stockEvents.eventType, "DISCARD")))
  expect(events).toHaveLength(1)
  expect(events[0]?.quantityDelta).toBe(-4)
  expect(events[0]?.groupId).toBe(groupId)
  expect(events[0]?.reason).toBe("soft-delete")
})

test("DELETE /v1/stocks/:id with quantity=0 does not create extra event", async () => {
  const { userId, stockId } = await setupGroupWithStock(0)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(204)
  const events = await testDb.select().from(stockEvents).where(eq(stockEvents.stockId, stockId))
  expect(events).toHaveLength(0)
})

test("After soft-delete, consume on same id returns 404", async () => {
  const { userId, stockId } = await setupGroupWithStock(5)

  const app = createApp({ db: testDb })
  const del = await app.request(`/v1/stocks/${stockId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })
  expect(del.status).toBe(204)

  const consume = await app.request(`/v1/stocks/${stockId}/consume`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ quantityDelta: 1 }),
  })
  expect(consume.status).toBe(404)
})
