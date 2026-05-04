import { beforeAll, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { ensureMigrated, testDb } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

test("GET /health returns ok", async () => {
  const app = createApp({ db: testDb })
  const res = await app.request("/health")
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
