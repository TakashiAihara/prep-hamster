import { expect, test } from "bun:test"
import { createJwksKeys } from "../auth/jwks"

const JWKS_URL = "https://example.test/auth/v1/.well-known/jwks.json"

const jwksResponse = (kids: string[]) =>
  new Response(JSON.stringify({ keys: kids.map((kid) => ({ kid, kty: "EC", crv: "P-256" })) }), {
    headers: { "content-type": "application/json" },
  })

const fakeClock = () => {
  const clock = { t: 0 }
  return { now: () => clock.t, advance: (ms: number) => (clock.t += ms) }
}

test("serves keys from cache within 10 minutes without refetching", async () => {
  const clock = fakeClock()
  const urls: string[] = []
  const getKeys = createJwksKeys(
    JWKS_URL,
    async (url) => {
      urls.push(url)
      return jwksResponse(["k1"])
    },
    clock.now,
  )

  await getKeys("k1")
  clock.advance(599_999)
  const keys = await getKeys("k1")

  expect(urls).toEqual([JWKS_URL])
  expect(keys.map((k) => k.kid)).toEqual(["k1"])
})

test("refetches keys once the 10 minute TTL has elapsed", async () => {
  const clock = fakeClock()
  let count = 0
  const getKeys = createJwksKeys(
    JWKS_URL,
    async () => {
      count += 1
      return jwksResponse(["k1"])
    },
    clock.now,
  )

  await getKeys("k1")
  clock.advance(600_000)
  await getKeys("k1")

  expect(count).toBe(2)
})

test("refetches when the kid is missing from a cache older than one minute", async () => {
  const clock = fakeClock()
  const responses = [jwksResponse(["old"]), jwksResponse(["old", "rotated"])]
  let count = 0
  const getKeys = createJwksKeys(
    JWKS_URL,
    async () => responses[count++] ?? jwksResponse([]),
    clock.now,
  )

  await getKeys("old")
  clock.advance(60_000)
  const keys = await getKeys("rotated")

  expect(count).toBe(2)
  expect(keys.map((k) => k.kid)).toEqual(["old", "rotated"])
})

test("unknown kids within one minute of the last fetch do not trigger another fetch", async () => {
  const clock = fakeClock()
  let count = 0
  const getKeys = createJwksKeys(
    JWKS_URL,
    async () => {
      count++
      return jwksResponse(["k1"])
    },
    clock.now,
  )

  await getKeys("k1")
  clock.advance(59_999)
  await Promise.all(["x1", "x2", "x3"].map((kid) => getKeys(kid)))

  expect(count).toBe(1)
})

test("rejects when the JWKS endpoint responds with an error status", async () => {
  const getKeys = createJwksKeys(JWKS_URL, async () => new Response("", { status: 503 }))

  await expect(getKeys("k1")).rejects.toThrow("JWKS fetch failed with status 503")
})

test("rejects when the JWKS response has no keys array", async () => {
  const getKeys = createJwksKeys(
    JWKS_URL,
    async () => new Response(JSON.stringify({ error: "nope" })),
  )

  await expect(getKeys("k1")).rejects.toThrow("JWKS response has no keys array")
})

test("keeps serving the cached keys when a refresh fails, and retries after one minute", async () => {
  const clock = fakeClock()
  let count = 0
  let up = true
  const getKeys = createJwksKeys(
    JWKS_URL,
    async () => {
      count++
      return up ? jwksResponse(["k1"]) : new Response("down", { status: 503 })
    },
    clock.now,
  )

  await getKeys("k1")
  up = false
  clock.advance(600_000)
  const stale = await getKeys("k1")
  clock.advance(30_000)
  await getKeys("k1")

  expect(stale.map((k) => k.kid)).toEqual(["k1"])
  expect(count).toBe(2)

  clock.advance(30_000)
  up = true
  await getKeys("k1")
  expect(count).toBe(3)
})

test("rejects when the first fetch fails and there is no cache", async () => {
  const getKeys = createJwksKeys(JWKS_URL, async () => new Response("down", { status: 503 }))
  await expect(getKeys("k1")).rejects.toThrow("JWKS fetch failed with status 503")
})

test("while the first fetch keeps failing, it is retried at most once a minute", async () => {
  const clock = fakeClock()
  let count = 0
  const getKeys = createJwksKeys(
    JWKS_URL,
    async () => {
      count++
      return new Response("down", { status: 503 })
    },
    clock.now,
  )

  await expect(getKeys("k1")).rejects.toThrow("JWKS fetch failed with status 503")
  await expect(getKeys("k1")).rejects.toThrow("JWKS fetch failed recently")
  clock.advance(59_999)
  await expect(getKeys("k1")).rejects.toThrow("JWKS fetch failed recently")
  expect(count).toBe(1)

  clock.advance(1)
  await expect(getKeys("k1")).rejects.toThrow("JWKS fetch failed with status 503")
  expect(count).toBe(2)
})
