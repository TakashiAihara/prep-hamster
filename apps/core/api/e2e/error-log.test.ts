import { beforeAll, beforeEach, expect, test } from "bun:test"
import { DrizzleQueryError, sql } from "drizzle-orm"
import { Hono } from "hono"
import { items } from "@prep-hamster/db"
import { createOnError } from "../src/middleware/error"
import { seedGroupWithMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

// ログの中身は実際の driver / drizzle が投げるエラーの形に依存するので、本物の DB でエラーを起こして確かめる。

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const caught = (run: () => PromiseLike<unknown>): Promise<unknown> =>
  Promise.resolve(run()).then(
    () => null,
    (e: unknown) => e,
  )

// onError に通して、console.error 相当に渡された引数を 1 本の文字列にして返す
const logOf = async (err: unknown): Promise<{ status: number; logged: string }> => {
  const calls: unknown[][] = []
  const app = new Hono()
  app.onError(createOnError((...args) => calls.push(args)))
  app.get("/", () => {
    throw err
  })
  const res = await app.request("/")
  return { status: res.status, logged: calls.map((a) => Bun.inspect(a, { depth: 10 })).join("\n") }
}

test("unhandled duplicate insert is logged with constraint and SQLSTATE but without bound values", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const row = { groupId, name: "Canned Tomato", barcode: "4901234567894" }
  await testDb.insert(items).values({ id: crypto.randomUUID(), ...row })
  const dupId = crypto.randomUUID()

  const err = await caught(() => testDb.insert(items).values({ id: dupId, ...row }))
  const { status, logged } = await logOf(err)

  expect(status).toBe(500)
  expect(logged).toContain("23505")
  expect(logged).toContain("items_group_barcode_idx")
  expect(logged).toContain("insert into")
  expect(logged).toContain('table: "items"')
  expect(logged).toContain("drizzle-orm")
  for (const bound of [row.barcode, row.name, row.groupId, dupId]) {
    expect(logged).not.toContain(bound)
  }
})

test("unhandled error whose driver message embeds the value does not log the message", async () => {
  const bound = "not-a-uuid-7f3a9c"

  const err = await caught(() => testDb.execute(sql`select ${bound}::uuid`))
  const { logged } = await logOf(err)

  expect(logged).toContain("22P02")
  expect(logged).not.toContain(bound)
})

test("not-null violation is logged with the column but without the failing row", async () => {
  const rowId = crypto.randomUUID()

  const err = await caught(() => testDb.execute(sql`insert into groups (id) values (${rowId})`))
  const { logged } = await logOf(err)

  expect(logged).toContain("23502")
  expect(logged).toContain('column: "name"')
  expect(logged).not.toContain(rowId)
})

test("a bound value that looks like a stack frame does not reach the log", async () => {
  const bound = "x\n    at LEAK-7f3a9c"

  const err = await caught(() => testDb.execute(sql`select ${bound}::uuid`))
  const { logged } = await logOf(err)

  expect(logged).toContain("22P02")
  expect(logged).not.toContain("LEAK-7f3a9c")
  expect(logged).toContain("drizzle-orm")
})

test("a raw driver error that drizzle did not wrap is logged without its message and detail", async () => {
  const bound = "not-a-uuid-raw-5d21"

  const err = await caught(() => testDb.$client`select ${bound}::uuid`)
  const { logged } = await logOf(err)

  expect(err).not.toBeInstanceOf(DrizzleQueryError)
  expect(logged).toContain("unhandled database error")
  expect(logged).toContain("22P02")
  expect(logged).not.toContain(bound)
})

test("a plain Error wrapping a database error is logged without the bound values", async () => {
  const bound = "not-a-uuid-wrapped-8c40"

  const dbErr = await caught(() => testDb.execute(sql`select ${bound}::uuid`))
  const { logged } = await logOf(new Error("wrapper-msg", { cause: dbErr }))

  expect(logged).toContain("wrapper-msg")
  expect(logged).toContain("22P02")
  expect(logged).not.toContain(bound)
})

test("non-database errors keep name, message and stack", async () => {
  const { logged } = await logOf(new TypeError("boom-plain"))

  expect(logged).toContain("TypeError")
  expect(logged).toContain("boom-plain")
  expect(logged).toContain("error-log.test.ts")
})
