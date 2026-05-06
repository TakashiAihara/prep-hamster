import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { items, productMasters } from "@prep-hamster/db"
import type { JanApiClient, ProductMasterCandidate } from "@prep-hamster/jan-api"
import { createApp } from "../src/app"
import { seedGroupWithMembership, seedItem, seedMembership, seedUser } from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const VALID_JAN = "4901234567894"

const stubJanApi = (candidate: ProductMasterCandidate | null): JanApiClient => ({
  async lookup() {
    return candidate
  },
})

const sampleCandidate = (
  overrides: Partial<ProductMasterCandidate> = {},
): ProductMasterCandidate => ({
  jan: VALID_JAN,
  name: "テスト商品",
  manufacturer: "Test Mfr",
  brand: "Test Brand",
  contentAmount: null,
  contentUnit: null,
  categoryHint: null,
  imageUrl: "https://example.test/img.jpg",
  source: "YAHOO_SHOPPING",
  sourceRaw: { stub: true },
  confidence: "MEDIUM",
  ...overrides,
})

test("POST /v1/items/by-barcode by VIEWER returns 403 INSUFFICIENT_ROLE", async () => {
  const ownerId = await seedUser("Owner")
  const viewerId = await seedUser("Viewer")
  const groupId = await seedGroupWithMembership(ownerId, "Home")
  await seedMembership(viewerId, groupId, "VIEWER")

  const app = createApp({ db: testDb, janApi: stubJanApi(sampleCandidate()) })
  const res = await app.request("/v1/items/by-barcode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": viewerId },
    body: JSON.stringify({ groupId, barcode: VALID_JAN }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("INSUFFICIENT_ROLE")
})

test("POST /v1/items/by-barcode existing item returns 200 productLookup=existing", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")
  const itemId = await seedItem(groupId, "Pre-existing")
  await testDb.update(items).set({ barcode: VALID_JAN }).where(eq(items.id, itemId))

  let lookupCalls = 0
  const janApi: JanApiClient = {
    async lookup() {
      lookupCalls++
      return null
    },
  }
  const app = createApp({ db: testDb, janApi })
  const res = await app.request("/v1/items/by-barcode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, barcode: VALID_JAN }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    item: { id: string; name: string }
    productLookup: string
  }
  expect(body.productLookup).toBe("existing")
  expect(body.item.id).toBe(itemId)
  expect(body.item.name).toBe("Pre-existing")
  // 既存ヒットでは外部 API を叩かない
  expect(lookupCalls).toBe(0)
})

test("POST /v1/items/by-barcode lookup hit creates productMaster + item", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb, janApi: stubJanApi(sampleCandidate()) })
  const res = await app.request("/v1/items/by-barcode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, barcode: VALID_JAN }),
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    item: { id: string; name: string; productMasterId: string | null; manufacturer: string | null }
    productMaster: { id: string; jan: string; source: string } | null
    productLookup: string
  }
  expect(body.productLookup).toBe("hit")
  expect(body.item.name).toBe("テスト商品")
  expect(body.item.manufacturer).toBe("Test Mfr")
  expect(body.item.productMasterId).not.toBeNull()
  expect(body.productMaster?.jan).toBe(VALID_JAN)
  expect(body.productMaster?.source).toBe("YAHOO_SHOPPING")

  const [pmRow] = await testDb
    .select()
    .from(productMasters)
    .where(eq(productMasters.jan, VALID_JAN))
  expect(pmRow).toBeDefined()
})

test("POST /v1/items/by-barcode lookup miss creates placeholder item", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb, janApi: stubJanApi(null) })
  const res = await app.request("/v1/items/by-barcode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, barcode: VALID_JAN }),
  })

  expect(res.status).toBe(201)
  const body = (await res.json()) as {
    item: { name: string; productMasterId: string | null; barcode: string | null }
    productMaster: unknown
    productLookup: string
  }
  expect(body.productLookup).toBe("miss")
  // placeholder の name は barcode をそのまま使う
  expect(body.item.name).toBe(VALID_JAN)
  expect(body.item.barcode).toBe(VALID_JAN)
  expect(body.item.productMasterId).toBeNull()
  expect(body.productMaster).toBeNull()
})

test("POST /v1/items/by-barcode hit then existing returns 200 with productMaster preserved", async () => {
  const userId = await seedUser()
  const groupId = await seedGroupWithMembership(userId, "Home")

  const app = createApp({ db: testDb, janApi: stubJanApi(sampleCandidate()) })
  // 1 回目: hit で作成
  const first = await app.request("/v1/items/by-barcode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, barcode: VALID_JAN }),
  })
  expect(first.status).toBe(201)

  // 2 回目: 既存 hit で再利用 (200)
  const second = await app.request("/v1/items/by-barcode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ groupId, barcode: VALID_JAN }),
  })
  expect(second.status).toBe(200)
  const body = (await second.json()) as {
    productLookup: string
    productMaster: { jan: string } | null
  }
  expect(body.productLookup).toBe("existing")
  // 既存 item に productMasterId が紐付いていれば response に productMaster が乗る
  expect(body.productMaster?.jan).toBe(VALID_JAN)
})

test("POST /v1/items/by-barcode by non-member returns 403 FORBIDDEN_GROUP_ACCESS", async () => {
  const ownerId = await seedUser("Owner")
  const outsiderId = await seedUser("Outsider")
  const groupId = await seedGroupWithMembership(ownerId, "Home")

  const app = createApp({ db: testDb, janApi: stubJanApi(null) })
  const res = await app.request("/v1/items/by-barcode", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": outsiderId },
    body: JSON.stringify({ groupId, barcode: VALID_JAN }),
  })

  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe("FORBIDDEN_GROUP_ACCESS")
})
