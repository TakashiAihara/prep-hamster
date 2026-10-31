import { beforeAll, beforeEach, expect, test } from "bun:test"
import { and, eq, isNull } from "drizzle-orm"
import { memberships } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { bearer, e2eAuth } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("GET /v1/groups/:groupId/memberships returns members for any member", async () => {
  const ownerId = await seedUser("owner")
  const editorId = await seedUser("editor")
  const groupId = await seedGroupWithMembership(ownerId)
  await seedMembership(editorId, groupId, "EDITOR")

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships`, {
    headers: { authorization: await bearer(editorId) },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { memberships: { userId: string; role: string }[] }
  expect(body.memberships).toHaveLength(2)
  const roles = new Map(body.memberships.map((m) => [m.userId, m.role]))
  expect(roles.get(ownerId)).toBe("OWNER")
  expect(roles.get(editorId)).toBe("EDITOR")
})

test("GET /v1/groups/:groupId/memberships returns 403 for non-member", async () => {
  const ownerId = await seedUser("owner")
  const outsiderId = await seedUser("outsider")
  const groupId = await seedGroupWithMembership(ownerId)

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships`, {
    headers: { authorization: await bearer(outsiderId) },
  })
  expect(res.status).toBe(403)
})

test("PATCH /v1/groups/:groupId/memberships/:userId promotes EDITOR to OWNER (OWNER only)", async () => {
  const ownerId = await seedUser("owner")
  const editorId = await seedUser("editor")
  const groupId = await seedGroupWithMembership(ownerId)
  await seedMembership(editorId, groupId, "EDITOR")

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships/${editorId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: await bearer(ownerId) },
    body: JSON.stringify({ role: "OWNER" }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { membership: { role: string } }
  expect(body.membership.role).toBe("OWNER")
})

test("PATCH /v1/groups/:groupId/memberships/:userId with empty body returns 422 and updates nothing", async () => {
  const ownerId = await seedUser("owner")
  const editorId = await seedUser("editor")
  const groupId = await seedGroupWithMembership(ownerId)
  await seedMembership(editorId, groupId, "EDITOR")

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships/${editorId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: await bearer(ownerId) },
    body: JSON.stringify({}),
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string; message: string } }
  expect(body.error.code).toBe("VALIDATION_ERROR")
  expect(body.error.message).toBe("必須項目です")

  const [row] = await testDb
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.userId, editorId),
        isNull(memberships.deletedAt),
      ),
    )
  expect(row?.role).toBe("EDITOR")
})

test("PATCH membership by EDITOR returns 403", async () => {
  const ownerId = await seedUser("owner")
  const editorId = await seedUser("editor")
  const viewerId = await seedUser("viewer")
  const groupId = await seedGroupWithMembership(ownerId)
  await seedMembership(editorId, groupId, "EDITOR")
  await seedMembership(viewerId, groupId, "VIEWER")

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships/${viewerId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: await bearer(editorId) },
    body: JSON.stringify({ role: "EDITOR" }),
  })
  expect(res.status).toBe(403)
})

test("PATCH self OWNER → EDITOR returns 422 SELF_OWNER_DEMOTE", async () => {
  const ownerId = await seedUser("owner")
  const groupId = await seedGroupWithMembership(ownerId)

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships/${ownerId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: await bearer(ownerId) },
    body: JSON.stringify({ role: "EDITOR" }),
  })
  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("SELF_OWNER_DEMOTE")
})

test("DELETE last OWNER returns 422 LAST_OWNER", async () => {
  const ownerId = await seedUser("owner")
  const groupId = await seedGroupWithMembership(ownerId)

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships/${ownerId}`, {
    method: "DELETE",
    headers: { authorization: await bearer(ownerId) },
  })
  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("LAST_OWNER")
})

test("DELETE OWNER when another OWNER exists returns 204", async () => {
  const owner1 = await seedUser("owner1")
  const owner2 = await seedUser("owner2")
  const groupId = await seedGroupWithMembership(owner1)
  await seedMembership(owner2, groupId, "OWNER")

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships/${owner2}`, {
    method: "DELETE",
    headers: { authorization: await bearer(owner1) },
  })
  expect(res.status).toBe(204)

  // 二度目はもう deletedAt が立っているので 404
  const res2 = await app.request(`/v1/groups/${groupId}/memberships/${owner2}`, {
    method: "DELETE",
    headers: { authorization: await bearer(owner1) },
  })
  expect(res2.status).toBe(404)
})

test("DELETE EDITOR by OWNER returns 204", async () => {
  const ownerId = await seedUser("owner")
  const editorId = await seedUser("editor")
  const groupId = await seedGroupWithMembership(ownerId)
  await seedMembership(editorId, groupId, "EDITOR")

  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/groups/${groupId}/memberships/${editorId}`, {
    method: "DELETE",
    headers: { authorization: await bearer(ownerId) },
  })
  expect(res.status).toBe(204)
})
