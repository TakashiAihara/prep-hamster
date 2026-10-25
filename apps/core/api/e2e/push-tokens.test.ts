import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { pushTokens, users } from "@prep-hamster/db"
import { createApp } from "../src/app"
import { seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const TOKEN_A = "ExponentPushToken[aaaa-1111-phone]"
const TOKEN_B = "ExponentPushToken[bbbb-2222-tablet]"

const call = (method: "POST" | "DELETE", body: unknown, userId?: string) =>
  createApp({ db: testDb }).request("/v1/push-tokens", {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-user-id": userId } : {}) },
    body: JSON.stringify(body),
  })

test("POST /v1/push-tokens without x-user-id returns 401", async () => {
  const res = await call("POST", { token: TOKEN_A })
  expect(res.status).toBe(401)
})

test("DELETE /v1/push-tokens without x-user-id returns 401", async () => {
  const res = await call("DELETE", { token: TOKEN_A })
  expect(res.status).toBe(401)
})

test("POST stores the token for the current user", async () => {
  const userId = await seedUser()

  const res = await call("POST", { token: TOKEN_A }, userId)

  expect(res.status).toBe(200)
  const body = (await res.json()) as { pushToken: { token: string } }
  expect(body.pushToken.token).toBe(TOKEN_A)
  const rows = await testDb.select().from(pushTokens)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.userId).toBe(userId)
  expect(rows[0]?.token).toBe(TOKEN_A)
})

test("POST keeps one row per device: same token twice is a no-op, a second token adds a row", async () => {
  const userId = await seedUser()

  await call("POST", { token: TOKEN_A }, userId)
  await call("POST", { token: TOKEN_A }, userId)
  await call("POST", { token: TOKEN_B }, userId)

  const rows = await testDb.select().from(pushTokens).where(eq(pushTokens.userId, userId))
  expect(rows.map((r) => r.token).toSorted()).toEqual([TOKEN_A, TOKEN_B])
})

test("POST of a token held by another user moves it to the caller", async () => {
  const previous = await seedUser("previous")
  const current = await seedUser("current")
  await call("POST", { token: TOKEN_A }, previous)

  const res = await call("POST", { token: TOKEN_A }, current)

  expect(res.status).toBe(200)
  const rows = await testDb.select().from(pushTokens)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.userId).toBe(current)
})

test("POST rejects a string that is not an Expo push token with 422", async () => {
  const userId = await seedUser()

  const res = await call("POST", { token: "not-a-push-token" }, userId)

  expect(res.status).toBe(422)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR")
  expect(await testDb.select().from(pushTokens)).toHaveLength(0)
})

test("POST for a user that does not exist returns 404", async () => {
  const res = await call("POST", { token: TOKEN_A }, crypto.randomUUID())

  expect(res.status).toBe(404)
  expect(await testDb.select().from(pushTokens)).toHaveLength(0)
})

test("DELETE removes only the given token of the current user", async () => {
  const userId = await seedUser()
  await call("POST", { token: TOKEN_A }, userId)
  await call("POST", { token: TOKEN_B }, userId)

  const res = await call("DELETE", { token: TOKEN_A }, userId)

  expect(res.status).toBe(204)
  const rows = await testDb.select().from(pushTokens)
  expect(rows.map((r) => r.token)).toEqual([TOKEN_B])
})

test("DELETE does not remove another user's token and is idempotent for unknown tokens", async () => {
  const owner = await seedUser("owner")
  const other = await seedUser("other")
  await call("POST", { token: TOKEN_A }, owner)

  const foreign = await call("DELETE", { token: TOKEN_A }, other)
  const unknown = await call("DELETE", { token: TOKEN_B }, other)

  expect(foreign.status).toBe(204)
  expect(unknown.status).toBe(204)
  const rows = await testDb.select().from(pushTokens)
  expect(rows).toHaveLength(1)
  expect(rows[0]?.userId).toBe(owner)
})

test("POST rejects tokens outside the Expo token charset or longer than 200 characters with 422", async () => {
  const userId = await seedUser()
  const rejected = [
    "ExponentPushToken[a]b]",
    "ExponentPushToken[has space]",
    "ExponentPushToken[]",
    `ExponentPushToken[${"a".repeat(201)}]`,
    "ExponentPushToken[ok]\nExponentPushToken[second]",
    "xExponentPushToken[ok]",
  ]

  const statuses = await Promise.all(
    rejected.map(async (token) => (await call("POST", { token }, userId)).status),
  )
  expect(statuses).toEqual(rejected.map(() => 422))
  expect((await call("POST", { token: `ExpoPushToken[${"a".repeat(200)}]` }, userId)).status).toBe(
    200,
  )
  expect((await call("POST", { token: "ExpoPushToken[legacy-1]" }, userId)).status).toBe(200)
  expect(await testDb.select().from(pushTokens)).toHaveLength(2)
})

test("POST keeps at most 10 tokens per user by evicting the one with the oldest updated_at", async () => {
  const userId = await seedUser()
  const other = await seedUser("other")
  const base = Date.parse("2026-10-01T00:00:00Z")
  const seed = (owner: string, i: number) => ({
    id: crypto.randomUUID(),
    userId: owner,
    token: `ExponentPushToken[${owner === userId ? "mine" : "theirs"}-${i}]`,
    createdAt: new Date(base),
    updatedAt: new Date(base + i * 1000),
  })
  await testDb
    .insert(pushTokens)
    .values([...Array.from({ length: 10 }, (_, i) => seed(userId, i)), seed(other, 50)])

  const res = await call("POST", { token: TOKEN_A }, userId)

  expect(res.status).toBe(200)
  const mine = await testDb.select().from(pushTokens).where(eq(pushTokens.userId, userId))
  expect(mine).toHaveLength(10)
  expect(mine.map((r) => r.token)).toContain(TOKEN_A)
  expect(mine.map((r) => r.token)).not.toContain("ExponentPushToken[mine-0]")
  expect(mine.map((r) => r.token)).toContain("ExponentPushToken[mine-1]")
  expect(await testDb.select().from(pushTokens).where(eq(pushTokens.userId, other))).toHaveLength(1)
})

test("re-registering an existing token refreshes it so it is not the one evicted", async () => {
  const userId = await seedUser()
  const base = Date.parse("2026-10-01T00:00:00Z")
  await testDb.insert(pushTokens).values(
    Array.from({ length: 10 }, (_, i) => ({
      id: crypto.randomUUID(),
      userId,
      token: `ExponentPushToken[mine-${i}]`,
      createdAt: new Date(base),
      updatedAt: new Date(base + i * 1000),
    })),
  )

  await call("POST", { token: "ExponentPushToken[mine-0]" }, userId)
  await call("POST", { token: TOKEN_A }, userId)

  const tokens = (await testDb.select().from(pushTokens)).map((r) => r.token)
  expect(tokens).toHaveLength(10)
  expect(tokens).toContain("ExponentPushToken[mine-0]")
  expect(tokens).not.toContain("ExponentPushToken[mine-1]")
})

test("POST for a soft-deleted user returns 404", async () => {
  const userId = await seedUser()
  await testDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId))

  const res = await call("POST", { token: TOKEN_A }, userId)

  expect(res.status).toBe(404)
  expect(await testDb.select().from(pushTokens)).toHaveLength(0)
})
