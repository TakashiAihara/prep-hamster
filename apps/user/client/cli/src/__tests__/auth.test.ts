import { describe, expect, test } from "bun:test"
import { pickConnection, tokenFromSession } from "../auth"

const stored = {
  url: "https://saved.example.test",
  key: "pk-saved",
  apiUrl: "https://api.saved.example.test",
}

describe("pickConnection", () => {
  test("prefers the env key and keeps the saved API URL for the same project", () => {
    expect(
      pickConnection(
        {
          PREP_HAMSTER_SUPABASE_URL: "https://saved.example.test",
          PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY: "pk-rotated",
        },
        stored,
      ),
    ).toEqual({
      url: "https://saved.example.test",
      key: "pk-rotated",
      apiUrl: "https://api.saved.example.test",
    })
  })

  test("uses the saved connection when the env has no Supabase pair", () => {
    expect(pickConnection({}, stored)).toEqual(stored)
  })

  test("lets the env API URL win over the saved one even without the Supabase pair", () => {
    expect(
      pickConnection({ PREP_HAMSTER_API_URL: "https://api.env.example.test" }, stored),
    ).toEqual({ ...stored, apiUrl: "https://api.env.example.test" })
    const noApi = { url: stored.url, key: stored.key }
    expect(pickConnection({ PREP_HAMSTER_API_URL: "https://api.env.example.test" }, noApi)).toEqual(
      {
        ...noApi,
        apiUrl: "https://api.env.example.test",
      },
    )
  })

  test("does not carry the saved API URL over to another Supabase project", () => {
    expect(
      pickConnection(
        {
          PREP_HAMSTER_SUPABASE_URL: "https://other.example.test",
          PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY: "pk-other",
        },
        stored,
      ),
    ).toEqual({ url: "https://other.example.test", key: "pk-other" })
  })

  test("ignores half of the env pair", () => {
    expect(
      pickConnection({ PREP_HAMSTER_SUPABASE_URL: "https://env.example.test" }, stored),
    ).toEqual(stored)
  })

  test("takes the API URL from the env when set", () => {
    expect(
      pickConnection(
        {
          PREP_HAMSTER_SUPABASE_URL: "https://env.example.test",
          PREP_HAMSTER_SUPABASE_PUBLISHABLE_KEY: "pk-env",
          PREP_HAMSTER_API_URL: "https://api.env.example.test",
        },
        null,
      ),
    ).toEqual({
      url: "https://env.example.test",
      key: "pk-env",
      apiUrl: "https://api.env.example.test",
    })
  })

  test("returns null with neither env nor a saved connection", () => {
    expect(pickConnection({}, null)).toBeNull()
  })
})

const retryable = (e: unknown) => e instanceof Error && e.message === "fetch failed"

describe("tokenFromSession", () => {
  test("returns the access token when there is no error", () => {
    expect(tokenFromSession("tok-1", null, retryable)).toBe("tok-1")
  })

  test("asks for login (null) when the refresh token was refused", () => {
    expect(
      tokenFromSession("tok-stale", new Error("Invalid Refresh Token: Already Used"), retryable),
    ).toBeNull()
  })

  test("throws the cause when the auth server could not be reached", () => {
    expect(() => tokenFromSession(null, new Error("fetch failed"), retryable)).toThrow(
      "認証サーバに届かず、セッションを更新できませんでした: fetch failed",
    )
  })
})
