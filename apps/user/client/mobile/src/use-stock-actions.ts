import { useLayoutEffect, useRef, useState } from "react"
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
  // ネイティブでは廃棄の確認 Alert を開いている間に再取得で stock が差し替わりうる。
  // いま表示している残量は ref 経由で読む (render 中の ref 書き換えは禁止なので effect で更新する)
  const latest = useRef(options.stock)
  useLayoutEffect(() => {
    latest.current = options.stock
  })
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
