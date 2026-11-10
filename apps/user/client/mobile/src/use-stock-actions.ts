import { useRef, useState } from "react"
import { randomUUID } from "expo-crypto"
import { getApiClient } from "./api"
import {
  createGuard,
  createStockActions,
  sharedPendingOps,
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
  // 廃棄の確認中に stock が差し替わるので、いま表示している残量は ref 経由で読む
  const latest = useRef(options.stock)
  latest.current = options.stock
  const actions = createStockActions({
    client: getApiClient(),
    guard,
    pending: sharedPendingOps,
    newEventId: randomUUID,
    currentQuantity: () => latest.current.quantity,
    setBusy,
    setMessage,
    ...options,
  })
  return { busy, message, ...actions }
}
