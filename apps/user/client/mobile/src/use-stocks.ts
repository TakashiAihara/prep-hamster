import { useCallback, useEffect, useState } from "react"
import { getApiClient } from "./api"
import { getCurrentGroupId } from "./config"

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

export function useStocks(): { state: State; reload: () => void } {
  const [state, setState] = useState<State>({ status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const client = getApiClient()
        const groupId = getCurrentGroupId()
        const [stocksRes, itemsRes, locationsRes] = await Promise.all([
          client.v1.stocks.$get({ query: { groupId } }),
          client.v1.items.$get({ query: { groupId } }),
          client.v1.locations.$get({ query: { groupId } }),
        ])
        if (cancelled) return
        if (!stocksRes.ok) {
          setState({ status: "error", message: `stocks HTTP ${stocksRes.status}` })
          return
        }
        if (!itemsRes.ok) {
          setState({ status: "error", message: `items HTTP ${itemsRes.status}` })
          return
        }
        if (!locationsRes.ok) {
          setState({ status: "error", message: `locations HTTP ${locationsRes.status}` })
          return
        }

        const stocks = (await stocksRes.json()).stocks
        const items = (await itemsRes.json()).items
        const locations = (await locationsRes.json()).locations

        const itemMap = new Map(items.map((i) => [i.id, i.name]))
        const locMap = new Map(locations.map((l) => [l.id, l.name]))

        const rows: StockListItem[] = stocks.map((s) => ({
          id: s.id,
          itemName: itemMap.get(s.itemId) ?? "(unknown item)",
          locationName: locMap.get(s.locationId) ?? "(unknown location)",
          quantity: s.quantity,
          unit: s.unit,
          useByDate: s.useByDate,
          bestBeforeDate: s.bestBeforeDate,
        }))
        setState({ status: "ok", rows })
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
