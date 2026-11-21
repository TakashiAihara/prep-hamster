import type { ApiClient } from "@prep-hamster/api-client"
import { UNKNOWN_ITEM_NAME, UNKNOWN_LOCATION_NAME } from "./stock-detail"

export type StockListItem = {
  id: string
  itemName: string
  locationId: string
  locationName: string
  categoryId: string | null
  // categoryId が null、または category マスタが引けないとき null
  categoryName: string | null
  quantity: number
  unit: string
  useByDate: string | null
  bestBeforeDate: string | null
}

type StockRow = {
  id: string
  itemId: string
  locationId: string
  quantity: number
  unit: string
  useByDate: string | null
  bestBeforeDate: string | null
}

// items / locations / categories を id → name の Map に畳み込み、stocks に画面表示用 join した行を作る。
// use-stocks.ts は current-group 経由で expo-router を読み込み bun test で動かないため、
// 描画なしの unit test で固定する純関数はここに置く。
export function joinStocksWithMasters(
  stocks: StockRow[],
  items: { id: string; name: string; categoryId: string | null }[],
  locations: { id: string; name: string }[],
  categories: { id: string; name: string }[],
): StockListItem[] {
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const locMap = new Map(locations.map((l) => [l.id, l.name]))
  const catMap = new Map(categories.map((c) => [c.id, c.name]))
  return stocks.map((s) => {
    const item = itemMap.get(s.itemId)
    const categoryId = item?.categoryId ?? null
    return {
      id: s.id,
      itemName: item?.name ?? UNKNOWN_ITEM_NAME,
      locationId: s.locationId,
      locationName: locMap.get(s.locationId) ?? UNKNOWN_LOCATION_NAME,
      categoryId,
      categoryName: categoryId === null ? null : (catMap.get(categoryId) ?? null),
      quantity: s.quantity,
      unit: s.unit,
      useByDate: s.useByDate,
      bestBeforeDate: s.bestBeforeDate,
    }
  })
}

// API の一覧が includeExpired なしで除外するのと同じ基準: 期限日が today 以前なら期限切れ。
// today は API と同じ UTC の YYYY-MM-DD。
export function isExpired(
  row: { useByDate: string | null; bestBeforeDate: string | null },
  today: string,
): boolean {
  return (
    (row.useByDate !== null && row.useByDate <= today) ||
    (row.bestBeforeDate !== null && row.bestBeforeDate <= today)
  )
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export type LoadRowsResult = { ok: true; rows: StockListItem[] } | { ok: false; message: string }

// 期限切れも一覧に出す (一覧から詳細を開いて期限切れを廃棄できるように)。
export async function loadStockRows(client: ApiClient, groupId: string): Promise<LoadRowsResult> {
  const [stocksRes, itemsRes, locationsRes, categoriesRes] = await Promise.all([
    client.v1.stocks.$get({ query: { groupId, includeExpired: "true" } }),
    client.v1.items.$get({ query: { groupId } }),
    client.v1.locations.$get({ query: { groupId } }),
    client.v1.categories.$get({ query: { groupId } }),
  ])
  if (!stocksRes.ok) return { ok: false, message: `stocks HTTP ${stocksRes.status}` }
  if (!itemsRes.ok) return { ok: false, message: `items HTTP ${itemsRes.status}` }
  if (!locationsRes.ok) return { ok: false, message: `locations HTTP ${locationsRes.status}` }
  if (!categoriesRes.ok) return { ok: false, message: `categories HTTP ${categoriesRes.status}` }

  const stocks = (await stocksRes.json()).stocks
  const items = (await itemsRes.json()).items
  const locations = (await locationsRes.json()).locations
  const categories = (await categoriesRes.json()).categories
  return { ok: true, rows: joinStocksWithMasters(stocks, items, locations, categories) }
}
