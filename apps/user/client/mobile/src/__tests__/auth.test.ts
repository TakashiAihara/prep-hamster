import { afterEach, beforeEach, expect, test } from "bun:test"
import { getAccessToken } from "../auth"

const ENV_KEY = "EXPO_PUBLIC_DEV_ACCESS_TOKEN"
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

test("getAccessToken returns the env value when set", () => {
  process.env[ENV_KEY] = "dev-access-1"
  expect(getAccessToken()).toBe("dev-access-1")
})

test("getAccessToken returns an empty string when env is unset", () => {
  delete process.env[ENV_KEY]
  expect(getAccessToken()).toBe("")
})
