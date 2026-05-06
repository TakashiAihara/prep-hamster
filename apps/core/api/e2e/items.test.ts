import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { items } from "@prep-hamster/db"
import { createApp } from "../src/app"
import {
  seedCategory,
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

test("POST /v1/items by OWNER returns 201", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      groupId,
      name: "Canned Tomato",
      defaultUnit: "缶",
      barcode: "4901234567890",
    }),
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    item: { name: string; productMasterId: string | null; barcode: string | null }
  }
  expect(body.item.name).toBe("Canned Tomato")
  expect(body.item.productMasterId).toBeNull()
  expect(body.item.barcode).toBe("4901234567890")
})

test("POST /v1/items by VIEWER returns 403 INSUFFICIENT_ROLE", async () => {
  const ownerId = await seedUser("Owner")
  const viewerId = await seedUser("Viewer")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(viewerId, groupId, "VIEWER")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": viewerId },
    body: JSON.stringify({ groupId, name: "Sneak" }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})

test("POST /v1/items with another group's categoryId returns 422 CATEGORY_GROUP_MISMATCH", async () => {
  const userId = await seedUser()
  const homeGroup = await seedGroupWithMembership(userId, "Home")
  const otherOwner = await seedUser("Other")
  const otherGroup = await seedGroupWithMembership(otherOwner, "Other")
  const otherCategory = await seedCategory(otherGroup, "Food")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      groupId: homeGroup,
      name: "Foreign-Category Item",
      categoryId: otherCategory,
    }),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("CATEGORY_GROUP_MISMATCH")
})

test("POST /v1/items with duplicate (groupId, barcode) returns 422 ITEM_BARCODE_DUPLICATE", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb })
  await app.request("/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, name: "First", barcode: "4901234567890" }),
  })

  const res = await app.request("/v1/items", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, name: "Second", barcode: "4901234567890" }),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("ITEM_BARCODE_DUPLICATE")
})

test("GET /v1/items?groupId=X returns active items only", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  await seedItem(groupId, "Apple")
  await seedItem(groupId, "Banana")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/items?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { items: { name: string }[] }
  expect(body.items.map((i) => i.name).toSorted()).toEqual(["Apple", "Banana"])
})

test("GET /v1/items?groupId=X&categoryId=Y filters", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const foodCat = await seedCategory(groupId, "Food")
  const drinkCat = await seedCategory(groupId, "Drink")
  await seedItem(groupId, "Apple", foodCat)
  await seedItem(groupId, "Coffee", drinkCat)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/items?groupId=${groupId}&categoryId=${foodCat}`, {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { items: { name: string }[] }
  expect(body.items.map((i) => i.name)).toEqual(["Apple"])
})

test("GET /v1/items/:id by non-member returns 403", async () => {
  const ownerId = await seedUser("Owner")
  const outsiderId = await seedUser("Outsider")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  const itemId = await seedItem(groupId, "Apple")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/items/${itemId}`, {
    headers: { "x-user-id": outsiderId },
  })
  expect(res.status).toBe(403)
})

test("PATCH /v1/items/:id by EDITOR updates barcode", async () => {
  const ownerId = await seedUser("Owner")
  const editorId = await seedUser("Editor")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(editorId, groupId, "EDITOR")
  const itemId = await seedItem(groupId, "Apple")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": editorId },
    body: JSON.stringify({ barcode: "4900000000000" }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { item: { barcode: string | null } }
  expect(body.item.barcode).toBe("4900000000000")
})

test("DELETE /v1/items/:id without active stock returns 204 + soft-delete", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const itemId = await seedItem(groupId, "Apple")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/items/${itemId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(204)
  const [row] = await testDb.select().from(items).where(eq(items.id, itemId))
  expect(row?.deletedAt).not.toBeNull()
})

test("DELETE /v1/items/:id with active stock returns 422 ITEM_IN_USE", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const itemId = await seedItem(groupId, "Apple")
  const locationId = await seedLocation(groupId, "Pantry")
  await seedStock(groupId, itemId, locationId)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/items/${itemId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("ITEM_IN_USE")
})

test("GET /v1/items/:id soft-deleted returns 404", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const itemId = await seedItem(groupId, "Apple")
  await testDb.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId))

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/items/${itemId}`, {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(404)
})
