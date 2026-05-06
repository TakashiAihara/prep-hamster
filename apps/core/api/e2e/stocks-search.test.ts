import { beforeAll, beforeEach, expect, test } from "bun:test"
import { createApp } from "../src/app"
import {
  seedCategory,
  seedGroupWithMembership,
  seedItem,
  seedLocation,
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

const isoDate = (offsetDays: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

test("GET /v1/stocks/:id returns the stock for a member", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  const stockId = await seedStock(groupId, itemId, locationId, 5)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}`, {
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stock: { id: string; quantity: number } }
  expect(body.stock.id).toBe(stockId)
  expect(body.stock.quantity).toBe(5)
})

test("GET /v1/stocks/:id returns 403 for a non-member", async () => {
  const ownerId = await seedUser("owner")
  const outsiderId = await seedUser("outsider")
  const groupId = await seedGroupWithMembership(ownerId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  const stockId = await seedStock(groupId, itemId, locationId, 1)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}`, {
    headers: { "x-user-id": outsiderId },
  })
  expect(res.status).toBe(403)
})

test("GET /v1/stocks/:id returns 404 for a missing stock", async () => {
  const userId = await seedUser()
  await seedGroupWithMembership(userId)
  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${crypto.randomUUID()}`, {
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(404)
})

test("PATCH /v1/stocks/:id rejects quantity in body", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  const stockId = await seedStock(groupId, itemId, locationId, 3)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ quantity: 99, note: "memo" }),
  })
  // .strict() で unrecognized_keys を投げ、422 で reject される
  expect(res.status).toBe(400)
})

test("PATCH /v1/stocks/:id updates note / unit / dates without changing quantity", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  const stockId = await seedStock(groupId, itemId, locationId, 3)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      note: "updated",
      unit: "本",
      useByDate: isoDate(30),
    }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    stock: { quantity: number; note: string | null; unit: string; useByDate: string | null }
  }
  expect(body.stock.quantity).toBe(3)
  expect(body.stock.note).toBe("updated")
  expect(body.stock.unit).toBe("本")
  expect(body.stock.useByDate).toBe(isoDate(30))
})

test("PATCH /v1/stocks/:id with locationId in another group returns 422", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Group A")
  const otherGroupId = await seedGroupWithMembership(userId, "Group B")
  const locationId = await seedLocation(groupId)
  const otherLocationId = await seedLocation(otherGroupId, "Other Pantry")
  const itemId = await seedItem(groupId)
  const stockId = await seedStock(groupId, itemId, locationId, 1)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks/${stockId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ locationId: otherLocationId }),
  })
  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("LOCATION_GROUP_MISMATCH")
})

test("GET /v1/stocks?categoryId filters by item.categoryId", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const foodCategoryId = await seedCategory(groupId, "Food")
  const drinkCategoryId = await seedCategory(groupId, "Drink")
  const foodItemId = await seedItem(groupId, "Tomato", foodCategoryId)
  const drinkItemId = await seedItem(groupId, "Tea", drinkCategoryId)
  const noCatItemId = await seedItem(groupId, "Misc")
  await seedStock(groupId, foodItemId, locationId, 1)
  await seedStock(groupId, drinkItemId, locationId, 1)
  await seedStock(groupId, noCatItemId, locationId, 1)

  const app = createApp({ db: testDb })
  const res = await app.request(
    `/v1/stocks?groupId=${groupId}&categoryId=${foodCategoryId}&includeExpired=true`,
    { headers: { "x-user-id": userId } },
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: { itemId: string }[] }
  expect(body.stocks).toHaveLength(1)
  expect(body.stocks[0]?.itemId).toBe(foodItemId)
})

test("GET /v1/stocks?locationId filters by stock.locationId", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const pantryId = await seedLocation(groupId, "Pantry")
  const fridgeId = await seedLocation(groupId, "Fridge")
  const itemId = await seedItem(groupId)
  await seedStock(groupId, itemId, pantryId, 1)
  await seedStock(groupId, itemId, fridgeId, 1)

  const app = createApp({ db: testDb })
  const res = await app.request(
    `/v1/stocks?groupId=${groupId}&locationId=${fridgeId}&includeExpired=true`,
    { headers: { "x-user-id": userId } },
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: { locationId: string }[] }
  expect(body.stocks).toHaveLength(1)
  expect(body.stocks[0]?.locationId).toBe(fridgeId)
})

test("GET /v1/stocks excludes expired stocks by default", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  // 期限切れ (use-by 過去)
  const expiredId = await seedStock(groupId, itemId, locationId, 1, {
    useByDate: isoDate(-5),
  })
  // 期限内
  const freshId = await seedStock(groupId, itemId, locationId, 1, {
    useByDate: isoDate(10),
  })
  // 期限なし (null)
  const noExpiryId = await seedStock(groupId, itemId, locationId, 1)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: { id: string }[] }
  const ids = body.stocks.map((s) => s.id)
  expect(ids).toContain(freshId)
  expect(ids).toContain(noExpiryId)
  expect(ids).not.toContain(expiredId)
})

test("GET /v1/stocks?includeExpired=true includes expired", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  const expiredId = await seedStock(groupId, itemId, locationId, 1, {
    useByDate: isoDate(-3),
  })

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${groupId}&includeExpired=true`, {
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: { id: string }[] }
  expect(body.stocks.map((s) => s.id)).toContain(expiredId)
})

test("GET /v1/stocks?expiringBefore filters by useByDate or bestBeforeDate", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  // useByDate が境界以内
  const useByMatch = await seedStock(groupId, itemId, locationId, 1, {
    useByDate: isoDate(5),
  })
  // bestBeforeDate が境界以内
  const bestMatch = await seedStock(groupId, itemId, locationId, 1, {
    bestBeforeDate: isoDate(3),
  })
  // どちらも境界より先
  await seedStock(groupId, itemId, locationId, 1, {
    useByDate: isoDate(60),
  })

  const app = createApp({ db: testDb })
  const res = await app.request(
    `/v1/stocks?groupId=${groupId}&expiringBefore=${isoDate(7)}&includeExpired=true`,
    { headers: { "x-user-id": userId } },
  )
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: { id: string }[] }
  const ids = body.stocks.map((s) => s.id)
  expect(ids).toContain(useByMatch)
  expect(ids).toContain(bestMatch)
  expect(ids).toHaveLength(2)
})

test("GET /v1/stocks orders by useByDate ASC NULLS LAST then bestBeforeDate ASC NULLS LAST", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId)
  const locationId = await seedLocation(groupId)
  const itemId = await seedItem(groupId)
  // 期限なし
  const noExpiry = await seedStock(groupId, itemId, locationId, 1)
  // useByDate あり、近い
  const soon = await seedStock(groupId, itemId, locationId, 1, { useByDate: isoDate(3) })
  // useByDate あり、遠い
  const later = await seedStock(groupId, itemId, locationId, 1, { useByDate: isoDate(20) })
  // useByDate null, bestBeforeDate あり
  const bestOnly = await seedStock(groupId, itemId, locationId, 1, {
    bestBeforeDate: isoDate(10),
  })

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${groupId}&includeExpired=true`, {
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: { id: string }[] }
  const order = body.stocks.map((s) => s.id)
  // useByDate 近い → 遠い、その後 useByDate=null 群 (bestBeforeDate 近い → null)
  expect(order).toEqual([soon, later, bestOnly, noExpiry])
})
