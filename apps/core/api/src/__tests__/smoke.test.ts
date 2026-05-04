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
  const res = await app.request("/v1/stocks?groupId=00000000-0000-0000-0000-000000000000")
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

test("GET /openapi.json returns OpenAPI 3.1 spec", async () => {
  const app = createApp({ db: mockDb })
  const res = await app.request("/openapi.json")
  expect(res.status).toBe(200)
  const body = (await res.json()) as { openapi: string; info: { title: string }; paths: object }
  expect(body.openapi).toBe("3.1.0")
  expect(body.info.title).toBe("prep-hamster API")
  expect(body.paths).toHaveProperty("/v1/stocks")
})

test("GET /docs serves Scalar UI HTML", async () => {
  const app = createApp({ db: mockDb })
  const res = await app.request("/docs")
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toContain("text/html")
})
