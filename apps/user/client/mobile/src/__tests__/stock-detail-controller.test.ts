import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import {
  createGuard,
  createStockActions,
  loadReducer,
  type ActionMessage,
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

// 応答の stock は呼び出しごとに quantity を引いた値を返す (サーバの consume / discard を模す)。
function harness(opts: { result?: () => Response; confirm?: boolean } = {}) {
  const posts: string[] = []
  const events: string[] = []
  const messages: Array<ActionMessage | null> = []
  const busy: boolean[] = []
  const changed: StockDto[] = []
  const respond = (name: string) => async () => {
    posts.push(name)
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
    stock: stock(),
    guard: createGuard(),
    setBusy: (b) => busy.push(b),
    setMessage: (m) => messages.push(m),
    onStockChanged: (s) => changed.push(s),
    onMoved: () => events.push("moved"),
    confirmDiscard: async () => {
      events.push("confirm")
      return opts.confirm ?? true
    },
    leave: () => events.push("leave"),
  })
  return { actions, posts, events, messages, busy, changed }
}

const lastMessage = (h: ReturnType<typeof harness>) => h.messages.at(-1)

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

test("consume that leaves stock goes back to the list without a success message", async () => {
  const h = harness()
  await h.actions.consume("1")
  expect(h.events).toEqual(["leave"])
  expect(h.changed.map((s) => s.quantity)).toEqual([4])
  expect(h.messages.some((m) => m?.kind === "ok")).toBe(false)
})

test("consume or discard that empties the stock stays and reports success", async () => {
  const empty = () => json({ stock: stock({ quantity: 0 }), event: {} })
  const c = harness({ result: empty })
  await c.actions.consume("5")
  expect(c.events).toEqual([])
  expect(lastMessage(c)).toEqual({ kind: "ok", text: "消費しました" })

  const d = harness({ result: empty })
  await d.actions.discard("5", "")
  expect(d.events).toEqual(["confirm"])
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
