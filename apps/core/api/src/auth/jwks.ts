import type { HonoJsonWebKey } from "hono/utils/jwt/jws"

// NOTE: Supabase は署名鍵をローテーションするため、キャッシュは 10 分で捨てる。
const TTL_MS = 10 * 60 * 1000
// 未知の kid による取り直しの間隔。でたらめな kid を送り続けられても、取りに行くのはこの間隔に 1 回まで。
const MIN_REFETCH_MS = 60 * 1000

export type FetchJwks = (url: string) => Promise<Response>

export const createJwksKeys = (
  jwksUrl: string,
  fetchJwks: FetchJwks = (url) => fetch(url),
  now: () => number = Date.now,
) => {
  let cache: { keys: HonoJsonWebKey[]; fetchedAt: number } | undefined

  const load = async (): Promise<HonoJsonWebKey[]> => {
    const res = await fetchJwks(jwksUrl)
    if (!res.ok) {
      throw new Error(`JWKS fetch failed with status ${res.status}`)
    }
    const body = (await res.json()) as { keys?: unknown }
    if (!Array.isArray(body.keys)) {
      throw new Error("JWKS response has no keys array")
    }
    cache = { keys: body.keys as HonoJsonWebKey[], fetchedAt: now() }
    return cache.keys
  }

  // 手持ちに無い kid は鍵ローテーション直後の可能性があるので、キャッシュが新しくても取り直す。
  return async (kid: string): Promise<HonoJsonWebKey[]> => {
    if (!cache) return load()
    const age = now() - cache.fetchedAt
    if (age >= TTL_MS) return load()
    if (cache.keys.some((k) => k.kid === kid) || age < MIN_REFETCH_MS) return cache.keys
    return load()
  }
}
