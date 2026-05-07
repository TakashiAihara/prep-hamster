import { expect, test } from "bun:test"
import { resolveApiBaseUrl } from "../api"

test("resolveApiBaseUrl returns the env override when set", () => {
  expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: "http://192.168.1.10:3000" })).toBe(
    "http://192.168.1.10:3000",
  )
})

test("resolveApiBaseUrl falls back to localhost:3000 when env is unset", () => {
  expect(resolveApiBaseUrl({})).toBe("http://localhost:3000")
})
