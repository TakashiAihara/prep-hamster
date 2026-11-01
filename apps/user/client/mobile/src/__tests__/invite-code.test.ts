import { describe, expect, test } from "bun:test"
import { inviteMessage, parseInviteCode } from "../invite-code"

const code = "5f3c2a1b-9d8e-4f7a-b6c5-0e1d2c3b4a59"

describe("parseInviteCode", () => {
  test("accepts the bare code with surrounding spaces", () => {
    expect(parseInviteCode(`  ${code}\n`)).toBe(code)
  })

  test("finds the code inside the message the app shares", () => {
    expect(parseInviteCode(inviteMessage("相原家 2026", code))).toBe(code)
  })

  test("takes the first code when the text holds two", () => {
    const other = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
    expect(parseInviteCode(`${code} ${other}`)).toBe(code)
  })

  test("names the group in the shared message", () => {
    expect(inviteMessage("相原家", code)).toContain("「相原家」")
  })

  test("lowercases a code typed in capitals", () => {
    expect(parseInviteCode(code.toUpperCase())).toBe(code)
  })

  test("returns null when no code is present", () => {
    expect(parseInviteCode("招待します")).toBeNull()
    expect(parseInviteCode("5f3c2a1b-9d8e-4f7a-b6c5")).toBeNull()
  })
})
