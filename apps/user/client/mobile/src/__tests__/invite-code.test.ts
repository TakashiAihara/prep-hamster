import { describe, expect, test } from "bun:test"
import { inviteMessage, parseInviteCode } from "../invite-code"

const code = "5f3c2a1b-9d8e-4f7a-b6c5-0e1d2c3b4a59"
// 正午 (UTC 03:00) にしておけば、UTC-3〜UTC+20 のどのタイムゾーンでも 11/8 になる
const expiresAt = "2026-11-08T03:00:00.000Z"

describe("parseInviteCode", () => {
  test("accepts the bare code with surrounding spaces", () => {
    expect(parseInviteCode(`  ${code}\n`)).toBe(code)
  })

  test("finds the code inside the message the app shares", () => {
    expect(parseInviteCode(inviteMessage("相原家 2026", code, expiresAt))).toBe(code)
  })

  test("returns the token even when the group name is itself a UUID", () => {
    const groupName = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
    expect(parseInviteCode(inviteMessage(groupName, code, expiresAt))).toBe(code)
  })

  test("takes the first code when the text holds two", () => {
    const other = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
    expect(parseInviteCode(`${code} ${other}`)).toBe(code)
  })

  test("names the group, single use and the expiry day in the shared message", () => {
    const message = inviteMessage("相原家", code, expiresAt)
    expect(message).toContain("「相原家」")
    expect(message).toContain("1 人だけ")
    expect(message).toContain("11/8 まで")
  })

  test("lowercases a code typed in capitals", () => {
    expect(parseInviteCode(code.toUpperCase())).toBe(code)
  })

  test("returns null when no code is present", () => {
    expect(parseInviteCode("招待します")).toBeNull()
    expect(parseInviteCode("5f3c2a1b-9d8e-4f7a-b6c5")).toBeNull()
  })
})
