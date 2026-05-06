import { expect, test } from "bun:test"
import { createJanApiClient } from "./client"
import type { JanProvider, ProductMasterCandidate } from "./types"

const VALID_JAN = "4901234567894"

const fixture = (): ProductMasterCandidate => ({
  jan: VALID_JAN,
  name: "Test Product",
  manufacturer: null,
  brand: null,
  contentAmount: null,
  contentUnit: null,
  categoryHint: null,
  imageUrl: null,
  source: "OTHER",
  sourceRaw: null,
  confidence: null,
})

const provider = (name: string, hit: ProductMasterCandidate | null): JanProvider => ({
  name,
  async lookup() {
    return hit
  },
})

test("invalid JAN short-circuits without provider call", async () => {
  let calls = 0
  const client = createJanApiClient({
    providers: [
      {
        name: "spy",
        async lookup() {
          calls++
          return fixture()
        },
      },
    ],
  })
  const result = await client.lookup("123")
  expect(result).toBeNull()
  expect(calls).toBe(0)
})

test("first hit wins; later providers not called", async () => {
  let secondCalls = 0
  const client = createJanApiClient({
    providers: [
      provider("first", fixture()),
      {
        name: "second",
        async lookup() {
          secondCalls++
          return null
        },
      },
    ],
  })
  const result = await client.lookup(VALID_JAN)
  expect(result?.name).toBe("Test Product")
  expect(secondCalls).toBe(0)
})

test("falls through to next provider on null", async () => {
  const client = createJanApiClient({
    providers: [provider("first", null), provider("second", fixture())],
  })
  const result = await client.lookup(VALID_JAN)
  expect(result?.name).toBe("Test Product")
})

test("returns null when no provider hits", async () => {
  const client = createJanApiClient({
    providers: [provider("a", null), provider("b", null)],
  })
  expect(await client.lookup(VALID_JAN)).toBeNull()
})

test("default chain: yahooAppId not set falls back to stub fixtures", async () => {
  const fixtures = new Map<string, ProductMasterCandidate>()
  fixtures.set(VALID_JAN, fixture())

  const client = createJanApiClient({ stubFixtures: fixtures })
  expect((await client.lookup(VALID_JAN))?.name).toBe("Test Product")
})
