import { isValidJan } from "./jan"
import { createStubProvider } from "./providers/stub"
import { createYahooProvider } from "./providers/yahoo"
import type { JanApiClient, JanProvider, ProductMasterCandidate } from "./types"

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
  const providers = opts.providers ?? buildDefaultProviders(opts)

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

function buildDefaultProviders(opts: CreateJanApiClientOptions): JanProvider[] {
  const providers: JanProvider[] = []

  const yahooAppId = opts.yahooAppId ?? process.env["YAHOO_SHOPPING_APP_ID"]
  if (yahooAppId) {
    providers.push(createYahooProvider({ appId: yahooAppId }))
  }

  // 最終 stub。fixtures が空なら常に null を返すので副作用なく chain の末尾に置ける。
  providers.push(createStubProvider({ fixtures: opts.stubFixtures, name: "fallback-stub" }))

  return providers
}
