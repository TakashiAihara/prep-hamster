import { expect, test } from "bun:test"
import { createAuthFetch, resolveApiBaseUrl } from "../api"

test("resolveApiBaseUrl returns the env override when set", () => {
  expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: "http://192.168.1.10:3000" })).toBe(
    "http://192.168.1.10:3000",
  )
})

test("resolveApiBaseUrl falls back to localhost:3000 when env is unset", () => {
  expect(resolveApiBaseUrl({})).toBe("http://localhost:3000")
})

test("createAuthFetch resolves the token per request and overrides authorization", async () => {
  const seen: (string | null)[] = []
  let current = "first"
  const authFetch = createAuthFetch(
    async () => current,
    async (_input, init) => {
      seen.push(new Headers(init?.headers).get("authorization"))
      return new Response("ok")
    },
  )

  await authFetch("http://x/a", { headers: { authorization: "Bearer stale" } })
  current = "second"
  await authFetch("http://x/b")

  expect(seen).toEqual(["Bearer first", "Bearer second"])
})

test("createAuthFetch keeps other headers and sends a bare bearer without a session", async () => {
  let headers = new Headers()
  const authFetch = createAuthFetch(
    async () => "",
    async (_input, init) => {
      headers = new Headers(init?.headers)
      return new Response("ok")
    },
  )

  await authFetch("http://x/a", { headers: { "x-keep": "1" } })

  expect(headers.get("x-keep")).toBe("1")
  // Headers は値の末尾の空白を落とす
  expect(headers.get("authorization")).toBe("Bearer")
})
