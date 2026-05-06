import type { JanProvider, ProductMasterCandidate } from "../types"

// Yahoo!ショッピング 商品検索 API v3.
// docs: https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html

const YAHOO_ENDPOINT = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch"

export type YahooFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export type YahooProviderOptions = {
  appId: string
  // テスト時に fetch を差し替える穴。本番は global fetch。
  fetch?: YahooFetch
  // 1 回のリクエストの timeout (ms)。デフォルト 5 秒。
  timeoutMs?: number
}

// Yahoo の hit レスポンスから必要な欄だけ抽出する。
// API のフル schema を持つのは過剰なので、参照する path だけ optional chaining で読む。
type YahooHit = {
  name?: string
  image?: { medium?: string; small?: string }
  brand?: { name?: string }
  seller?: { name?: string }
  janCode?: string
  jan_code?: string
}

type YahooResponse = {
  hits?: YahooHit[]
}

export function createYahooProvider(opts: YahooProviderOptions): JanProvider {
  if (!opts.appId) {
    throw new Error("createYahooProvider: appId is required")
  }
  const fetchImpl = opts.fetch ?? (globalThis.fetch as YahooFetch)
  const timeoutMs = opts.timeoutMs ?? 5000

  return {
    name: "yahoo",
    async lookup(jan): Promise<ProductMasterCandidate | null> {
      const url = `${YAHOO_ENDPOINT}?appid=${encodeURIComponent(opts.appId)}&jan_code=${encodeURIComponent(jan)}&results=1`
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetchImpl(url, { signal: ctrl.signal })
        if (!res.ok) {
          // 429 / 5xx 含めヒット扱いにしない (上位がフォールバックする)
          return null
        }
        const data = (await res.json()) as YahooResponse
        const hit = data.hits?.[0]
        if (!hit?.name) return null
        return {
          jan,
          name: hit.name,
          manufacturer: hit.seller?.name ?? null,
          brand: hit.brand?.name ?? null,
          contentAmount: null,
          contentUnit: null,
          categoryHint: null,
          imageUrl: hit.image?.medium ?? hit.image?.small ?? null,
          source: "YAHOO_SHOPPING",
          sourceRaw: hit,
          // Yahoo は出品ベースなので商品名一致の精度は中程度
          confidence: "MEDIUM",
        }
      } catch {
        // ネットワークエラー / abort / parse エラーは null でフォールバック
        return null
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
