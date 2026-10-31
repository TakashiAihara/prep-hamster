import { beforeAll, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { ensureMigrated, testDb } from "./setup"
import { e2eAuth } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

test("GET /health returns ok", async () => {
  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request("/health")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
