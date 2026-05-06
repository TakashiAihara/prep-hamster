// JAN コードから取得した商品メタデータ。
// `packages/db` の `productMasters` 行 schema から `id` を除いたサブセット相当。
// DB に persist する直前で `id` / timestamps を付与する。

export type ProductMasterSource =
  | "YAHOO_SHOPPING"
  | "RAKUTEN_ICHIBA"
  | "JANCODE_LOOKUP"
  | "GS1_JICFS"
  | "OTHER"

export type ProductMasterConfidence = "HIGH" | "MEDIUM" | "LOW"

export type ProductMasterCandidate = {
  jan: string
  name: string
  manufacturer: string | null
  brand: string | null
  contentAmount: number | null
  contentUnit: string | null
  categoryHint: string | null
  imageUrl: string | null
  source: ProductMasterSource
  // provider が返した生レスポンス。
  // DB の sourceRaw に丸ごと突っ込むことで後で別 provider の生データに切替える際の
  // 検証材料を残す。プロバイダ間で構造が違うので unknown のまま運ぶ。
  sourceRaw: unknown
  confidence: ProductMasterConfidence | null
}

// 各 provider が実装する I/F。null は「ヒットしなかった / 一時的に取得できなかった」。
// 例外は呼び出し側でハンドルする想定 (再試行 / フォールバック etc.) なので、
// レート制限等の transient エラーも null で返してフォールバックを促す。
export type JanProvider = {
  readonly name: string
  lookup(jan: string): Promise<ProductMasterCandidate | null>
}

// 上位 client の I/F。複数 provider を順に試し、最初の hit を返す。
export type JanApiClient = {
  lookup(jan: string): Promise<ProductMasterCandidate | null>
}
