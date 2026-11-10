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
  | { type: "loaded"; detail: StockDetail; keepStock?: boolean }
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
      // keepStock は「読み込み中に操作結果が届いた」の印。detail は操作前の在庫を
      // 持ちうるので、同じ在庫を表示中なら stock だけ表示中のものを残す
      return event.keepStock === true &&
        prev.status === "ok" &&
        prev.detail.stock.id === event.detail.stock.id
        ? { status: "ok", detail: { ...event.detail, stock: prev.detail.stock } }
        : { status: "ok", detail: event.detail }
    case "failed":
      return { status: "error", message: event.message }
    case "stock-changed":
      // 前の在庫の操作結果が遅れて届いても、表示中の別の在庫を上書きしない
      return prev.status === "ok" && prev.detail.stock.id === event.stock.id
        ? { status: "ok", detail: { ...prev.detail, stock: event.stock } }
        : prev
  }
}

// current が前回のサーバ値のまま = ユーザーが未編集なら新しいサーバ値に追従させ、編集済みなら入力を残す。
// 保存時に値は trim されるので、前後の空白だけが違う入力も未編集として扱う
export function nextEditValue(
  current: string,
  prevServer: string | null,
  nextServer: string | null,
): string {
  return current.trim() === (prevServer ?? "").trim() ? (nextServer ?? "") : current
}

export type EditFields = { useBy: string; bestBefore: string; note: string }

// stock が差し替わったとき、編集フォームの各項目をそれぞれのサーバ値で同期する
export function syncEditFields(fields: EditFields, prev: StockDto, next: StockDto): EditFields {
  return {
    useBy: nextEditValue(fields.useBy, prev.useByDate, next.useByDate),
    bestBefore: nextEditValue(fields.bestBefore, prev.bestBeforeDate, next.bestBeforeDate),
    note: nextEditValue(fields.note, prev.note, next.note),
  }
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

export type PendingOp = {
  kind: "consume" | "discard"
  stockId: string
  quantity: number
  reason: string | null
  eventId: string
  baseQuantity: number
}

export type PendingOpRef = { current: PendingOp | null }

export type StockActionDeps = {
  client: ApiClient
  stock: StockDto
  guard: Guard
  pending: PendingOpRef
  newEventId: () => string
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

  // consume / discard は結果が不明な失敗 (通信断 / 5xx) のとき、同じ eventId で
  // 再送してサーバ側の冪等化に任せる。同じ内容の操作なら eventId を使い回す。
  async function runDelta(
    kind: PendingOp["kind"],
    quantity: number,
    reason: string | null,
    send: (eventId: string) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    const pending = deps.pending.current
    const eventId =
      pending !== null &&
      pending.kind === kind &&
      pending.stockId === stock.id &&
      pending.quantity === quantity &&
      pending.reason === reason &&
      pending.baseQuantity === stock.quantity
        ? pending.eventId
        : deps.newEventId()
    deps.pending.current = {
      kind,
      stockId: stock.id,
      quantity,
      reason,
      eventId,
      baseQuantity: stock.quantity,
    }
    const r = await send(eventId)
    if (!r.ok && r.uncertain) {
      // 結果が不明なので、同じ数量で押し直しても二重記録されないことを伝える
      return { ...r, message: `${r.message} (同じ数量でもう一度押しても二重には記録されません)` }
    }
    deps.pending.current = null
    return r
  }

  return {
    consume: (amountInput: string) =>
      guard.run(async () => {
        const qty = parseAmount(amountInput, stock.quantity)
        if (!qty.ok) return fail(qty.message)
        await perform(
          "消費しました",
          () =>
            runDelta("consume", qty.value, null, (eventId) =>
              consumeStock(client, stock.id, qty.value, eventId),
            ),
          true,
        )
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
          () =>
            runDelta("discard", qty.value, why.value, (eventId) =>
              discardStock(client, stock.id, qty.value, why.value, eventId),
            ),
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
