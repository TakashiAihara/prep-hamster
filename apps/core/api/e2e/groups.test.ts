import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { groups, memberships } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("GET /v1/groups without x-user-id returns 401", async () => {
  const app = createApp({ db: testDb })
  const res = await app.request("/v1/groups")
  expect(res.status).toBe(401)
})

test("POST /v1/groups creates group + OWNER membership in single tx", async () => {
  const userId = await seedUser()
  const app = createApp({ db: testDb })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({ name: "Sample Household" }),
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    group: { id: string; name: string; createdBy: string }
    membership: { id: string; userId: string; groupId: string; role: string }
  }

  expect(body.group.name).toBe("Sample Household")
  expect(body.group.createdBy).toBe(userId)
  expect(body.membership.userId).toBe(userId)
  expect(body.membership.groupId).toBe(body.group.id)
  expect(body.membership.role).toBe("OWNER")

  // tx 整合性: group も membership も DB に存在すること
  const groupRows = await testDb.select().from(groups).where(eq(groups.id, body.group.id))
  expect(groupRows).toHaveLength(1)
  const membershipRows = await testDb
    .select()
    .from(memberships)
    .where(eq(memberships.groupId, body.group.id))
  expect(membershipRows).toHaveLength(1)
  expect(membershipRows[0]?.role).toBe("OWNER")
})

test("POST /v1/groups with empty name returns 422", async () => {
  const userId = await seedUser()
  const app = createApp({ db: testDb })

  const res = await app.request("/v1/groups", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({ name: "" }),
  })

  expect(res.status).toBe(400)
})

test("GET /v1/groups returns only groups the user is a member of", async () => {
  const aliceId = await seedUser("Alice")
  const bobId = await seedUser("Bob")
  const aliceGroupId = await seedGroupWithMembership(aliceId, "Alice's Home")
  await seedGroupWithMembership(bobId, "Bob's Home")

  const app = createApp({ db: testDb })
  const res = await app.request("/v1/groups", {
    headers: { "x-user-id": aliceId },
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { groups: { id: string; name: string }[] }
  expect(body.groups).toHaveLength(1)
  expect(body.groups[0]?.id).toBe(aliceGroupId)
  expect(body.groups[0]?.name).toBe("Alice's Home")
})

test("GET /v1/groups/:id by non-member returns 403", async () => {
  const aliceId = await seedUser("Alice")
  const bobId = await seedUser("Bob")
  const bobGroupId = await seedGroupWithMembership(bobId, "Bob's Home")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${bobGroupId}`, {
    headers: { "x-user-id": aliceId },
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("FORBIDDEN_GROUP_ACCESS")
})

test("PATCH /v1/groups/:id by OWNER returns 200 and updates name", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Old Name")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${groupId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({ name: "New Name" }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { group: { id: string; name: string } }
  expect(body.group.id).toBe(groupId)
  expect(body.group.name).toBe("New Name")
})

test("PATCH /v1/groups/:id by EDITOR returns 403", async () => {
  const ownerId = await seedUser("Owner")
  const editorId = await seedUser("Editor")
  const groupId = await seedGroupWithMembership(ownerId, "Shared Home")
  await seedMembership(editorId, groupId, "EDITOR")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${groupId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-id": editorId,
    },
    body: JSON.stringify({ name: "Hijack Attempt" }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})

test("PATCH /v1/groups/:id by non-member returns 403", async () => {
  const ownerId = await seedUser("Owner")
  const outsiderId = await seedUser("Outsider")
  const groupId = await seedGroupWithMembership(ownerId, "Closed Home")

  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/groups/${groupId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-user-id": outsiderId,
    },
    body: JSON.stringify({ name: "Sneak" }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("FORBIDDEN_GROUP_ACCESS")
})
