import type { JanProvider, ProductMasterCandidate, ProductMasterConfidence } from "../types"

// Yahoo!ショッピング 商品検索 API v3.
// docs: https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html

const DEFAULT_YAHOO_ENDPOINT = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch"

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
  // テスト・staging・将来のバージョン切替を見据え、endpoint を差し替え可能にしておく。
  // 未指定なら本番 v3 endpoint。
  endpoint?: string
  // テスト時に fetch を差し替える穴。本番は global fetch。
  fetch?: YahooFetch
  // 1 回のリクエストの timeout (ms)。デフォルト 5 秒。
  timeoutMs?: number
  // hit を返したときの confidence。Yahoo は出品ベースなのでデフォルト MEDIUM だが
  // chain 構成や運用観測に応じて引き上げ/引き下げを許容する。
  confidence?: ProductMasterConfidence
  // provider 識別名。複数 Yahoo provider (本番 / staging) を chain に並べる際に
  // 衝突を避けるため上書き可能。デフォルト "yahoo"。
  name?: string
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
  const endpoint = opts.endpoint ?? DEFAULT_YAHOO_ENDPOINT
  const fetchImpl = opts.fetch ?? (globalThis.fetch as YahooFetch)
  const timeoutMs = opts.timeoutMs ?? 5000
  const confidence: ProductMasterConfidence = opts.confidence ?? "MEDIUM"

  return {
    name: opts.name ?? "yahoo",
    async lookup(jan): Promise<ProductMasterCandidate | null> {
      const url = `${endpoint}?appid=${encodeURIComponent(opts.appId)}&jan_code=${encodeURIComponent(jan)}&results=1`
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
          confidence,
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
