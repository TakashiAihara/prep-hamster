import { test, expect } from "bun:test"
import { z } from "zod"
import { jaErrorMap } from "../error-map"

// `z.setErrorMap` を直接呼ぶと global state を汚すので、
// schema 1 個ずつに対して errorMap を渡して局所的に検証する。

test("invalid_string (uuid) → 日本語メッセージ", () => {
  const r = z.string().uuid().safeParse("not-a-uuid", { errorMap: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("UUID 形式で指定してください")
  }
})

test("invalid_string (email) → 日本語メッセージ", () => {
  const r = z.string().email().safeParse("not-email", { errorMap: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("メールアドレス形式で指定してください")
  }
})

test("invalid_type (undefined) → 必須項目です", () => {
  const r = z.object({ name: z.string() }).safeParse({}, { errorMap: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("必須項目です")
  }
})

test("too_small (string min 1) → 必須項目です", () => {
  const r = z.string().min(1).safeParse("", { errorMap: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("必須項目です")
  }
})

test("too_small (number) → ◯◯ 以上の数値で指定してください", () => {
  const r = z.number().min(10).safeParse(5, { errorMap: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("10 以上の数値で指定してください")
  }
})

test("invalid_enum_value → 候補リストを表示", () => {
  const r = z.enum(["A", "B", "C"]).safeParse("D", { errorMap: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("次のいずれかを指定してください: A / B / C")
  }
})
