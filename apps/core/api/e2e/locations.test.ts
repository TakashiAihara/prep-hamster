import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { locations } from "@prep-hamster/db"
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

test("POST /v1/locations by OWNER returns 201", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/locations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, name: "Pantry", sortOrder: 1 }),
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as { location: { id: string; name: string; sortOrder: number } }
  expect(body.location.name).toBe("Pantry")
  expect(body.location.sortOrder).toBe(1)
})

test("POST /v1/locations by VIEWER returns 403 INSUFFICIENT_ROLE", async () => {
  const ownerId = await seedUser("Owner")
  const viewerId = await seedUser("Viewer")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(viewerId, groupId, "VIEWER")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/locations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": viewerId },
    body: JSON.stringify({ groupId, name: "Pantry" }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})

test("POST /v1/locations by non-member returns 403 FORBIDDEN_GROUP_ACCESS", async () => {
  const ownerId = await seedUser("Owner")
  const outsiderId = await seedUser("Outsider")
  const groupId = await seedGroupWithMembership(ownerId, "Home")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/locations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": outsiderId },
    body: JSON.stringify({ groupId, name: "Sneak Pantry" }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("FORBIDDEN_GROUP_ACCESS")
})

test("GET /v1/locations?groupId=X returns ordered list (sortOrder asc, NULL last)", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  await seedLocation(groupId, "Garage", null)
  await seedLocation(groupId, "Pantry", 1)
  await seedLocation(groupId, "Fridge", 2)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/locations?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { locations: { name: string; sortOrder: number | null }[] }
  expect(body.locations.map((l) => l.name)).toEqual(["Pantry", "Fridge", "Garage"])
})

test("GET /v1/locations?groupId=X by non-member returns 403", async () => {
  const ownerId = await seedUser("Owner")
  const outsiderId = await seedUser("Outsider")
  const groupId = await seedGroupWithMembership(ownerId, "Home")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/locations?groupId=${groupId}`, {
    headers: { "x-user-id": outsiderId },
  })

  expect(res.status).toBe(403)
})

test("GET /v1/locations/:id by non-member returns 403", async () => {
  const ownerId = await seedUser("Owner")
  const outsiderId = await seedUser("Outsider")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  const locationId = await seedLocation(groupId, "Pantry")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/locations/${locationId}`, {
    headers: { "x-user-id": outsiderId },
  })

  expect(res.status).toBe(403)
})

test("PATCH /v1/locations/:id by EDITOR returns 200", async () => {
  const ownerId = await seedUser("Owner")
  const editorId = await seedUser("Editor")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(editorId, groupId, "EDITOR")
  const locationId = await seedLocation(groupId, "Pantry")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/locations/${locationId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": editorId },
    body: JSON.stringify({ name: "Pantry (Renamed)" }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { location: { name: string } }
  expect(body.location.name).toBe("Pantry (Renamed)")
})

test("PATCH /v1/locations/:id by VIEWER returns 403", async () => {
  const ownerId = await seedUser("Owner")
  const viewerId = await seedUser("Viewer")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(viewerId, groupId, "VIEWER")
  const locationId = await seedLocation(groupId, "Pantry")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/locations/${locationId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": viewerId },
    body: JSON.stringify({ name: "Hijack" }),
  })

  expect(res.status).toBe(403)
})

test("DELETE /v1/locations/:id without children returns 204 + soft-delete row", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const locationId = await seedLocation(groupId, "Pantry")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/locations/${locationId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(204)
  const [row] = await testDb.select().from(locations).where(eq(locations.id, locationId))
  expect(row?.deletedAt).not.toBeNull()
})

test("DELETE /v1/locations/:id with referencing stock returns 422 LOCATION_IN_USE", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const locationId = await seedLocation(groupId, "Pantry")
  const itemId = await seedItem(groupId, "Canned Tomato")
  await seedStock(groupId, itemId, locationId)

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/locations/${locationId}`, {
    method: "DELETE",
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("LOCATION_IN_USE")
})
