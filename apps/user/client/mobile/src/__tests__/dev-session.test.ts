import { expect, test } from "bun:test"
import { acceptsDevSession, devSessionFromParams } from "../dev-session"

test("devSessionFromParams returns both tokens", () => {
  expect(devSessionFromParams({ access_token: "a-1", refresh_token: "r-1" })).toEqual({
    accessToken: "a-1",
    refreshToken: "r-1",
  })
})

test("devSessionFromParams returns null when a token is missing or repeated", () => {
  expect(devSessionFromParams({ access_token: "a-1" })).toBeNull()
  expect(devSessionFromParams({ refresh_token: "r-1" })).toBeNull()
  expect(devSessionFromParams({ access_token: ["a-1", "a-2"], refresh_token: "r-1" })).toBeNull()
})

test("only dev builds accept a dev session", () => {
  expect(acceptsDevSession(true)).toBe(true)
  expect(acceptsDevSession(false)).toBe(false)
})
