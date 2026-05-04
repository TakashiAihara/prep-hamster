import { beforeAll, beforeEach, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { seedBaseFixture } from "./seed"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("GET /v1/stocks without x-user-id returns 401", async () => {
  const { groupId } = await seedBaseFixture()
  const app = createApp({ db: testDb })
  const res = await app.request(`/v1/stocks?groupId=${groupId}`)
  expect(res.status).toBe(401)
})

test("POST /v1/stocks without x-user-id returns 401", async () => {
  const app = createApp({ db: testDb })
  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  expect(res.status).toBe(401)
})
