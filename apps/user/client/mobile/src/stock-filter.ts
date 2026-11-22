import type { StockListItem } from "./stock-join"

// 在庫一覧 (M-04) の絞り込み・並べ替え。join 済みの行に対して端末側だけで行う
// (絞り込みや検索のたびに API を呼ばない)。描画なしの unit test で固定するため純関数に置く。

export type StockListFilter = {
  categoryId: string | null
  locationId: string | null
  // 品名の部分一致。前後の空白は無視し、英字の大小は区別しない
  query: string
}

export const EMPTY_STOCK_FILTER: StockListFilter = {
  categoryId: null,
  locationId: null,
  query: "",
}

export function filterStockRows(rows: StockListItem[], filter: StockListFilter): StockListItem[] {
  const query = filter.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filter.categoryId !== null && row.categoryId !== filter.categoryId) return false
    if (filter.locationId !== null && row.locationId !== filter.locationId) return false
    if (query !== "" && !row.itemName.toLowerCase().includes(query)) return false
    return true
  })
}

// Hermes には Array#toSorted (ES2023) が無い。unicorn/no-array-sort は toSorted を要求するが
// 実行環境が持たないので、コピーして sort するヘルパー 1 箇所に寄せる。
function sortedCopy<T>(rows: readonly T[], compare: (a: T, b: T) => number): T[] {
  // oxlint-disable-next-line unicorn/no-array-sort -- Hermes lacks Array#toSorted; the copy keeps the input untouched
  return [...rows].sort(compare)
}

// 行に出している期限 (useByDate 優先、無ければ bestBeforeDate) の昇順。期限なしは末尾。
// 同じ期限どうしは入力の順を保つ (sort は安定)。
export function sortStockRowsByExpiry(rows: StockListItem[]): StockListItem[] {
  return sortedCopy(rows, (a, b) => {
    const da = a.useByDate ?? a.bestBeforeDate
    const db = b.useByDate ?? b.bestBeforeDate
    if (da === db) return 0
    if (da === null) return 1
    if (db === null) return -1
    return da < db ? -1 : 1
  })
}

export type StockFilterOption = { id: string; name: string }

// 絞り込みに出す選択肢は、今ある行に出てくるものだけ (在庫 0 の場所・カテゴリを選んでも空になるだけ)。
// 並びは名前順。カテゴリ名が引けない行は選択肢に出さない (絞り込み側は categoryId で見る)。
export function stockFilterOptions(rows: StockListItem[]): {
  categories: StockFilterOption[]
  locations: StockFilterOption[]
} {
  const categories = new Map<string, string>()
  const locations = new Map<string, string>()
  for (const row of rows) {
    if (row.categoryId !== null && row.categoryName !== null) {
      categories.set(row.categoryId, row.categoryName)
    }
    locations.set(row.locationId, row.locationName)
  }
  const byName = (a: StockFilterOption, b: StockFilterOption) => a.name.localeCompare(b.name, "ja")
  return {
    categories: sortedCopy(
      [...categories].map(([id, name]) => ({ id, name })),
      byName,
    ),
    locations: sortedCopy(
      [...locations].map(([id, name]) => ({ id, name })),
      byName,
    ),
  }
}
