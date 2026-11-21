import { test, expect } from "bun:test"
import type { Db } from "@prep-hamster/db"
import { createApp } from "../app"
import { createTestKey, signAccessToken, testAuth } from "./auth-fixture"

// 認証 middleware は users 行の有無を select するので、行が既にある user として返す
const mockDb = {
  select: () => ({ from: () => ({ where: async () => [{ id: "existing" }] }) }),
} as unknown as Db

const { privateJwk, publicJwk } = await createTestKey("smoke-key")
const auth = testAuth(publicJwk)

test("GET /health returns ok", async () => {
  const app = createApp({ db: mockDb, auth })
  const res = await app.request("/health")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test("GET /v1/stocks without Authorization header returns 401", async () => {
  const app = createApp({ db: mockDb, auth })
  const res = await app.request("/v1/stocks?groupId=00000000-0000-0000-0000-000000000000")
  expect(res.status).toBe(401)
})

test("POST /v1/stocks without Authorization header returns 401", async () => {
  const app = createApp({ db: mockDb, auth })
  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  expect(res.status).toBe(401)
})

test("GET /v1/stocks with invalid groupId returns 422", async () => {
  const app = createApp({ db: mockDb, auth })
  const token = await signAccessToken(privateJwk)
  const res = await app.request("/v1/stocks?groupId=not-a-uuid", {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.status).toBe(422)
})

test("GET /openapi.json returns OpenAPI 3.1 spec", async () => {
  const app = createApp({ db: mockDb, auth })
  const res = await app.request("/openapi.json")
  expect(res.status).toBe(200)
  const body = (await res.json()) as { openapi: string; info: { title: string }; paths: object }
  expect(body.openapi).toBe("3.1.0")
  expect(body.info.title).toBe("prep-hamster API")
  expect(body.paths).toHaveProperty("/v1/stocks")
})

// id 列は guid() (RFC 9562 の version を持たない stub id を許容する緩い形) で検証するが、
// spec 上は uuid とだけ名乗る。zod-to-openapi の guid -> uuid マッピングが外れると
// format: "guid" (OpenAPI format registry に無い値) が漏れるので固定する。
test("GET /openapi.json emits format uuid for guid-validated fields", async () => {
  const app = createApp({ db: mockDb, auth })
  const res = await app.request("/openapi.json")
  const body = (await res.json()) as {
    components: {
      schemas: Record<string, { properties?: Record<string, { format?: string }> }>
    }
  }
  const props = (name: string) => body.components.schemas[name]?.properties ?? {}
  expect(props("Group")["id"]?.format).toBe("uuid")
  expect(props("Group")["createdBy"]?.format).toBe("uuid")
  expect(props("CreateStockBody")["groupId"]?.format).toBe("uuid")
})

test("GET /docs serves Scalar UI HTML", async () => {
  const app = createApp({ db: mockDb, auth })
  const res = await app.request("/docs")
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toContain("text/html")
})
