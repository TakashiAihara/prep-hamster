import { test, expect } from "bun:test"
import { createApp } from "@prep-hamster/api"
import type { Db } from "@prep-hamster/db"
import { createApiClient, type ClientFetch } from "../index"

const mockDb = {} as Db
// /health は認証の外なので鍵は使われない。
const auth = {
  getKeys: async () => [],
  issuer: "https://auth.test/auth/v1",
  audience: "authenticated",
}

test("client integrates with createApp via shared fetch", async () => {
  const app = createApp({ db: mockDb, auth })
  const client = createApiClient({
    baseUrl: "http://localhost",
    accessToken: "access-health",
    fetch: app.request,
  })

  const res = await client.health.$get()
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(data).toEqual({ ok: true })
})

test("client sends the access token as a bearer Authorization header", async () => {
  let receivedHeaders: Headers | undefined
  const mockFetch: ClientFetch = async (input, init) => {
    if (input instanceof Request) {
      receivedHeaders = input.headers
    } else {
      receivedHeaders = new Headers(init?.headers)
    }
    return new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const client = createApiClient({
    baseUrl: "http://localhost",
    accessToken: "access-abc",
    fetch: mockFetch,
  })

  await client.health.$get()

  expect(receivedHeaders?.get("authorization")).toBe("Bearer access-abc")
})
