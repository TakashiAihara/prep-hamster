import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import {
  createConfirmDiscard,
  createGuard,
  createStockActions,
  leaveDetail,
  loadReducer,
  nextEditValue,
  syncEditFields,
  type ActionMessage,
  type PendingOpRef,
  type LoadState,
} from "../stock-detail-controller"
import type { StockDetail, StockDto } from "../stock-detail"

const STOCK_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ID = "66666666-6666-4666-8666-666666666666"
const LOC_A = "22222222-2222-4222-8222-222222222222"
const LOC_B = "33333333-3333-4333-8333-333333333333"

const stock = (over: Partial<StockDto> = {}): StockDto => ({
  id: STOCK_ID,
  groupId: "g",
  itemId: "i",
  locationId: LOC_A,
  quantity: 5,
  unit: "個",
  useByDate: null,
  bestBeforeDate: null,
  note: null,
  ...over,
})

const detail = (s: StockDto): StockDetail => ({ stock: s, itemName: "Tomato", locations: [] })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

// 応答は既定で quantity 4 の stock を返す (opts.result で差し替える)。
function harness(
  opts: {
    result?: () => Response
    confirm?: boolean
    pending?: PendingOpRef
    newEventId?: () => string
    stock?: StockDto
  } = {},
) {
  const pending: PendingOpRef = opts.pending ?? { current: null }
  const posts: string[] = []
  const sent: unknown[] = []
  const events: string[] = []
  const messages: Array<ActionMessage | null> = []
  const busy: boolean[] = []
  const busyDuringConfirm: Array<boolean | undefined> = []
  const confirmArgs: Array<[number, string]> = []
  const changed: StockDto[] = []
  const respond = (name: string) => async (args?: { json?: unknown }) => {
    posts.push(name)
    sent.push(args?.json)
    // 非同期に待たせ、二重 tap が同じ tick で来る状況を作る
    await new Promise((r) => setTimeout(r, 5))
    return opts.result?.() ?? json({ stock: stock({ quantity: 4 }), event: {} })
  }
  const client = {
    v1: {
      stocks: {
        ":id": {
          $patch: respond("patch"),
          consume: { $post: respond("consume") },
          discard: { $post: respond("discard") },
          move: { $post: respond("move") },
        },
      },
    },
  } as unknown as ApiClient
  const actions = createStockActions({
    client,
    stock: opts.stock ?? stock(),
    guard: createGuard(),
    setBusy: (b) => busy.push(b),
    setMessage: (m) => messages.push(m),
    onStockChanged: (s) => changed.push(s),
    onMoved: () => events.push("moved"),
    confirmDiscard: async (quantity, unit) => {
      events.push("confirm")
      confirmArgs.push([quantity, unit])
      busyDuringConfirm.push(busy.at(-1))
      return opts.confirm ?? true
    },
    leave: () => events.push("leave"),
    pending,
    newEventId: opts.newEventId ?? idSource(),
  })
  return {
    actions,
    posts,
    sent,
    events,
    messages,
    busy,
    busyDuringConfirm,
    changed,
    confirmArgs,
    pending,
  }
}

const lastMessage = (h: ReturnType<typeof harness>) => h.messages.at(-1)

// 1 つのテストの中で画面を作り直しても番号が続くよう、採番は harness の外で持つ
function idSource() {
  let n = 0
  return () => `event-${++n}`
}

test("createGuard runs one call at a time and releases after it settles, even on throw", async () => {
  const guard = createGuard()
  const first = guard.run(async () => {
    await new Promise((r) => setTimeout(r, 5))
    return "first"
  })
  expect(await guard.run(async () => "second")).toBeUndefined()
  expect(await first).toBe("first")
  expect(await guard.run(async () => "third")).toBe("third")
  await guard
    .run(async () => {
      throw new Error("boom")
    })
    .catch(() => {})
  expect(await guard.run(async () => "after throw")).toBe("after throw")
})

test("double-tapping consume posts once", async () => {
  const h = harness()
  await Promise.all([h.actions.consume("1"), h.actions.consume("1")])
  expect(h.posts).toEqual(["consume"])
})

test("double-tapping discard posts once and asks for confirmation once", async () => {
  const h = harness()
  await Promise.all([h.actions.discard("1", ""), h.actions.discard("1", "")])
  expect(h.posts).toEqual(["discard"])
  expect(h.events.filter((e) => e === "confirm")).toHaveLength(1)
})

test("discard does not call the API when the confirmation is declined", async () => {
  const h = harness({ confirm: false })
  await h.actions.discard("1", "期限切れ")
  expect(h.events).toEqual(["confirm"])
  expect(h.posts).toEqual([])
})

test("discard validates input before asking for confirmation", async () => {
  const h = harness()
  await h.actions.discard("99", "")
  expect(h.events).toEqual([])
  expect(lastMessage(h)).toEqual({ kind: "error", text: "残量 5 を超えています" })
  await h.actions.discard("1", "a".repeat(501))
  expect(h.events).toEqual([])
  expect(lastMessage(h)?.kind).toBe("error")
})

test("discard forwards the typed reason, and null when blank", async () => {
  const h = harness()
  await h.actions.discard("1", "期限切れ")
  await h.actions.discard("1", "")
  expect(h.sent).toEqual([
    { quantityDelta: 1, reason: "期限切れ", eventId: "event-1" },
    { quantityDelta: 1, eventId: "event-2" },
  ])
})

test("discard that leaves stock goes back to the list", async () => {
  const h = harness()
  await h.actions.discard("1", "")
  expect(h.events).toEqual(["confirm", "leave"])
})

test("busy is set while the discard confirmation is open and released when declined", async () => {
  const h = harness({ confirm: false })
  await h.actions.discard("1", "")
  expect(h.busyDuringConfirm).toEqual([true])
  expect(h.busy).toEqual([true, false])
})

test.each([
  [false, ["consume"]],
  [true, ["discard", "consume"]],
])("the guard is released after the confirmation resolves %p", async (confirm, expected) => {
  const h = harness({ confirm })
  await h.actions.discard("1", "")
  await h.actions.consume("1")
  expect(h.posts).toEqual(expected)
})

test("leaveDetail goes back when it can and replaces to the list otherwise", () => {
  const calls: string[] = []
  const nav = (can: boolean) => ({
    canGoBack: () => can,
    back: () => calls.push("back"),
    replace: (href: string) => calls.push(`replace ${href}`),
  })
  leaveDetail(nav(true))
  leaveDetail(nav(false))
  expect(calls).toEqual(["back", "replace /"])
})

test.each([true, false])(
  "createConfirmDiscard on web returns window.confirm = %p and never Alert",
  async (answer) => {
    const seen: string[] = []
    const confirm = createConfirmDiscard({
      os: "web",
      webConfirm: (m) => (seen.push(m), answer),
      alert: () => seen.push("alert"),
    })
    expect(await confirm(2, "パック")).toBe(answer)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain("2 パック を廃棄します")
    expect(seen[0]).toContain("取り消せません")
  },
)

type AlertPick = (
  buttons: Array<{ text?: string; onPress?: () => void }>,
  options: { onDismiss?: () => void },
) => void

const nativeConfirm = (pick: AlertPick) =>
  createConfirmDiscard({
    os: "android",
    webConfirm: () => {
      throw new Error("web confirm on native")
    },
    alert: ((_t: string, _m: string, b: never, o: never) => pick(b, o)) as never,
  })(1, "個")

test("createConfirmDiscard resolves from the Alert buttons and dismissal on native", async () => {
  expect(await nativeConfirm((b) => b.find((x) => x.text === "廃棄する")?.onPress?.())).toBe(true)
  expect(await nativeConfirm((b) => b.find((x) => x.text === "キャンセル")?.onPress?.())).toBe(
    false,
  )
  expect(await nativeConfirm((_b, o) => o.onDismiss?.())).toBe(false)
})

test("consume that leaves stock goes back to the list without a success message", async () => {
  const h = harness()
  await h.actions.consume("1")
  expect(h.events).toEqual(["leave"])
  expect(h.changed.map((s) => s.quantity)).toEqual([4])
  expect(h.messages.some((m) => m?.kind === "ok")).toBe(false)
})

const emptiedResult = () => json({ stock: stock({ quantity: 0 }), event: {} })

test("consume or discard that empties the stock stays and reports success", async () => {
  const c = harness({ result: emptiedResult })
  await c.actions.consume("5")
  expect(c.events).toEqual([])
  expect(lastMessage(c)).toEqual({ kind: "ok", text: "消費しました" })

  const d = harness({ result: emptiedResult })
  await d.actions.discard("5", "")
  expect(d.events).toEqual(["confirm"])
  expect(d.confirmArgs).toEqual([[5, "個"]])
  expect(lastMessage(d)).toEqual({ kind: "ok", text: "廃棄しました" })
})

test("a float residue after consuming is treated as empty and stays on the screen", async () => {
  const h = harness({ result: () => json({ stock: stock({ quantity: 1 - 0.7 - 0.3 }) }) })
  await h.actions.consume("5")
  expect(h.events).toEqual([])
})

test("a failed action shows the error, does not leave, and releases busy", async () => {
  const h = harness({
    result: () => json({ error: { code: "X", message: "在庫が足りません" } }, 422),
  })
  await h.actions.consume("1")
  expect(lastMessage(h)).toEqual({ kind: "error", text: "在庫が足りません" })
  expect(h.events).toEqual([])
  expect(h.changed).toEqual([])
  expect(h.busy).toEqual([true, false])
  await h.actions.consume("1")
  expect(h.posts).toEqual(["consume", "consume"])
})

test("move requires a target, then clears the selection and stays on the screen", async () => {
  const h = harness({ result: () => json({ stock: stock({ locationId: LOC_B }) }) })
  await h.actions.move(null)
  expect(h.posts).toEqual([])
  expect(lastMessage(h)).toEqual({ kind: "error", text: "移動先を選択してください" })

  await h.actions.move(LOC_B)
  expect(h.posts).toEqual(["move"])
  expect(h.events).toEqual(["moved"])
  expect(h.changed[0]?.locationId).toBe(LOC_B)
  // 前の結果表示は実行開始時に消える
  expect(h.messages.at(-2)).toBeNull()
  expect(lastMessage(h)).toEqual({ kind: "ok", text: "移動しました" })
})

test("a failed move keeps the selected target", async () => {
  const h = harness({ result: () => json({ error: { message: "同じ場所です" } }, 422) })
  await h.actions.move(LOC_B)
  expect(h.events).toEqual([])
})

test("edit sends only the changed fields and reports no change locally", async () => {
  const h = harness({ result: () => json({ stock: stock({ note: "n" }) }) })
  await h.actions.edit({ useByDate: "", bestBeforeDate: "", note: "" })
  expect(h.posts).toEqual([])
  expect(lastMessage(h)).toEqual({ kind: "error", text: "変更がありません" })
  await h.actions.edit({ useByDate: "", bestBeforeDate: "", note: "n" })
  expect(h.posts).toEqual(["patch"])
  expect(lastMessage(h)).toEqual({ kind: "ok", text: "保存しました" })
})

test("loadReducer keeps the shown stock for a refetch of the same id and resets for another id", () => {
  const ok: LoadState = { status: "ok", detail: detail(stock()) }
  expect(loadReducer(ok, { type: "start", id: STOCK_ID })).toBe(ok)
  expect(loadReducer(ok, { type: "start", id: OTHER_ID })).toEqual({ status: "loading" })
  expect(loadReducer({ status: "error", message: "x" }, { type: "start", id: STOCK_ID })).toEqual({
    status: "loading",
  })
})

test("loadReducer replaces the stock on change only while loaded", () => {
  const next = stock({ quantity: 1 })
  const ok: LoadState = { status: "ok", detail: detail(stock()) }
  expect(loadReducer(ok, { type: "stock-changed", stock: next })).toEqual({
    status: "ok",
    detail: detail(next),
  })
  const loading: LoadState = { status: "loading" }
  expect(loadReducer(loading, { type: "stock-changed", stock: next })).toBe(loading)
})

test("loadReducer maps loaded and failed events", () => {
  expect(loadReducer({ status: "loading" }, { type: "loaded", detail: detail(stock()) })).toEqual({
    status: "ok",
    detail: detail(stock()),
  })
  expect(loadReducer({ status: "loading" }, { type: "failed", message: "HTTP 500" })).toEqual({
    status: "error",
    message: "HTTP 500",
  })
})

test("loadReducer keeps the shown stock when an action finished after the refetch started", () => {
  const shown = stock({ quantity: 2 })
  const ok: LoadState = { status: "ok", detail: detail(shown) }
  const stale = { ...detail(stock({ quantity: 5 })), itemName: "Tomato (renamed)" }
  expect(loadReducer(ok, { type: "loaded", detail: stale, keepStock: true })).toEqual({
    status: "ok",
    detail: { ...stale, stock: shown },
  })
})

test("loadReducer takes the refetched stock when no action finished during the refetch", () => {
  const ok: LoadState = { status: "ok", detail: detail(stock({ quantity: 2 })) }
  const fresh = detail(stock({ quantity: 4 }))
  expect(loadReducer(ok, { type: "loaded", detail: fresh, keepStock: false })).toEqual({
    status: "ok",
    detail: fresh,
  })
  expect(loadReducer(ok, { type: "loaded", detail: fresh })).toEqual({
    status: "ok",
    detail: fresh,
  })
})

test("loadReducer takes the loaded detail of another stock even when keepStock is set", () => {
  const ok: LoadState = { status: "ok", detail: detail(stock()) }
  const other = detail(stock({ id: OTHER_ID, quantity: 9 }))
  expect(loadReducer(ok, { type: "loaded", detail: other, keepStock: true })).toEqual({
    status: "ok",
    detail: other,
  })
  const loading: LoadState = { status: "loading" }
  expect(loadReducer(loading, { type: "loaded", detail: other, keepStock: true })).toEqual({
    status: "ok",
    detail: other,
  })
})

test("loadReducer ignores an action result for another stock", () => {
  const ok: LoadState = { status: "ok", detail: detail(stock()) }
  expect(loadReducer(ok, { type: "stock-changed", stock: stock({ id: OTHER_ID }) })).toBe(ok)
})

test("nextEditValue follows the server value only while the field is unedited", () => {
  expect(nextEditValue("2026-12-01", "2026-12-01", "2026-12-24")).toBe("2026-12-24")
  expect(nextEditValue("2026-12-05", "2026-12-01", "2026-12-24")).toBe("2026-12-05")
  expect(nextEditValue("", null, "memo")).toBe("memo")
  expect(nextEditValue("memo", "memo", null)).toBe("")
  expect(nextEditValue("", "memo", "other")).toBe("")
  expect(nextEditValue("typed", null, "other")).toBe("typed")
})

test("nextEditValue treats a value that only differs by surrounding spaces as unedited", () => {
  // 保存は前後の空白を落とすので、"memo " を保存した後の欄は未編集のまま
  expect(nextEditValue("memo ", "memo", "X")).toBe("X")
  expect(nextEditValue(" memo", "memo", "X")).toBe("X")
  // 他の経路 (CLI) で空白付きのまま保存された値と、空白を落として出した欄も同じ値とみなす
  expect(nextEditValue("memo", "memo ", "X")).toBe("X")
})

test("syncEditFields updates each unedited field from its own server value", () => {
  const prev = stock({ useByDate: "2026-12-01", bestBeforeDate: "2026-12-10", note: "a" })
  const next = stock({ useByDate: "2026-12-02", bestBeforeDate: "2026-12-11", note: "b" })
  expect(
    syncEditFields({ useBy: "2026-12-01", bestBefore: "2026-12-10", note: "a" }, prev, next),
  ).toEqual({ useBy: "2026-12-02", bestBefore: "2026-12-11", note: "b" })
  expect(
    syncEditFields({ useBy: "2026-12-05", bestBefore: "2026-12-10", note: "typed" }, prev, next),
  ).toEqual({ useBy: "2026-12-05", bestBefore: "2026-12-11", note: "typed" })
})

const sentEventIds = (h: ReturnType<typeof harness>) =>
  h.sent.map((s) => (s as { eventId?: string } | undefined)?.eventId)

const networkError = () => {
  throw new Error("Network request failed")
}

// 1 回目の画面 (failing) と、作り直した 2 回目の画面 (next) で pending と採番を共有する
function twoScreens(first: { result?: () => Response }) {
  const pending: PendingOpRef = { current: null }
  const newEventId = idSource()
  const failing = harness({ ...first, pending, newEventId })
  const next = harness({ pending, newEventId })
  return { pending, failing, next }
}

test("each consume sends a fresh eventId after a success", async () => {
  const h = harness()
  await h.actions.consume("1")
  await h.actions.consume("1")
  expect(sentEventIds(h)).toEqual(["event-1", "event-2"])
  expect(h.pending.current).toBeNull()
})

test("a consume whose result is unknown is resent with the same eventId", async () => {
  const { pending, failing, next } = twoScreens({ result: networkError })
  await failing.actions.consume("2")
  expect(pending.current).not.toBeNull()
  await next.actions.consume("2")
  expect(sentEventIds(failing)).toEqual(["event-1"])
  expect(sentEventIds(next)).toEqual(["event-1"])
  expect(pending.current).toBeNull()
})

test("a 5xx response also keeps the eventId for the same consume", async () => {
  const { failing, next } = twoScreens({
    result: () => new Response("bad gateway", { status: 502 }),
  })
  await failing.actions.consume("2")
  await next.actions.consume("2")
  expect(sentEventIds(next)).toEqual(["event-1"])
})

test("a different amount after an unknown result gets a new eventId", async () => {
  const { pending, failing, next } = twoScreens({ result: networkError })
  await failing.actions.consume("2")
  await next.actions.consume("1")
  expect(sentEventIds(next)).toEqual(["event-2"])
  expect(pending.current).toBeNull()
})

test("a definite API failure does not keep the eventId", async () => {
  const { pending, failing, next } = twoScreens({
    result: () => json({ error: { code: "INSUFFICIENT_QUANTITY", message: "足りません" } }, 422),
  })
  await failing.actions.consume("2")
  expect(pending.current).toBeNull()
  await next.actions.consume("2")
  expect(sentEventIds(failing)).toEqual(["event-1"])
  expect(sentEventIds(next)).toEqual(["event-2"])
})

test("a discard with the same amount and reason reuses the eventId after an unknown result", async () => {
  const { failing, next } = twoScreens({ result: networkError })
  await failing.actions.discard("1", "期限切れ")
  await next.actions.discard("1", "期限切れ")
  expect(sentEventIds(failing)).toEqual(["event-1"])
  expect(sentEventIds(next)).toEqual(["event-1"])
})

test("a discard after an unknown consume of the same amount gets a new eventId", async () => {
  const { pending, failing, next } = twoScreens({ result: networkError })
  await failing.actions.consume("1")
  await next.actions.discard("1", "")
  expect(sentEventIds(failing)).toEqual(["event-1"])
  expect(sentEventIds(next)).toEqual(["event-2"])
  expect(pending.current).toBeNull()
})

test("a discard with a different reason after an unknown result gets a new eventId", async () => {
  const { pending, failing, next } = twoScreens({ result: networkError })
  await failing.actions.discard("1", "期限切れ")
  await next.actions.discard("1", "傷んだ")
  expect(sentEventIds(next)).toEqual(["event-2"])
  expect(pending.current).toBeNull()
})

test("the same consume on another stock after an unknown result gets a new eventId", async () => {
  const pending: PendingOpRef = { current: null }
  const newEventId = idSource()
  const failing = harness({ result: networkError, pending, newEventId })
  await failing.actions.consume("1")
  const other = harness({ pending, newEventId, stock: stock({ id: OTHER_ID }) })
  await other.actions.consume("1")
  expect(sentEventIds(other)).toEqual(["event-2"])
})

test("an unknown result tells the user that pressing again with the same amount is safe", async () => {
  const h = harness({ result: networkError })
  await h.actions.consume("1")
  expect(lastMessage(h)).toEqual({
    kind: "error",
    text: "Network request failed (残量の表示が変わっていなければ、同じ数量でもう一度押しても二重には記録されません)",
  })
})

test("a definite failure shows the API message as is", async () => {
  const h = harness({
    result: () => json({ error: { code: "INSUFFICIENT_QUANTITY", message: "足りません" } }, 422),
  })
  await h.actions.consume("1")
  expect(lastMessage(h)).toEqual({ kind: "error", text: "足りません" })
})

test("the pending operation is recorded before the request is sent", async () => {
  const pending: PendingOpRef = { current: null }
  let seenWhileSending: PendingOpRef["current"] = null
  const h = harness({
    pending,
    result: () => {
      seenWhileSending = pending.current
      return json({ stock: stock({ quantity: 4 }), event: {} })
    },
  })
  await h.actions.consume("1")
  expect(seenWhileSending).toMatchObject({ kind: "consume", quantity: 1, eventId: "event-1" })
})

test("after the screen shows a changed quantity, the same consume gets a new eventId", async () => {
  // 結果が不明な消費の後に、取り直しで残量が 5 から 3 に変わった = 前の消費は通っていた。
  // 同じ数量をもう一度押すのは新しい消費なので、古い eventId を使い回さない
  const pending: PendingOpRef = { current: null }
  const newEventId = idSource()
  const failing = harness({
    result: networkError,
    pending,
    newEventId,
    stock: stock({ quantity: 5 }),
  })
  await failing.actions.consume("2")
  const refreshed = harness({ pending, newEventId, stock: stock({ quantity: 3 }) })
  await refreshed.actions.consume("2")
  expect(sentEventIds(refreshed)).toEqual(["event-2"])
})

test("while the screen still shows the same quantity, the same consume reuses the eventId", async () => {
  const pending: PendingOpRef = { current: null }
  const newEventId = idSource()
  const failing = harness({
    result: networkError,
    pending,
    newEventId,
    stock: stock({ quantity: 5 }),
  })
  await failing.actions.consume("2")
  const again = harness({ pending, newEventId, stock: stock({ quantity: 5 }) })
  await again.actions.consume("2")
  expect(sentEventIds(again)).toEqual(["event-1"])
})
