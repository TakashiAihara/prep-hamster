import { isValidJan } from "./jan"
import { createStubProvider } from "./providers/stub"
import { createYahooProvider } from "./providers/yahoo"
import type { JanApiClient, JanProvider, ProductMasterCandidate } from "./types"

// レイヤ構造（消費者は `JanApiClient` interface だけに依存することを想定）:
//
//   consumer (API endpoint / mobile UI)
//        │  受け取る型は JanApiClient のみ
//        ▼
//   JanApiClient   ←  createJanApiClient(opts)
//        │  内部で chain を順に試して first hit を返す
//        ▼
//   JanProvider[]  ←  Yahoo / 楽天 (TBD) / JANCODE (TBD) / stub / ...
//
// 上のレイヤは下のレイヤの実体を知らなくて済むので、
//   - 別 vendor の provider に差し替え (e.g. Rakuten 本実装、staging endpoint, mock)
//   - client 層の振る舞い変更 (cache, retry, metrics 等の wrapper)
//   - 消費者側のテスト (custom JanApiClient を直接注入)
// が独立に行える。

export type CreateJanApiClientOptions = {
  // 明示的に渡された provider を順に試す。env からの自動構築を行う場合は省略。
  providers?: JanProvider[]
  // env から provider を自動構築する場合のフォールバック値。
  // テストコード等から明示的に渡す用。本番は process.env から読む。
  yahooAppId?: string
  // ヒットも生成しない最終 stub。fixtures Map を渡せばテストで再現可能。
  stubFixtures?: Map<string, ProductMasterCandidate>
}

// providers を未指定で呼ばれた場合、env からプロバイダ chain を構築する:
//   YAHOO_SHOPPING_APP_ID があれば yahoo → stub
//   なければ stub のみ (UI からの動作確認・E2E 用)
export function createJanApiClient(opts: CreateJanApiClientOptions = {}): JanApiClient {
  const providers = opts.providers ?? createDefaultProviders(opts)

  return {
    async lookup(jan: string): Promise<ProductMasterCandidate | null> {
      // チェックディジット不正は外部 API を叩く前に短絡する。
      if (!isValidJan(jan)) return null

      for (const provider of providers) {
        // 早期 return で外部 API 呼び出しを最小化したいので意図的に sequential。
        // Promise.all で並列実行するとレート制限に当たる確率が上がる。
        // eslint-disable-next-line no-await-in-loop
        const hit = await provider.lookup(jan)
        if (hit) return hit
      }
      return null
    },
  }
}

// env / opts から「デフォルトの」provider chain を組み立てる convenience helper。
// 消費者が独自の chain を組みたい場合は呼ばずに、`providers: [...]` を直接渡せばよい。
// この関数を export しておくのは、デフォルト構成に独自 provider を **追加** する用途
// (例: stub の前に楽天や JANCODE を挟む) を想定しているため。
export function createDefaultProviders(opts: CreateJanApiClientOptions = {}): JanProvider[] {
  const providers: JanProvider[] = []

  const yahooAppId = opts.yahooAppId ?? process.env["YAHOO_SHOPPING_APP_ID"]
  if (yahooAppId) {
    providers.push(createYahooProvider({ appId: yahooAppId }))
  }

  // 最終 stub。fixtures が空なら常に null を返すので副作用なく chain の末尾に置ける。
  providers.push(createStubProvider({ fixtures: opts.stubFixtures, name: "fallback-stub" }))

  return providers
}
