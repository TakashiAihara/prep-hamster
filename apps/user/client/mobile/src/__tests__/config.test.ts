import { afterEach, beforeEach, expect, test } from "bun:test"
import { getCurrentGroupId } from "../config"

const ENV_KEY = "EXPO_PUBLIC_STUB_GROUP_ID"
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

test("getCurrentGroupId returns the env override when set", () => {
  process.env[ENV_KEY] = "22222222-2222-2222-2222-222222222222"
  expect(getCurrentGroupId()).toBe("22222222-2222-2222-2222-222222222222")
})

test("getCurrentGroupId falls back to a fixed UUID when env is unset", () => {
  delete process.env[ENV_KEY]
  expect(getCurrentGroupId()).toBe("00000000-0000-0000-0000-000000000010")
})
