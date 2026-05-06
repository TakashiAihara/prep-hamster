import type { JanProvider, ProductMasterCandidate } from "../types"

// テスト・E2E・appid 未設定環境でのフォールバック用に固定値を返す provider。
// 引数の Map に登録された jan のみ hit させ、それ以外は null を返す。

export type StubProviderOptions = {
  fixtures?: Map<string, ProductMasterCandidate> | undefined
  name?: string | undefined
}

export function createStubProvider(opts: StubProviderOptions = {}): JanProvider {
  const fixtures = opts.fixtures ?? new Map<string, ProductMasterCandidate>()
  return {
    name: opts.name ?? "stub",
    async lookup(jan) {
      return fixtures.get(jan) ?? null
    },
  }
}
