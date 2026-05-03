import { test, expect } from "bun:test"
import type { Db } from "@prep-hamster/db"
import { createApp } from "../app"

const mockDb = {} as Db

test("GET /health returns ok", async () => {
  const app = createApp({ db: mockDb })
  const res = await app.request("/health")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test("GET /v1/stocks without x-user-id returns 401", async () => {
  const app = createApp({ db: mockDb })
  const res = await app.request(
    "/v1/stocks?groupId=00000000-0000-0000-0000-000000000000",
  )
  expect(res.status).toBe(401)
})

test("POST /v1/stocks without x-user-id returns 401", async () => {
  const app = createApp({ db: mockDb })
  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  expect(res.status).toBe(401)
})

test("GET /v1/stocks with invalid groupId returns 400", async () => {
  const app = createApp({ db: mockDb })
  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { "x-user-id": "00000000-0000-0000-0000-000000000000" },
  })
  expect(res.status).toBe(400)
})
