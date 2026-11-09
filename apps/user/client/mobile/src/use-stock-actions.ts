import { useState } from "react"
import { getApiClient } from "./api"
import {
  createGuard,
  createStockActions,
  type ActionMessage,
  type StockActionDeps,
} from "./stock-detail-controller"

type Options = Pick<
  StockActionDeps,
  "stock" | "onStockChanged" | "onMoved" | "confirmDiscard" | "leave"
>

// busy / message の state と、二重実行を弾く guard を持つ薄い hook。判定は stock-detail-controller 側。
export function useStockActions(options: Options) {
  const [guard] = useState(createGuard)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<ActionMessage | null>(null)
  const actions = createStockActions({
    client: getApiClient(),
    guard,
    setBusy,
    setMessage,
    ...options,
  })
  return { busy, message, ...actions }
}
