import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { pushTokens } from "@prep-hamster/db"
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

test("POST rejects a string that is not an Expo push token with 400", async () => {
  const userId = await seedUser()

  const res = await call("POST", { token: "not-a-push-token" }, userId)

  expect(res.status).toBe(400)
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
