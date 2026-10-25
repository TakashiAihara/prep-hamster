import { beforeAll, beforeEach, expect, test } from "bun:test"
import { items } from "@prep-hamster/db"
import { isUniqueViolation } from "../src/routes/items"
import { seedGroupWithMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

// 判定は実際の driver / drizzle が投げるエラーの形に依存するので、本物の DB で一意制約を破って確かめる。

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("isUniqueViolation recognises the error drizzle throws for a duplicate barcode", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const row = { groupId, name: "Canned Tomato", barcode: "4901234567894" }
  await testDb.insert(items).values({ id: crypto.randomUUID(), ...row })

  const err = await testDb
    .insert(items)
    .values({ id: crypto.randomUUID(), ...row })
    .then(() => null)
    .catch((e: unknown) => e)

  expect(err).not.toBeNull()
  expect(isUniqueViolation(err)).toBe(true)
})

test("isUniqueViolation rejects other errors", () => {
  expect(isUniqueViolation(new Error("boom"))).toBe(false)
  expect(isUniqueViolation({ code: "23503" })).toBe(false)
  expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false)
  expect(isUniqueViolation(null)).toBe(false)
})
