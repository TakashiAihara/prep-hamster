import { beforeAll, beforeEach, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedItem, seedLocation, seedStock, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { bearer, e2eAuth } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

async function setup() {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const locationId = await seedLocation(groupId, "Pantry")
  const itemId = await seedItem(groupId, "Apple")
  const app = createApp({ db: testDb, auth: e2eAuth })
  const auth = await bearer(userId)
  const list = async (query: string) => {
    const res = await app.request(`/v1/stocks?groupId=${groupId}${query}`, {
      headers: { authorization: auth },
    })
    return res
  }
  const ids = async (query: string) => {
    const res = await list(query)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stocks: Array<{ id: string }> }
    return body.stocks.map((s) => s.id).toSorted()
  }
  const seed = (quantity: number, dates: { useByDate?: string | null } = {}) =>
    seedStock(groupId, itemId, locationId, quantity, dates)
  return { list, ids, seed }
}

test("GET /v1/stocks leaves out used-up stocks by default", async () => {
  const { ids, seed } = await setup()
  const alive = await seed(2)
  await seed(0)

  expect(await ids("")).toEqual([alive])
})

test("GET /v1/stocks treats a residue below the sixth decimal as used up", async () => {
  // 端末が数量 0 とみなす基準 (小数第 6 位で丸めて 0 以下) と揃える
  const { ids, seed } = await setup()
  await seed(0.0000004)
  const smallest = await seed(0.000001)

  expect(await ids("")).toEqual([smallest])
})

test("GET /v1/stocks?includeEmpty=true includes used-up stocks", async () => {
  const { ids, seed } = await setup()
  const alive = await seed(2)
  const empty = await seed(0)

  expect(await ids("&includeEmpty=true")).toEqual([alive, empty].toSorted())
})

test("includeEmpty does not bring back expired stocks unless includeExpired is set", async () => {
  const { ids, seed } = await setup()
  await seed(0, { useByDate: "2000-01-01" })
  const emptyFuture = await seed(0, { useByDate: "2999-01-01" })

  expect(await ids("&includeEmpty=true")).toEqual([emptyFuture])
})

test("includeEmpty=false behaves like the default", async () => {
  const { ids, seed } = await setup()
  const alive = await seed(2)
  await seed(0)

  expect(await ids("&includeEmpty=false")).toEqual([alive])
})

test("an includeEmpty value that is not true or false is rejected with 422", async () => {
  const { list } = await setup()

  const res = await list("&includeEmpty=yes")

  expect(res.status).toBe(422)
})
