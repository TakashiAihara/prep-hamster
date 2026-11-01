import { useState } from "react"
import { getApiClient } from "./api"
import { useCurrentGroup } from "./current-group"

// POST /v1/items/by-barcode を叩く submit hook。
// scan / manual 両方の入口から同じ後続フロー (詳細画面 → 保存) に乗せる。

export type ByBarcodeResult = {
  itemId: string
  productLookup: "existing" | "hit" | "miss"
}

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string }

export function useByBarcode(): {
  state: State
  submit: (barcode: string) => Promise<ByBarcodeResult | null>
  reset: () => void
} {
  const [state, setState] = useState<State>({ status: "idle" })
  const groupId = useCurrentGroup().group?.id

  async function submit(barcode: string): Promise<ByBarcodeResult | null> {
    if (!groupId) {
      setState({ status: "error", message: "グループが選ばれていません" })
      return null
    }
    setState({ status: "loading" })
    try {
      const client = getApiClient()
      const res = await client.v1.items["by-barcode"].$post({
        json: { groupId, barcode },
      })
      if (!res.ok) {
        setState({ status: "error", message: `HTTP ${res.status}` })
        return null
      }
      const body = await res.json()
      setState({ status: "idle" })
      return { itemId: body.item.id, productLookup: body.productLookup }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown"
      setState({ status: "error", message })
      return null
    }
  }

  function reset() {
    setState({ status: "idle" })
  }

  return { state, submit, reset }
}
