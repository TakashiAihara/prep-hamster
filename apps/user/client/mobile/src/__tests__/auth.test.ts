import { expect, test } from "bun:test"
import { getAccessToken, initialAuthStatus, parseAuthCallback, redirectFor } from "../auth"

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

test("redirectFor sends a signed-out user to /sign-in except on sign-in and auth screens", () => {
  expect(redirectFor("signed-out", "(tabs)")).toBe("/sign-in")
  expect(redirectFor("signed-out", undefined)).toBe("/sign-in")
  expect(redirectFor("signed-out", "sign-in")).toBeNull()
  expect(redirectFor("signed-out", "auth")).toBeNull()
})

test("redirectFor sends a signed-in user away from /sign-in only", () => {
  expect(redirectFor("signed-in", "sign-in")).toBe("/")
  expect(redirectFor("signed-in", "(tabs)")).toBeNull()
  expect(redirectFor("signed-in", "auth")).toBeNull()
})

test("redirectFor does nothing while loading", () => {
  expect(redirectFor("loading", "sign-in")).toBeNull()
  expect(redirectFor("loading", "(tabs)")).toBeNull()
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
