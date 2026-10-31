import { Jwt } from "hono/utils/jwt"
import type { HonoJsonWebKey } from "hono/utils/jwt/jws"
import type { AuthOptions } from "../middleware/auth"

export const ISSUER = "https://auth.test/auth/v1"
export const AUDIENCE = "authenticated"
export const USER_ID = "11111111-1111-4111-8111-111111111111"
export const USER_EMAIL = "user@example.test"

export const createTestKey = async (kid: string) => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])
  const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey)
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey)
  return {
    privateJwk: { ...privateKey, kid, alg: "ES256" } as HonoJsonWebKey,
    publicJwk: { ...publicKey, kid, alg: "ES256" } as HonoJsonWebKey,
  }
}

export const signAccessToken = (key: HonoJsonWebKey, claims: Record<string, unknown> = {}) =>
  Jwt.sign(
    {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: USER_ID,
      email: USER_EMAIL,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    },
    key,
  )

export const testAuth = (publicJwk: HonoJsonWebKey): AuthOptions => ({
  getKeys: async () => [publicJwk],
  issuer: ISSUER,
  audience: AUDIENCE,
})
