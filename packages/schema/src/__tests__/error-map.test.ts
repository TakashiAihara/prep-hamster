import { test, expect } from "bun:test"
import { z } from "zod"
import { jaErrorMap } from "../error-map"

// global の `z.config` を呼ぶと state を汚すので、
// schema 1 個ずつに対して `error` を渡して局所的に検証する。

test("invalid_string (uuid) → 日本語メッセージ", () => {
  const r = z.string().uuid().safeParse("not-a-uuid", { error: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("UUID 形式で指定してください")
  }
})

test("invalid_string (guid) → UUID と同じ日本語メッセージ", () => {
  const r = z.guid().safeParse("not-a-uuid", { error: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("UUID 形式で指定してください")
  }
})

test("invalid_string (email) → 日本語メッセージ", () => {
  const r = z.string().email().safeParse("not-email", { error: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("メールアドレス形式で指定してください")
  }
})

test("invalid_type (undefined) → 必須項目です", () => {
  const r = z.object({ name: z.string() }).safeParse({}, { error: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("必須項目です")
  }
})

test("too_small (string min 1) → 必須項目です", () => {
  const r = z.string().min(1).safeParse("", { error: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("必須項目です")
  }
})

test("too_small (number) → ◯◯ 以上の数値で指定してください", () => {
  const r = z.number().min(10).safeParse(5, { error: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("10 以上の数値で指定してください")
  }
})

test("invalid_enum_value → 候補リストを表示", () => {
  const r = z.enum(["A", "B", "C"]).safeParse("D", { error: jaErrorMap })
  expect(r.success).toBe(false)
  if (!r.success) {
    expect(r.error.issues[0]?.message).toBe("次のいずれかを指定してください: A / B / C")
  }
})

test("invalid_type の受信型は null と配列を区別する", () => {
  const s = z.object({ name: z.string() })
  const n = s.safeParse({ name: null }, { error: jaErrorMap })
  const a = s.safeParse({ name: [] }, { error: jaErrorMap })
  const o = s.safeParse({ name: {} }, { error: jaErrorMap })
  expect(n.success || n.error.issues[0]?.message).toBe("文字列を指定してください (受信: null)")
  expect(a.success || a.error.issues[0]?.message).toBe("文字列を指定してください (受信: 配列)")
  expect(o.success || o.error.issues[0]?.message).toBe(
    "文字列を指定してください (受信: オブジェクト)",
  )
})
