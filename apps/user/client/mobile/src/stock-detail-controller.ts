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

// 結果が不明な操作の eventId を操作内容ごとに保ち、同じ内容の押し直しで使い回す
export type PendingEntry = {
  eventId: string
  stockId: string
  baseQuantity: number
  inFlight: number
  uncertain: boolean
}
export type PendingOps = Map<string, PendingEntry>

export type StockActionDeps = {
  client: ApiClient
  stock: StockDto
  guard: Guard
  pending: PendingOps
  newEventId: () => string
  currentQuantity: () => number
  setBusy: (busy: boolean) => void
  setMessage: (message: ActionMessage | null) => void
  onStockChanged: (stock: StockDto) => void
  onMoved: () => void
  confirmDiscard: (quantity: number, unit: string) => Promise<boolean>
  leave: () => void
}

// 詳細画面を閉じて開き直しても eventId を引き継ぐため画面の外に置く。メモリだけなので再起動で消える
export const sharedPendingOps: PendingOps = new Map()

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

  // consume / discard は結果が不明な失敗のとき、同じ eventId で
  // 再送してサーバ側の冪等化に任せる。同じ内容の操作なら eventId を使い回す。
  async function runDelta(
    kind: "consume" | "discard",
    quantity: number,
    reason: string | null,
    send: (eventId: string) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    const key = JSON.stringify([kind, stock.id, quantity, reason, stock.quantity])
    // 残量が変わった記録はもう一致しない。残すと残量が元に戻ったとき古い eventId を
    // 再生してしまうので、送信中のものを除いて消す
    for (const [k, e] of deps.pending) {
      if (e.stockId === stock.id && e.baseQuantity !== stock.quantity && e.inFlight === 0) {
        deps.pending.delete(k)
      }
    }
    let entry = deps.pending.get(key)
    if (entry === undefined) {
      entry = {
        eventId: deps.newEventId(),
        stockId: stock.id,
        baseQuantity: stock.quantity,
        inFlight: 0,
        uncertain: false,
      }
      deps.pending.set(key, entry)
    }
    entry.inFlight += 1
    const r = await send(entry.eventId)
    entry.inFlight -= 1
    // 成功ならサーバに記録済み。結果不明のあとの確定失敗でも先の送信が
    // 適用されうるので、uncertain は下げない
    if (r.ok) entry.uncertain = false
    else if (r.uncertain) entry.uncertain = true
    // 別の画面がまだ送っている間は eventId を残す。全部の送信が終わって確定したときだけ消す
    if (entry.inFlight === 0 && !entry.uncertain) deps.pending.delete(key)
    if (!r.ok && r.uncertain) {
      // 結果が不明なので押し直してよいことを伝える。取り直しで残量が変わった後は新しい操作になるので、条件を添える
      return {
        ...r,
        message: `${r.message} (アプリを閉じず、残量の表示が変わっていなければ、同じ内容でもう一度押しても二重には記録されません)`,
      }
    }
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
        // 確認中に残量が変わっていたら、確認した内容と違う廃棄を送ることになるので止める
        if (deps.currentQuantity() !== stock.quantity) {
          fail("確認中に残量が変わりました。表示を確かめてから、もう一度押してください")
          deps.setBusy(false)
          return
        }
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
