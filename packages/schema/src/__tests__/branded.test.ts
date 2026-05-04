import { test, expect } from "bun:test"
import { GroupId, StockId, UserId } from "../common"

const UUID = "00000000-0000-0000-0000-000000000001"

test("UserId / GroupId / StockId は valid UUID を受け入れる", () => {
  expect(UserId.safeParse(UUID).success).toBe(true)
  expect(GroupId.safeParse(UUID).success).toBe(true)
  expect(StockId.safeParse(UUID).success).toBe(true)
})

test("branded id は invalid UUID を拒否する", () => {
  expect(UserId.safeParse("not-uuid").success).toBe(false)
})

test("branded type は実体としては string", () => {
  const userId: string = UserId.parse(UUID)
  // 実体の文字列としては UUID と一致するが、型レベルでは別物 (compile time check)
  expect(typeof userId).toBe("string")
  expect(userId).toBe(UUID)
})
