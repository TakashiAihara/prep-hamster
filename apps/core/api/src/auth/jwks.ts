import type { HonoJsonWebKey } from "hono/utils/jwt/jws"

// NOTE: Supabase は署名鍵をローテーションするため、キャッシュは 10 分で捨てる。
const TTL_MS = 10 * 60 * 1000
// 取り直しの間隔。でたらめな kid を送り続けられても、取得に失敗し続けても、取りに行くのはこの間隔に 1 回まで。
const MIN_REFETCH_MS = 60 * 1000
// 応答しない相手を待ち続けると、その間の認証が全部止まる。
const FETCH_TIMEOUT_MS = 5_000

export type FetchJwks = (url: string) => Promise<Response>

export const createJwksKeys = (
  jwksUrl: string,
  fetchJwks: FetchJwks = (url) => fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
  now: () => number = Date.now,
) => {
  let cache: { keys: HonoJsonWebKey[]; fetchedAt: number } | undefined
  let attemptedAt = Number.NEGATIVE_INFINITY
  // 取得中に来たリクエストは、新しく取りに行かず同じ取得の結果を待つ。
  let inflight: Promise<HonoJsonWebKey[]> | undefined

  const fetchKeys = async (): Promise<HonoJsonWebKey[]> => {
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

  const load = (): Promise<HonoJsonWebKey[]> => {
    if (inflight) return inflight
    attemptedAt = now()
    inflight = fetchKeys().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  // 手持ちに無い kid は鍵ローテーション直後の可能性があるので、キャッシュが新しくても取り直す。
  // 取り直しに失敗したら手持ちの鍵で検証を続ける (Supabase が一時的に落ちても、有効な token は通す)。
  return async (kid: string): Promise<HonoJsonWebKey[]> => {
    if (inflight) {
      const kept = cache?.keys
      return kept ? inflight.catch(() => kept) : inflight
    }
    if (!cache) {
      // 1 度も取れていないうちも間隔を守る。届かない相手に毎リクエスト取りに行かない。
      if (now() - attemptedAt < MIN_REFETCH_MS) throw new Error("JWKS fetch failed recently")
      return load()
    }
    const stale = now() - cache.fetchedAt >= TTL_MS || !cache.keys.some((k) => k.kid === kid)
    if (!stale || now() - attemptedAt < MIN_REFETCH_MS) return cache.keys
    const kept = cache.keys
    return load().catch(() => kept)
  }
}
