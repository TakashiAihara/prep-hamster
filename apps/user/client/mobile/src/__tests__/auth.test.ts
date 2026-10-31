import { expect, test } from "bun:test"
import {
  exchangeAuthCodeOnce,
  gateFor,
  getAccessToken,
  initialAuthStatus,
  parseAuthCallback,
} from "../auth"

const NO_CODE = { error: "コールバック URL に code がありません" }

test("getAccessToken returns the access_token of the current session", async () => {
  expect(await getAccessToken(async () => ({ access_token: "from-session-1" }))).toBe(
    "from-session-1",
  )
})

test("getAccessToken returns an empty string without a session", async () => {
  expect(await getAccessToken(async () => null)).toBe("")
})

test("parseAuthCallback returns the code", () => {
  expect(parseAuthCallback("prep-hamster://auth/callback?code=abc123")).toEqual({ code: "abc123" })
})

test("parseAuthCallback returns the code when other params are present", () => {
  expect(
    parseAuthCallback("exp://192.168.1.2:8081/--/auth/callback?state=s&code=abc123&x=1"),
  ).toEqual({
    code: "abc123",
  })
})

test("parseAuthCallback prefers error_description over the code", () => {
  const url =
    "prep-hamster://auth/callback?error=denied_by_user&error_description=User+denied&code=abc123"
  expect(parseAuthCallback(url)).toEqual({ error: "User denied" })
})

test("parseAuthCallback falls back to the error param", () => {
  expect(parseAuthCallback("prep-hamster://auth/callback?error=denied_by_user")).toEqual({
    error: "denied_by_user",
  })
})

test("parseAuthCallback returns an error without a code", () => {
  expect(parseAuthCallback("prep-hamster://auth/callback")).toEqual(NO_CODE)
  expect(parseAuthCallback("prep-hamster://auth/callback?state=s")).toEqual(NO_CODE)
})

test("gateFor renders the app only for a signed-in user and sends others to /sign-in", () => {
  expect(gateFor("signed-in", "app")).toEqual({ render: true })
  expect(gateFor("signed-out", "app")).toEqual({ render: false, redirect: "/sign-in" })
})

test("gateFor renders the sign-in screen only for a signed-out user and sends others home", () => {
  expect(gateFor("signed-out", "sign-in")).toEqual({ render: true })
  expect(gateFor("signed-in", "sign-in")).toEqual({ render: false, redirect: "/" })
})

test("gateFor renders nothing and redirects nowhere while loading", () => {
  expect(gateFor("loading", "app")).toEqual({ render: false, redirect: null })
  expect(gateFor("loading", "sign-in")).toEqual({ render: false, redirect: null })
})

test("initialAuthStatus is signed-in with a session and signed-out without one", async () => {
  expect(await initialAuthStatus(async () => ({ access_token: "a" }))).toBe("signed-in")
  expect(await initialAuthStatus(async () => null)).toBe("signed-out")
})

test("initialAuthStatus falls back to signed-out when the stored session cannot be read", async () => {
  expect(
    await initialAuthStatus(async () => {
      throw new Error("decrypt failed")
    }),
  ).toBe("signed-out")
})

test("exchangeAuthCodeOnce exchanges the same code only once", async () => {
  let calls = 0
  const exchange = async () => {
    calls++
  }
  await Promise.all([exchangeAuthCodeOnce("c-1", exchange), exchangeAuthCodeOnce("c-1", exchange)])
  await exchangeAuthCodeOnce("c-2", exchange)
  expect(calls).toBe(2)
})
