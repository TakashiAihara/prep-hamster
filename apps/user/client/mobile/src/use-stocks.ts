import type { ApiClient } from "@prep-hamster/api-client"
import { useCallback, useEffect, useState } from "react"
import { getApiClient } from "./api"
import { getCurrentGroupId } from "./config"
import { isEmptyQuantity, UNKNOWN_ITEM_NAME } from "./stock-detail"

// 在庫一覧 + アイテム / 場所マスタを並行取得して、画面表示用に join したデータを返す。
// react-query は依存追加を増やすので useState/useEffect の最小構成で。
// 規模が増えたら別途 issue で react-query 導入を検討。

export type StockListItem = {
  id: string
  itemName: string
  locationName: string
  quantity: number
  unit: string
  useByDate: string | null
  bestBeforeDate: string | null
}

type State =
  | { status: "loading" }
  | { status: "ok"; rows: StockListItem[] }
  | { status: "error"; message: string }

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
// hook 本体から切り出すことで描画なしの unit test で挙動を固定できる。
export function joinStocksWithMasters(
  stocks: StockRow[],
  items: { id: string; name: string }[],
  locations: { id: string; name: string }[],
): StockListItem[] {
  const itemMap = new Map(items.map((i) => [i.id, i.name]))
  const locMap = new Map(locations.map((l) => [l.id, l.name]))
  return stocks.map((s) => ({
    id: s.id,
    itemName: itemMap.get(s.itemId) ?? UNKNOWN_ITEM_NAME,
    locationName: locMap.get(s.locationId) ?? "(unknown location)",
    quantity: s.quantity,
    unit: s.unit,
    useByDate: s.useByDate,
    bestBeforeDate: s.bestBeforeDate,
  }))
}

// 残量 0 (消費 / 廃棄し切った在庫) は API が行を残すので、一覧では隠す。
export function visibleStocks(rows: StockListItem[]): StockListItem[] {
  return rows.filter((r) => !isEmptyQuantity(r.quantity))
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

// 期限切れも一覧に出す (期限切れの廃棄が詳細画面に届く唯一の経路のため)。
export async function loadStockRows(client: ApiClient, groupId: string): Promise<LoadRowsResult> {
  const [stocksRes, itemsRes, locationsRes] = await Promise.all([
    client.v1.stocks.$get({ query: { groupId, includeExpired: "true" } }),
    client.v1.items.$get({ query: { groupId } }),
    client.v1.locations.$get({ query: { groupId } }),
  ])
  if (!stocksRes.ok) return { ok: false, message: `stocks HTTP ${stocksRes.status}` }
  if (!itemsRes.ok) return { ok: false, message: `items HTTP ${itemsRes.status}` }
  if (!locationsRes.ok) return { ok: false, message: `locations HTTP ${locationsRes.status}` }

  const stocks = (await stocksRes.json()).stocks
  const items = (await itemsRes.json()).items
  const locations = (await locationsRes.json()).locations
  return { ok: true, rows: visibleStocks(joinStocksWithMasters(stocks, items, locations)) }
}

export function useStocks(): { state: State; reload: () => void } {
  const [state, setState] = useState<State>({ status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await loadStockRows(getApiClient(), getCurrentGroupId())
        if (cancelled) return
        setState(r.ok ? { status: "ok", rows: r.rows } : { status: "error", message: r.message })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "unknown"
        setState({ status: "error", message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return { state, reload }
}
