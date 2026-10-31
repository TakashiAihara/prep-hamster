import { beforeAll, beforeEach, expect, spyOn, test } from "bun:test"
import { createApp } from "../src/app"
import { ensureMigrated, testDb, truncateAll } from "./setup"
import { eq } from "drizzle-orm"
import { users } from "@prep-hamster/db"
import { createTestKey, signAccessToken } from "../src/__tests__/auth-fixture"
import { seedBaseFixture, seedUser } from "./seed"
import { bearer, e2eAuth, e2eKey } from "./auth-helper"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

test("GET /v1/stocks without a bearer token returns 401", async () => {
  const { groupId } = await seedBaseFixture()
  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request(`/v1/stocks?groupId=${groupId}`)
  expect(res.status).toBe(401)
})

test("POST /v1/stocks without a bearer token returns 401", async () => {
  const app = createApp({ db: testDb, auth: e2eAuth })
  const res = await app.request("/v1/stocks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
  expect(res.status).toBe(401)
})

const get = async (authorization?: string) =>
  createApp({ db: testDb, auth: e2eAuth }).request("/v1/groups", {
    headers: authorization ? { authorization } : {},
  })

const b64url = (data: string | ArrayBuffer) =>
  Buffer.from(typeof data === "string" ? data : new Uint8Array(data)).toString("base64url")

// 同じ kid を名乗る HS256 の token。公開鍵を HMAC の鍵に流用させる alg 混同を想定する。
const hs256Jwt = async (claims: Record<string, unknown>) => {
  const head = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "e2e" }))}.${b64url(
    JSON.stringify(claims),
  )}`
  const hmac = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JSON.stringify(e2eKey.publicJwk)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(head))
  return `${head}.${b64url(sig)}`
}

test("a valid bearer token is accepted", async () => {
  const userId = await seedUser()
  const res = await get(await bearer(userId))
  expect(res.status).toBe(200)
})

test("a token signed by a different key returns 401", async () => {
  const other = await createTestKey("e2e")
  const jwt = await signAccessToken(other.privateJwk, { sub: crypto.randomUUID() })
  expect((await get(`Bearer ${jwt}`)).status).toBe(401)
})

test("an expired token returns 401", async () => {
  const jwt = await signAccessToken(e2eKey.privateJwk, {
    sub: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) - 60,
  })
  expect((await get(`Bearer ${jwt}`)).status).toBe(401)
})

test("a token from another issuer returns 401", async () => {
  const jwt = await signAccessToken(e2eKey.privateJwk, {
    sub: crypto.randomUUID(),
    iss: "https://other.test/auth/v1",
  })
  expect((await get(`Bearer ${jwt}`)).status).toBe(401)
})

test("a token for another audience returns 401", async () => {
  const jwt = await signAccessToken(e2eKey.privateJwk, { sub: crypto.randomUUID(), aud: "anon" })
  expect((await get(`Bearer ${jwt}`)).status).toBe(401)
})

test("an HS256 token returns 401", async () => {
  const jwt = await hs256Jwt({
    iss: "https://auth.test/auth/v1",
    aud: "authenticated",
    sub: crypto.randomUUID(),
    email: "hs@example.test",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
  expect((await get(`Bearer ${jwt}`)).status).toBe(401)
})

test("a token without an email returns 401", async () => {
  const jwt = await signAccessToken(e2eKey.privateJwk, {
    sub: crypto.randomUUID(),
    email: undefined,
  })
  expect((await get(`Bearer ${jwt}`)).status).toBe(401)
})

test("an Authorization header that is not Bearer returns 401", async () => {
  expect((await get("Basic dXNlcjpwYXNz")).status).toBe(401)
})

test("the first request of an unknown user creates the users row from the token", async () => {
  const userId = crypto.randomUUID()
  const jwt = await signAccessToken(e2eKey.privateJwk, {
    sub: userId,
    email: "first.visit@example.test",
  })

  expect((await get(`Bearer ${jwt}`)).status).toBe(200)

  const [row] = await testDb.select().from(users).where(eq(users.id, userId))
  expect(row?.email).toBe("first.visit@example.test")
  expect(row?.displayName).toBe("first.visit")
})

test("a non-UUID sub returns 401", async () => {
  const jwt = await signAccessToken(e2eKey.privateJwk, { sub: "not-a-uuid" })
  expect((await get(`Bearer ${jwt}`)).status).toBe(401)
})

test("a new account whose email is taken by another user returns 409 EMAIL_IN_USE", async () => {
  const takenId = await seedUser()
  const [taken] = await testDb.select().from(users).where(eq(users.id, takenId))
  const newcomer = crypto.randomUUID()
  const jwt = await signAccessToken(e2eKey.privateJwk, { sub: newcomer, email: taken?.email })

  const res = await createApp({ db: testDb, auth: e2eAuth }).request("/v1/groups", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ name: "g" }),
  })

  expect(res.status).toBe(409)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("EMAIL_IN_USE")
  expect(await testDb.select().from(users).where(eq(users.id, newcomer))).toHaveLength(0)
})

test("returns 503 AUTH_UNAVAILABLE when no signing keys can be loaded, and logs why", async () => {
  const logged: string[] = []
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "))
  })

  const app = createApp({
    db: testDb,
    auth: {
      ...e2eAuth,
      getKeys: async (): Promise<never> => {
        throw new Error("JWKS fetch failed with status 503")
      },
    },
  })
  const res = await app.request("/v1/groups", {
    headers: { authorization: await bearer(crypto.randomUUID()) },
  })
  spy.mockRestore()

  expect(res.status).toBe(503)
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH_UNAVAILABLE")
  expect(logged.join("\n")).toContain("signing keys unavailable: JWKS fetch failed with status 503")
})

test("a token signed with an RS256 key from the JWKS is accepted", async () => {
  const rsa = await createTestKey("rsa", "RS256")
  const app = createApp({ db: testDb, auth: { ...e2eAuth, getKeys: async () => [rsa.publicJwk] } })
  const userId = await seedUser()
  const jwt = await signAccessToken(rsa.privateJwk, { sub: userId })

  const res = await app.request("/v1/groups", { headers: { authorization: `Bearer ${jwt}` } })

  expect(res.status).toBe(200)
})

test("the bearer scheme is matched case-insensitively", async () => {
  const userId = await seedUser()
  const value = await bearer(userId)
  expect((await get(value.replace(/^Bearer/, "bearer"))).status).toBe(200)
})
