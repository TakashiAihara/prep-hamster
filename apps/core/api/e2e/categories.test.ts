import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { categories } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedCategory, seedGroupWithMembership, seedItem, seedMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("POST /v1/categories by OWNER returns 201", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/categories", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, name: "Food", sortOrder: 1 }),
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { category: { id: string; name: string; sortOrder: number } }
  expect(body.category.name).toBe("Food")
  expect(body.category.sortOrder).toBe(1)
})

test("POST /v1/categories by VIEWER returns 403 INSUFFICIENT_ROLE", async () => {
  const ownerId = await seedUser("Owner")
  const viewerId = await seedUser("Viewer")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(viewerId, groupId, "VIEWER")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/categories", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": viewerId },
    body: JSON.stringify({ groupId, name: "Food" }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})

test("GET /v1/categories?groupId=X returns ordered list (sortOrder asc, NULL last)", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  await seedCategory(groupId, "Misc", null)
  await seedCategory(groupId, "Food", 1)
  await seedCategory(groupId, "Drink", 2)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/categories?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { categories: { name: string }[] }
  expect(body.categories.map((c) => c.name)).toEqual(["Food", "Drink", "Misc"])
})

test("GET /v1/categories?groupId=X by non-member returns 403", async () => {
  const ownerId = await seedUser("Owner")
  const outsiderId = await seedUser("Outsider")
  const groupId = await seedGroupWithMembership(ownerId, "Home")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/categories?groupId=${groupId}`, {
    headers: { "x-user-id": outsiderId },
  })

  expect(res.status).toBe(403)
})

test("PATCH /v1/categories/:id by EDITOR returns 200", async () => {
  const ownerId = await seedUser("Owner")
  const editorId = await seedUser("Editor")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(editorId, groupId, "EDITOR")
  const categoryId = await seedCategory(groupId, "Food")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/categories/${categoryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": editorId },
    body: JSON.stringify({ name: "Food & Drink" }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { category: { name: string } }
  expect(body.category.name).toBe("Food & Drink")
})

test("DELETE /v1/categories/:id without children returns 204 + soft-delete", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const categoryId = await seedCategory(groupId, "Food")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/categories/${categoryId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(204)
  const [row] = await testDb.select().from(categories).where(eq(categories.id, categoryId))
  expect(row?.deletedAt).not.toBeNull()
})

test("DELETE /v1/categories/:id with referencing item returns 422 CATEGORY_IN_USE", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const categoryId = await seedCategory(groupId, "Food")
  await seedItem(groupId, "Canned Tomato", categoryId)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/categories/${categoryId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("CATEGORY_IN_USE")
})
