import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { memberships } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

// withGroupAccess middleware の振る舞いを /v1/stocks (query.groupId) と
// /v1/groups/:id (path.id) を通じて E2E で検証する。

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("GET /v1/stocks?groupId=X by member returns 200", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { stocks: unknown[] }
  expect(body.stocks).toEqual([])
})

test("GET /v1/stocks?groupId=X by non-member returns 403", async () => {
  const aliceId = await seedUser("Alice")
  const bobId = await seedUser("Bob")
  const bobGroupId = await seedGroupWithMembership(bobId, "Bob's Home")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${bobGroupId}`, {
    headers: { "x-user-id": aliceId },
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("FORBIDDEN_GROUP_ACCESS")
})

test("GET /v1/stocks with malformed groupId returns 400", async () => {
  const userId = await seedUser()

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("BAD_REQUEST")
})

test("GET /v1/stocks with soft-deleted membership returns 403", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  // 既存 membership を soft-delete
  await testDb
    .update(memberships)
    .set({ deletedAt: new Date() })
    .where(eq(memberships.userId, userId))

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("FORBIDDEN_GROUP_ACCESS")
})

test("PATCH /v1/groups/:id by VIEWER returns 403 INSUFFICIENT_ROLE", async () => {
  const ownerId = await seedUser("Owner")
  const viewerId = await seedUser("Viewer")
  const groupId = await seedGroupWithMembership(ownerId, "Shared Home")
  await seedMembership(viewerId, groupId, "VIEWER")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${groupId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-id": viewerId,
    },
    body: JSON.stringify({ name: "Viewer Attempt" }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})
