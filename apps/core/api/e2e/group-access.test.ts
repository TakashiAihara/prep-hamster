import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { groups, memberships, users } from "@prep-hamster/db"
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

test("GET /v1/stocks with malformed groupId returns 422", async () => {
  const userId = await seedUser()

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { "x-user-id": userId },
  })

  expect(res.status).toBe(422)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("VALIDATION_ERROR")
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

// mobile の stub id (auth.ts / config.ts) は RFC 9562 の version を持たない。
// zod 4 の uuid() は弾くので、path / query の両方で 422 にならないことを固定する。
test("stub ids without a UUID version are accepted on path and query", async () => {
  const userId = "00000000-0000-0000-0000-000000000001"
  const groupId = "00000000-0000-0000-0000-000000000010"
  await testDb
    .insert(users)
    .values({ id: userId, email: "stub@example.test", displayName: "Stub", locale: "ja-JP" })
  await testDb.insert(groups).values({ id: groupId, name: "Stub Home", createdBy: userId })
  await testDb
    .insert(memberships)
    .values({ id: crypto.randomUUID(), userId, groupId, role: "OWNER", joinedAt: new Date() })

  const app = createApp({ db: testDb })
  const byPath = await app.request(`/v1/groups/${groupId}`, { headers: { "x-user-id": userId } })
  const byQuery = await app.request(`/v1/stocks?groupId=${groupId}`, {
    headers: { "x-user-id": userId },
  })

  expect(byPath.status).toBe(200)
  expect(byQuery.status).toBe(200)

  const members = await app.request(`/v1/groups/${groupId}/memberships`, {
    headers: { "x-user-id": userId },
  })
  expect(members.status).toBe(200)

  const invite = await app.request(`/v1/groups/${groupId}/invitations`, {
    method: "POST",
    headers: { "x-user-id": userId, "content-type": "application/json" },
    body: JSON.stringify({ role: "VIEWER" }),
  })
  expect(invite.status).toBe(201)

  // 存在しない stub id は形式エラー (422) ではなく 404 になる。
  const missingId = "00000000-0000-0000-0000-000000000099"
  const resources = ["categories", "items", "locations", "stocks"]
  const statuses = await Promise.all(
    resources.map(async (resource) => {
      const res = await app.request(`/v1/${resource}/${missingId}?groupId=${groupId}`, {
        headers: { "x-user-id": userId },
      })
      return `${resource} ${res.status}`
    }),
  )
  expect(statuses).toEqual(resources.map((resource) => `${resource} 404`))
})
