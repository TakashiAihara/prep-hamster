import { beforeAll, beforeEach, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { seedBaseFixture } from "./seed"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("POST /v1/stocks creates a stock and GET returns it", async () => {
  const { userId, groupId, itemId, locationId } = await seedBaseFixture()
  const app = createApp({ db: testDb })

  const oneYearAhead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const createRes = await app.request("/v1/stocks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
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
    headers: { "x-user-id": userId },
  })
  expect(listRes.status).toBe(200)
  const listed = (await listRes.json()) as { stocks: { id: string }[] }
  expect(listed.stocks).toHaveLength(1)
  expect(listed.stocks[0]?.id).toBe(created.stock.id)
})

test("GET /v1/stocks with invalid groupId returns 400", async () => {
  const { userId } = await seedBaseFixture()
  const app = createApp({ db: testDb })
  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(400)
})

test("GET /v1/stocks returns empty list for empty group", async () => {
  const { userId, groupId } = await seedBaseFixture()
  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: unknown[] }
  expect(body.stocks).toEqual([])
})
