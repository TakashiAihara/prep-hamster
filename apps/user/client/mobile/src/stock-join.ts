export type StockListItem = {
  id: string
  itemName: string
  locationName: string
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

// items / locations を id → name の Map に畳み込み、stocks に画面表示用 join した行を作る。
// use-stocks.ts は current-group 経由で expo-router を読み込み bun test で動かないため、
// 描画なしの unit test で固定する純関数はここに置く。
export function joinStocksWithMasters(
  stocks: StockRow[],
  items: { id: string; name: string }[],
  locations: { id: string; name: string }[],
): StockListItem[] {
  const itemMap = new Map(items.map((i) => [i.id, i.name]))
  const locMap = new Map(locations.map((l) => [l.id, l.name]))
  return stocks.map((s) => ({
    id: s.id,
    itemName: itemMap.get(s.itemId) ?? "(unknown item)",
    locationName: locMap.get(s.locationId) ?? "(unknown location)",
    quantity: s.quantity,
    unit: s.unit,
    useByDate: s.useByDate,
    bestBeforeDate: s.bestBeforeDate,
  }))
}
