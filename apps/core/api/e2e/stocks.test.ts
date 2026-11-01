import { beforeAll, beforeEach, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { eq } from "drizzle-orm"
import { items, locations } from "@prep-hamster/db"
import {
  seedBaseFixture,
  seedGroupWithMembership,
  seedItem,
  seedLocation,
  seedMembership,
  seedUser,
} from "./seed"
import { bearer, e2eAuth } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("POST /v1/stocks creates a stock and GET returns it", async () => {
  const { userId, groupId, itemId, locationId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const oneYearAhead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const createRes = await app.request("/v1/stocks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await bearer(userId),
    },
    body: JSON.stringify({
      groupId,
      itemId,
      locationId,
      quantity: 3,
      unit: "個",
      useByDate: null,
      bestBeforeDate: oneYearAhead,
      openedAt: null,
      note: null,
    }),
  })

  expect(createRes.status).toBe(201)
  const created = (await createRes.json()) as { stock: { id: string; quantity: number } }
  expect(created.stock.quantity).toBe(3)

  const listRes = await app.request(`/v1/stocks?groupId=${groupId}`, {
    headers: { authorization: await bearer(userId) },
  })
  expect(listRes.status).toBe(200)
  const listed = (await listRes.json()) as { stocks: { id: string }[] }
  expect(listed.stocks).toHaveLength(1)
  expect(listed.stocks[0]?.id).toBe(created.stock.id)
})

test("GET /v1/stocks with invalid groupId returns 422", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { authorization: await bearer(userId) },
  })
  expect(res.status).toBe(422)
})

test("GET /v1/stocks returns empty list for empty group", async () => {
  const { userId, groupId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/stocks?groupId=${groupId}`, {
    headers: { authorization: await bearer(userId) },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: unknown[] }
  expect(body.stocks).toEqual([])
})

const createStockBody = (groupId: string, itemId: string, locationId: string) =>
  JSON.stringify({
    groupId,
    itemId,
    locationId,
    quantity: 1,
    unit: "個",
    useByDate: null,
    bestBeforeDate: null,
    openedAt: null,
    note: null,
  })

const seedForeignGroup = async () => {
  const otherOwner = await seedUser("Other")
  const otherGroupId = await seedGroupWithMembership(otherOwner, "Other")
  return {
    otherItemId: await seedItem(otherGroupId, "Foreign Item"),
    otherLocationId: await seedLocation(otherGroupId, "Foreign"),
  }
}

test("POST /v1/stocks with other group's item returns 422 ITEM_GROUP_MISMATCH", async () => {
  const { userId, groupId, locationId } = await seedBaseFixture()
  const { otherItemId } = await seedForeignGroup()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: createStockBody(groupId, otherItemId, locationId),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("ITEM_GROUP_MISMATCH")
})

test("POST /v1/stocks with other group's location returns 422 LOCATION_GROUP_MISMATCH", async () => {
  const { userId, groupId, itemId } = await seedBaseFixture()
  const { otherLocationId } = await seedForeignGroup()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: createStockBody(groupId, itemId, otherLocationId),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("LOCATION_GROUP_MISMATCH")
})

test("POST /v1/stocks with nonexistent item returns 422 ITEM_GROUP_MISMATCH", async () => {
  const { userId, groupId, locationId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: createStockBody(groupId, crypto.randomUUID(), locationId),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("ITEM_GROUP_MISMATCH")
})

test("POST /v1/stocks with nonexistent location returns 422 LOCATION_GROUP_MISMATCH", async () => {
  const { userId, groupId, itemId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: createStockBody(groupId, itemId, crypto.randomUUID()),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("LOCATION_GROUP_MISMATCH")
})

test("POST /v1/stocks with a soft-deleted item of the same group returns 422 ITEM_GROUP_MISMATCH", async () => {
  const { userId, groupId, itemId, locationId } = await seedBaseFixture()
  await testDb.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId))
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: createStockBody(groupId, itemId, locationId),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("ITEM_GROUP_MISMATCH")
})

test("POST /v1/stocks with a soft-deleted location of the same group returns 422 LOCATION_GROUP_MISMATCH", async () => {
  const { userId, groupId, itemId, locationId } = await seedBaseFixture()
  await testDb.update(locations).set({ deletedAt: new Date() }).where(eq(locations.id, locationId))
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(userId) },
    body: createStockBody(groupId, itemId, locationId),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("LOCATION_GROUP_MISMATCH")
})

test("POST /v1/stocks by VIEWER returns 403 INSUFFICIENT_ROLE", async () => {
  const { groupId, itemId, locationId } = await seedBaseFixture()
  const viewerId = await seedUser("Viewer")
  await seedMembership(viewerId, groupId, "VIEWER")
  const app = createApp({ db: testDb, auth: e2eAuth })

  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await bearer(viewerId) },
    body: createStockBody(groupId, itemId, locationId),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})
