import { expect, test } from "bun:test"
import { createYahooProvider, type YahooFetch } from "./yahoo"

const VALID_JAN = "4901234567894"

const buildFetch = (impl: YahooFetch): YahooFetch => impl

test("createYahooProvider throws when appId is missing", () => {
  expect(() => createYahooProvider({ appId: "" })).toThrow()
})

test("Yahoo provider: hit returns ProductMasterCandidate", async () => {
  const fetchMock = buildFetch(
    async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return {
            hits: [
              {
                name: "Test Product",
                image: { medium: "https://example.test/m.jpg" },
                brand: { name: "Brand X" },
                seller: { name: "Mfr Y" },
              },
            ],
          }
        },
      }) as Awaited<ReturnType<YahooFetch>>,
  )
  const provider = createYahooProvider({ appId: "fake-app-id", fetch: fetchMock })

  const result = await provider.lookup(VALID_JAN)
  expect(result).not.toBeNull()
  expect(result?.name).toBe("Test Product")
  expect(result?.brand).toBe("Brand X")
  expect(result?.manufacturer).toBe("Mfr Y")
  expect(result?.imageUrl).toBe("https://example.test/m.jpg")
  expect(result?.source).toBe("YAHOO_SHOPPING")
  expect(result?.confidence).toBe("MEDIUM")
})

test("Yahoo provider: empty hits returns null (cf. 404)", async () => {
  const fetchMock = buildFetch(
    async () =>
      ({
        ok: true,
        status: 200,
        async json() {
          return { hits: [] }
        },
      }) as Awaited<ReturnType<YahooFetch>>,
  )
  const provider = createYahooProvider({ appId: "fake-app-id", fetch: fetchMock })

  expect(await provider.lookup(VALID_JAN)).toBeNull()
})

test("Yahoo provider: 429 rate limit returns null", async () => {
  const fetchMock = buildFetch(
    async () =>
      ({
        ok: false,
        status: 429,
        async json() {
          return { error: "rate limit" }
        },
      }) as Awaited<ReturnType<YahooFetch>>,
  )
  const provider = createYahooProvider({ appId: "fake-app-id", fetch: fetchMock })

  expect(await provider.lookup(VALID_JAN)).toBeNull()
})

test("Yahoo provider: network error returns null", async () => {
  const fetchMock = buildFetch(async () => {
    throw new Error("ECONNRESET")
  })
  const provider = createYahooProvider({ appId: "fake-app-id", fetch: fetchMock })

  expect(await provider.lookup(VALID_JAN)).toBeNull()
})
