import { describe, expect, test } from "bun:test"
import { parseInviteCode } from "../invite-code"

const code = "5f3c2a1b-9d8e-4f7a-b6c5-0e1d2c3b4a59"

describe("parseInviteCode", () => {
  test("accepts the bare code with surrounding spaces", () => {
    expect(parseInviteCode(`  ${code}\n`)).toBe(code)
  })

  test("finds the code inside the shared message", () => {
    expect(
      parseInviteCode(
        `prep-hamster の招待コード: ${code}\nアプリの「招待コードで参加」に貼ってください`,
      ),
    ).toBe(code)
  })

  test("lowercases a code typed in capitals", () => {
    expect(parseInviteCode(code.toUpperCase())).toBe(code)
  })

  test("returns null when no code is present", () => {
    expect(parseInviteCode("招待します")).toBeNull()
    expect(parseInviteCode("5f3c2a1b-9d8e-4f7a-b6c5")).toBeNull()
  })
})
