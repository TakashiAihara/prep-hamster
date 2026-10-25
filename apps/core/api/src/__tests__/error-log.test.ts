import { expect, test } from "bun:test"
import { DrizzleQueryError } from "drizzle-orm"
import { Hono } from "hono"
import { createOnError } from "../middleware/error"

const SECRET = "secret-barcode-4901234567894"
const QUERY = "insert into items (barcode) values ($1)"

const logOf = async (err: unknown): Promise<{ status: number; logged: string }> => {
  const calls: unknown[][] = []
  const app = new Hono()
  app.onError(createOnError((...args) => calls.push(args)))
  app.get("/", () => {
    throw err
  })
  const res = await app.request("/")
  return { status: res.status, logged: calls.map((a) => Bun.inspect(a, { depth: 20 })).join("\n") }
}

const driverLike = (extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`duplicate key value violates unique constraint (${SECRET})`), {
    code: "23505",
    severity: "ERROR",
    detail: `Key (barcode)=(${SECRET}) already exists.`,
    constraint_name: "items_group_barcode_idx",
    table_name: "items",
    schema_name: "public",
    routine: "_bt_check_unique",
    ...extra,
  })

test("DrizzleQueryError is logged by safe fields only", async () => {
  const err = new DrizzleQueryError(QUERY, [SECRET], driverLike())
  const { status, logged } = await logOf(err)

  expect(status).toBe(500)
  expect(logged).toContain("unhandled database error")
  expect(logged).toContain(QUERY)
  expect(logged).toContain("23505")
  expect(logged).toContain('severity: "ERROR"')
  expect(logged).toContain("items_group_barcode_idx")
  expect(logged).toContain('table: "items"')
  expect(logged).toContain('schema: "public"')
  expect(logged).toContain('routine: "_bt_check_unique"')
  expect(logged).not.toContain(SECRET)
  expect(logged).not.toContain("params:")
})

test("a bound value holding a stack-frame look-alike does not reach the log, real frames do", async () => {
  const err = new DrizzleQueryError(QUERY, [`x\n    at LEAK ${SECRET}`], driverLike())
  const { logged } = await logOf(err)

  expect(logged).not.toContain("LEAK")
  expect(logged).not.toContain(SECRET)
  expect(logged).toContain("error-log.test.ts")
})

test("a raw driver error that drizzle did not wrap is redacted", async () => {
  const { logged } = await logOf(driverLike())

  expect(logged).toContain("unhandled database error")
  expect(logged).toContain("23505")
  expect(logged).toContain("items_group_barcode_idx")
  expect(logged).not.toContain(SECRET)
  expect(logged).toContain("error-log.test.ts")
})

test("a plain Error wrapping a database error as cause does not leak it", async () => {
  const wrapped = new DrizzleQueryError(QUERY, [SECRET], driverLike())
  const { logged } = await logOf(new Error("wrapper-msg", { cause: wrapped }))

  expect(logged).toContain("[api] unhandled error:")
  expect(logged).toContain("wrapper-msg")
  expect(logged).toContain(QUERY)
  expect(logged).toContain("23505")
  expect(logged).not.toContain(SECRET)
  expect(logged).not.toContain("params:")
})

test("a driver-shaped plain object in the cause chain is redacted", async () => {
  const cause = {
    code: "23505",
    severity: "ERROR",
    detail: `Key (a)=(${SECRET})`,
    table_name: "items",
  }
  const { logged } = await logOf(new Error("wrapper-msg", { cause }))

  expect(logged).toContain("23505")
  expect(logged).toContain('table: "items"')
  expect(logged).not.toContain(SECRET)
})

test("a non-driver cause keeps name, message and code", async () => {
  const conn = Object.assign(new TypeError("connect-refused-msg"), { code: "ECONNREFUSED" })
  const { logged } = await logOf(new Error("wrapper-msg", { cause: conn }))

  expect(logged).toContain("TypeError")
  expect(logged).toContain("connect-refused-msg")
  expect(logged).toContain("ECONNREFUSED")
})

test.each([{ code: "23505" }, { code: "EPIPE" }, { code: "ECONNREFUSED", detail: "d" }])(
  "an error with %o is not a driver error",
  async (extra) => {
    const { logged } = await logOf(Object.assign(new Error("shape-msg"), extra))

    expect(logged).toContain("shape-msg")
    expect(logged).toContain("[api] unhandled error:")
  },
)

test.each(["severity", "detail", "routine"])(
  "a SQLSTATE error with only %s is redacted",
  async (field) => {
    const err = Object.assign(new Error(`msg ${SECRET}`), { code: "42P01", [field]: "x" })
    const { logged } = await logOf(err)

    expect(logged).toContain("42P01")
    expect(logged).not.toContain(SECRET)
  },
)

test("driver fields that are not strings are not logged", async () => {
  const { logged } = await logOf(driverLike({ table_name: { v: SECRET } }))

  expect(logged).not.toContain(SECRET)
})

test("a non-error cause is logged by type only", async () => {
  const { logged } = await logOf(new Error("wrapper-msg", { cause: SECRET }))

  expect(logged).toContain("wrapper-msg")
  expect(logged).toContain('type: "string"')
  expect(logged).not.toContain(SECRET)
})

test("a cyclic cause chain terminates", async () => {
  const a = new Error("cycle-a")
  const b = new Error("cycle-b", { cause: a })
  a.cause = b
  const { logged } = await logOf(a)

  expect(logged.split("cycle-a")).toHaveLength(2)
  expect(logged.split("cycle-b")).toHaveLength(2)
})

test("the cause chain is cut at a bounded depth", async () => {
  let err: Error = new Error("depth-last")
  for (let i = 4; i >= 0; i--) err = new Error(`depth-${i}`, { cause: err })
  const { logged } = await logOf(err)

  expect(logged).toContain("depth-4")
  expect(logged).not.toContain("depth-last")
})

test("a plain error keeps name, message and frames", async () => {
  const { logged } = await logOf(new TypeError("boom-plain"))

  expect(logged).toContain("TypeError")
  expect(logged).toContain("boom-plain")
  expect(logged).toContain("error-log.test.ts")
})

test("a DrizzleQueryError-shaped error from a second drizzle copy is redacted the same way", async () => {
  // drizzle-orm が 2 コピー入ると instanceof が外れる。形 (query: string, params: array) で判定する
  const foreign = Object.assign(new Error(`Failed query: ${QUERY}\nparams: ${SECRET}`), {
    name: "DrizzleQueryError",
    query: QUERY,
    params: [SECRET],
    cause: driverLike(),
  })
  const { status, logged } = await logOf(foreign)

  expect(status).toBe(500)
  expect(logged).toContain("unhandled database error")
  expect(logged).toContain(QUERY)
  expect(logged).toContain("23505")
  expect(logged).not.toContain(SECRET)
  expect(logged).not.toContain("params:")
})

test("an error name containing a newline does not leak its extra lines into frames", async () => {
  const err = new TypeError("plain-msg")
  err.name = `Forged\nLEAK ${SECRET}`
  const { logged } = await logOf(err)

  expect(logged).toContain("Forged")
  expect(logged).toContain("plain-msg")
  expect(logged).not.toContain("LEAK")
  expect(logged).not.toContain(SECRET)
  expect(logged).toContain("error-log.test.ts")
})

// 方針 (#137): driver 以外の cause の message はそのままログに出す。Bun 組み込みエラー
// (ERR_INVALID_ARG_TYPE 等) が値を引用する message を持ち得るリスクは受け入れる。
// 根拠は middleware/error.ts のコメント参照。
test("a non-driver cause's message is logged by policy", async () => {
  const cause = new TypeError('The "payload" argument must be of type string. Received undefined')
  const { logged } = await logOf(new Error("wrapper-msg", { cause }))

  expect(logged).toContain("wrapper-msg")
  expect(logged).toContain("Received undefined")
})

test("a 42P01 driver error logs its message since it only names the missing table", async () => {
  const err = driverLike({
    code: "42P01",
    message: 'relation "missing_table" does not exist',
  })
  const { logged } = await logOf(err)

  expect(logged).toContain("unhandled database error")
  expect(logged).toContain("42P01")
  expect(logged).toContain("missing_table")
  expect(logged).not.toContain(SECRET)
})

test("a driver error with any other SQLSTATE keeps dropping its message", async () => {
  const err = driverLike({ code: "42P02", message: `msg ${SECRET}` })
  const { logged } = await logOf(err)

  expect(logged).toContain("42P02")
  expect(logged).not.toContain(SECRET)
})

test.each([
  "table_name",
  "constraint_name",
  "column_name",
  "schema_name",
  "routine",
  "severity",
  "name",
])("a non-string driver field %s is not logged", async (field) => {
  const { logged } = await logOf(driverLike({ [field]: { v: SECRET } }))

  expect(logged).not.toContain(SECRET)
})
