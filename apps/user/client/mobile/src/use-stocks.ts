import { useCallback, useEffect, useRef, useState } from "react"
import { getApiClient } from "./api"
import { useCurrentGroup } from "./current-group"
import { joinStocksWithMasters, type StockListItem } from "./stock-join"

export type { StockListItem }

// 在庫一覧 + アイテム / 場所マスタを並行取得して、画面表示用に join したデータを返す。
// react-query は依存追加を増やすので useState/useEffect の最小構成で。
// 規模が増えたら別途 issue で react-query 導入を検討。

type State =
  | { status: "loading" }
  | { status: "ok"; rows: StockListItem[] }
  | { status: "error"; message: string }

export function useStocks(): { state: State; reload: () => void } {
  const [state, setState] = useState<State>({ status: "loading" })
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])
  const groupId = useCurrentGroup().group?.id
  const loadedGroupId = useRef(groupId)

  useEffect(() => {
    if (!groupId) return
    // 前のグループの行を見せたままにしない。同じグループの reload では spinner を出さない
    if (loadedGroupId.current !== groupId) {
      loadedGroupId.current = groupId
      setState({ status: "loading" })
    }
    let cancelled = false
    void (async () => {
      try {
        const client = getApiClient()
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
        // 本文を読む間にグループが変わっていたら、前のグループの行で上書きしない
        if (cancelled) return
        setState({ status: "ok", rows: joinStocksWithMasters(stocks, items, locations) })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "unknown"
        setState({ status: "error", message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey, groupId])

  return { state, reload }
}
