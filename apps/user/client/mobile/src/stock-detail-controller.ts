import type { ApiClient } from "@prep-hamster/api-client"
import type { Alert } from "react-native"
import {
  buildEditPatch,
  consumeStock,
  discardStock,
  editStock,
  moveStock,
  parseAmount,
  formatQuantity,
  parseReason,
  shouldSuggestShopping,
  type ActionResult,
  type StockDetail,
  type StockDto,
} from "./stock-detail"

// 在庫詳細 (M-05) の画面ロジック: 読み込み状態の遷移と、消費 / 廃棄 / 移動 / 編集の実行。
// React に依存させず、描画なしの unit test で固定する。

export type LoadState =
  | { status: "loading" }
  | { status: "ok"; detail: StockDetail }
  | { status: "error"; message: string }

export type LoadEvent =
  | { type: "start"; id: string }
  | { type: "loaded"; detail: StockDetail }
  | { type: "failed"; message: string }
  | { type: "stock-changed"; stock: StockDto }

export function loadReducer(prev: LoadState, event: LoadEvent): LoadState {
  switch (event.type) {
    case "start":
      // 同じ在庫を開いたまま再取得する (focus / 再試行) 間は表示を残し、別の id なら読み込み中に戻す
      return prev.status === "ok" && prev.detail.stock.id === event.id
        ? prev
        : { status: "loading" }
    case "loaded":
      // 操作の前に出した読み込みが操作の結果より後に届くと古い在庫で上書きするので、
      // 表示中の在庫の方が新しければ stock だけ残して detail の残りは取り込む
      return prev.status === "ok" &&
        prev.detail.stock.id === event.detail.stock.id &&
        Date.parse(prev.detail.stock.updatedAt) > Date.parse(event.detail.stock.updatedAt)
        ? { status: "ok", detail: { ...event.detail, stock: prev.detail.stock } }
        : { status: "ok", detail: event.detail }
    case "failed":
      return { status: "error", message: event.message }
    case "stock-changed":
      return prev.status === "ok"
        ? { status: "ok", detail: { ...prev.detail, stock: event.stock } }
        : prev
  }
}

// current が前回のサーバ値のまま = ユーザーが未編集なら新しいサーバ値に追従させ、編集済みなら入力を残す
export function nextEditValue(
  current: string,
  prevServer: string | null,
  nextServer: string | null,
): string {
  return current === (prevServer ?? "") ? (nextServer ?? "") : current
}

export type Guard = { run: <T>(fn: () => Promise<T>) => Promise<T | undefined> }

// busy を React state で持つと、再描画前の 2 回目の tap が通って非冪等な POST が二重に飛ぶ。
// 同期的に立つ flag で弾く。
export function createGuard(): Guard {
  let inFlight = false
  return {
    async run(fn) {
      if (inFlight) return undefined
      inFlight = true
      try {
        return await fn()
      } finally {
        inFlight = false
      }
    },
  }
}

export type Nav = { canGoBack: () => boolean; back: () => void; replace: (href: "/") => void }

// 履歴が無い (deep link / 通知からの cold start) と back() は何も起きないので、一覧へ置き換える。
export function leaveDetail(nav: Nav): void {
  if (nav.canGoBack()) nav.back()
  else nav.replace("/")
}

export type ConfirmEnv = {
  os: string
  // react-native-web の Alert.alert は何もせず解決しないので、web は window.confirm を使う
  webConfirm: (message: string) => boolean
  alert: typeof Alert.alert
}

export function createConfirmDiscard(
  env: ConfirmEnv,
): (quantity: number, unit: string) => Promise<boolean> {
  return (quantity, unit) => {
    const title = "在庫を廃棄しますか？"
    const message = `${formatQuantity(quantity)} ${unit} を廃棄します。この操作は取り消せません。`
    if (env.os === "web") return Promise.resolve(env.webConfirm(`${title}\n${message}`))
    return new Promise((resolve) => {
      env.alert(
        title,
        message,
        [
          { text: "キャンセル", style: "cancel", onPress: () => resolve(false) },
          { text: "廃棄する", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      )
    })
  }
}

export type ActionMessage = { kind: "ok" | "error"; text: string }

export type StockActionDeps = {
  client: ApiClient
  stock: StockDto
  guard: Guard
  setBusy: (busy: boolean) => void
  setMessage: (message: ActionMessage | null) => void
  onStockChanged: (stock: StockDto) => void
  onMoved: () => void
  confirmDiscard: (quantity: number, unit: string) => Promise<boolean>
  leave: () => void
}

export function createStockActions(deps: StockActionDeps) {
  const { client, stock, guard } = deps
  const fail = (text: string) => deps.setMessage({ kind: "error", text })

  async function perform(
    okText: string,
    action: () => Promise<ActionResult>,
    leaveWhenRemaining = false,
  ): Promise<boolean> {
    deps.setBusy(true)
    deps.setMessage(null)
    try {
      const r = await action()
      if (!r.ok) {
        fail(r.message)
        return false
      }
      deps.onStockChanged(r.stock)
      // screen-flow 2.3.2: 残量があれば一覧へ戻り、0 なら留まって買い物リストの提案を見せる
      if (leaveWhenRemaining && !shouldSuggestShopping(r.stock.quantity)) {
        deps.leave()
        return true
      }
      deps.setMessage({ kind: "ok", text: okText })
      return true
    } finally {
      deps.setBusy(false)
    }
  }

  return {
    consume: (amountInput: string) =>
      guard.run(async () => {
        const qty = parseAmount(amountInput, stock.quantity)
        if (!qty.ok) return fail(qty.message)
        await perform("消費しました", () => consumeStock(client, stock.id, qty.value), true)
      }),

    discard: (amountInput: string, reasonInput: string) =>
      guard.run(async () => {
        const qty = parseAmount(amountInput, stock.quantity)
        if (!qty.ok) return fail(qty.message)
        const why = parseReason(reasonInput)
        if (!why.ok) return fail(why.message)
        // 廃棄は取り消せないので、入力が通ってから確認を挟む。確認中も二重起動を弾く
        deps.setBusy(true)
        let confirmed = false
        try {
          confirmed = await deps.confirmDiscard(qty.value, stock.unit)
        } finally {
          if (!confirmed) deps.setBusy(false)
        }
        if (!confirmed) return
        await perform(
          "廃棄しました",
          () => discardStock(client, stock.id, qty.value, why.value),
          true,
        )
      }),

    move: (targetId: string | null) =>
      guard.run(async () => {
        if (!targetId) return fail("移動先を選択してください")
        const moved = await perform("移動しました", () => moveStock(client, stock.id, targetId))
        if (moved) deps.onMoved()
      }),

    edit: (form: { useByDate: string; bestBeforeDate: string; note: string }) =>
      guard.run(async () => {
        const patch = buildEditPatch(stock, form)
        if (!patch.ok) return fail(patch.message)
        await perform("保存しました", () => editStock(client, stock.id, patch.value))
      }),
  }
}
