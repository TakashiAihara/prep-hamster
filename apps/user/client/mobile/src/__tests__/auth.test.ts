import { afterEach, beforeEach, expect, test } from "bun:test"
import { getCurrentUserId } from "../auth"

const ENV_KEY = "EXPO_PUBLIC_STUB_USER_ID"
let original: string | undefined

beforeEach(() => {
  original = process.env[ENV_KEY]
})

afterEach(() => {
  if (original === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = original
  }
})

test("getCurrentUserId returns the env override when set", () => {
  process.env[ENV_KEY] = "11111111-1111-1111-1111-111111111111"
  expect(getCurrentUserId()).toBe("11111111-1111-1111-1111-111111111111")
})

test("getCurrentUserId falls back to a fixed UUID when env is unset", () => {
  delete process.env[ENV_KEY]
  expect(getCurrentUserId()).toBe("00000000-0000-0000-0000-000000000001")
})
