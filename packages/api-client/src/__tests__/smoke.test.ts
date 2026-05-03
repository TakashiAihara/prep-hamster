import { test, expect } from "bun:test"
import { createApp } from "@prep-hamster/api"
import type { Db } from "@prep-hamster/db"
import { createApiClient, type ClientFetch } from "../index"

const mockDb = {} as Db

test("client integrates with createApp via shared fetch", async () => {
  const app = createApp({ db: mockDb })
  const client = createApiClient({
    baseUrl: "http://localhost",
    userId: "00000000-0000-0000-0000-000000000000",
    fetch: app.request,
  })

  const res = await client.health.$get()
  expect(res.status).toBe(200)
  const data = await res.json()
  expect(data).toEqual({ ok: true })
})

test("client propagates x-user-id header to fetch", async () => {
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
    userId: "user-abc",
    fetch: mockFetch,
  })

  await client.health.$get()

  expect(receivedHeaders?.get("x-user-id")).toBe("user-abc")
})
