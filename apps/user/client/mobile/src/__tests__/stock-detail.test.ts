import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import {
  buildEditPatch,
  consumeStock,
  discardStock,
  editStock,
  loadStockDetail,
  moveStock,
  moveTargets,
  parseAmount,
  parseDateField,
  parseReason,
  shouldSuggestShopping,
} from "../stock-detail"

const STOCK_ID = "11111111-1111-4111-8111-111111111111"
const LOC_A = "22222222-2222-4222-8222-222222222222"
const LOC_B = "33333333-3333-4333-8333-333333333333"
const ITEM_ID = "44444444-4444-4444-8444-444444444444"
const GROUP_ID = "55555555-5555-4555-8555-555555555555"

const stockDto = (over: Record<string, unknown> = {}) => ({
  id: STOCK_ID,
  groupId: GROUP_ID,
  itemId: ITEM_ID,
  locationId: LOC_A,
  quantity: 5,
  unit: "個",
  useByDate: "2026-12-01",
  bestBeforeDate: null,
  openedAt: null,
  note: "memo",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
  ...over,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

type Call = { name: string; args: unknown }

// hono client の `client.v1.stocks[":id"].consume.$post(...)` 形だけを模した偽物。
function fakeClient(responses: Record<string, () => Response>) {
  const calls: Call[] = []
  const handler = (name: string) => async (args: unknown) => {
    calls.push({ name, args })
    const make = responses[name]
    if (!make) throw new Error(`unexpected call ${name}`)
    return make()
  }
  const client = {
    v1: {
      stocks: {
        ":id": {
          $get: handler("stock.get"),
          $patch: handler("stock.patch"),
          consume: { $post: handler("stock.consume") },
          discard: { $post: handler("stock.discard") },
          move: { $post: handler("stock.move") },
        },
      },
      items: { ":id": { $get: handler("item.get") } },
      locations: { $get: handler("locations.list") },
    },
  } as unknown as ApiClient
  return { client, calls }
}

test("parseAmount accepts a positive number up to the remaining quantity", () => {
  expect(parseAmount("2", 5)).toEqual({ ok: true, value: 2 })
  expect(parseAmount("5", 5)).toEqual({ ok: true, value: 5 })
  expect(parseAmount(" 0.5 ", 5)).toEqual({ ok: true, value: 0.5 })
})

test("parseAmount rejects empty, non-numeric, zero, negative and over-remaining input", () => {
  expect(parseAmount("", 5)).toEqual({
    ok: false,
    message: "数量は 0 より大きい数値で入力してください",
  })
  expect(parseAmount("abc", 5).ok).toBe(false)
  expect(parseAmount("0", 5).ok).toBe(false)
  expect(parseAmount("-1", 5).ok).toBe(false)
  expect(parseAmount("Infinity", 5).ok).toBe(false)
  expect(parseAmount("5.5", 5)).toEqual({ ok: false, message: "残量 5 を超えています" })
})

test("parseReason trims, maps blank to null and rejects over 500 chars", () => {
  expect(parseReason("  期限切れ ")).toEqual({ ok: true, value: "期限切れ" })
  expect(parseReason("   ")).toEqual({ ok: true, value: null })
  expect(parseReason("a".repeat(500)).ok).toBe(true)
  expect(parseReason("a".repeat(501))).toEqual({
    ok: false,
    message: "理由は 500 文字以内で入力してください",
  })
})

test("parseDateField accepts YYYY-MM-DD, maps blank to null and rejects impossible dates", () => {
  expect(parseDateField("2026-12-31")).toEqual({ ok: true, value: "2026-12-31" })
  expect(parseDateField("")).toEqual({ ok: true, value: null })
  expect(parseDateField("2026-02-30").ok).toBe(false)
  expect(parseDateField("2026-13-01").ok).toBe(false)
  expect(parseDateField("2026/12/01").ok).toBe(false)
  expect(parseDateField("20261201")).toEqual({
    ok: false,
    message: "日付は YYYY-MM-DD 形式で入力してください",
  })
})

test("buildEditPatch includes only changed fields", () => {
  const original = { useByDate: "2026-12-01", bestBeforeDate: null, note: "memo" }
  expect(
    buildEditPatch(original, { useByDate: "2026-12-01", bestBeforeDate: "", note: "memo" }),
  ).toEqual({
    ok: false,
    message: "変更がありません",
  })
  expect(
    buildEditPatch(original, { useByDate: "", bestBeforeDate: "2027-01-05", note: "memo" }),
  ).toEqual({ ok: true, value: { useByDate: null, bestBeforeDate: "2027-01-05" } })
  expect(
    buildEditPatch(original, { useByDate: "2026-12-01", bestBeforeDate: "", note: "" }),
  ).toEqual({ ok: true, value: { note: null } })
})

test("buildEditPatch surfaces which date field is invalid", () => {
  const original = { useByDate: null, bestBeforeDate: null, note: null }
  const r = buildEditPatch(original, { useByDate: "x", bestBeforeDate: "", note: "" })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.message).toContain("使用期限")
  const r2 = buildEditPatch(original, { useByDate: "", bestBeforeDate: "x", note: "" })
  expect(r2.ok).toBe(false)
  if (!r2.ok) expect(r2.message).toContain("賞味期限")
})

test("shouldSuggestShopping is true only when nothing is left", () => {
  expect(shouldSuggestShopping(0)).toBe(true)
  expect(shouldSuggestShopping(0.5)).toBe(false)
  expect(shouldSuggestShopping(3)).toBe(false)
})

test("moveTargets excludes the current location", () => {
  const locs = [
    { id: LOC_A, name: "Pantry" },
    { id: LOC_B, name: "Fridge" },
  ]
  expect(moveTargets(locs, LOC_A)).toEqual([{ id: LOC_B, name: "Fridge" }])
})

test("consumeStock posts quantityDelta and returns the updated stock", async () => {
  const { client, calls } = fakeClient({
    "stock.consume": () => json({ stock: stockDto({ quantity: 3 }), event: {} }),
  })
  const r = await consumeStock(client, STOCK_ID, 2)
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.stock.quantity).toBe(3)
  expect(calls).toEqual([
    { name: "stock.consume", args: { param: { id: STOCK_ID }, json: { quantityDelta: 2 } } },
  ])
})

test("discardStock sends the reason and returns an empty stock as quantity 0", async () => {
  const { client, calls } = fakeClient({
    "stock.discard": () => json({ stock: stockDto({ quantity: 0 }), event: {} }),
  })
  const r = await discardStock(client, STOCK_ID, 5, "期限切れ")
  expect(r.ok && r.stock.quantity).toBe(0)
  expect(calls[0]?.args).toEqual({
    param: { id: STOCK_ID },
    json: { quantityDelta: 5, reason: "期限切れ" },
  })
})

test("moveStock posts toLocationId and returns the new location", async () => {
  const { client, calls } = fakeClient({
    "stock.move": () => json({ stock: stockDto({ locationId: LOC_B }), event: {} }),
  })
  const r = await moveStock(client, STOCK_ID, LOC_B)
  expect(r.ok && r.stock.locationId).toBe(LOC_B)
  expect(calls[0]?.args).toEqual({ param: { id: STOCK_ID }, json: { toLocationId: LOC_B } })
})

test("editStock patches only the given fields", async () => {
  const { client, calls } = fakeClient({
    "stock.patch": () => json({ stock: stockDto({ note: null }) }),
  })
  const r = await editStock(client, STOCK_ID, { note: null })
  expect(r.ok && r.stock.note).toBeNull()
  expect(calls[0]?.args).toEqual({ param: { id: STOCK_ID }, json: { note: null } })
})

test("action failures return the API error message, or the HTTP status without a body", async () => {
  const withBody = fakeClient({
    "stock.consume": () =>
      json({ error: { code: "INSUFFICIENT_QUANTITY", message: "在庫が足りません" } }, 422),
  })
  expect(await consumeStock(withBody.client, STOCK_ID, 9)).toEqual({
    ok: false,
    message: "在庫が足りません",
  })

  const noBody = fakeClient({ "stock.move": () => new Response("boom", { status: 500 }) })
  expect(await moveStock(noBody.client, STOCK_ID, LOC_B)).toEqual({
    ok: false,
    message: "HTTP 500",
  })
})

test("action returns a network error as a failed result instead of throwing", async () => {
  const { client } = fakeClient({
    "stock.consume": () => {
      throw new Error("Network request failed")
    },
  })
  expect(await consumeStock(client, STOCK_ID, 1)).toEqual({
    ok: false,
    message: "Network request failed",
  })
})

test("loadStockDetail joins the stock with its item name and group locations", async () => {
  const { client, calls } = fakeClient({
    "stock.get": () => json({ stock: stockDto() }),
    "item.get": () => json({ item: { id: ITEM_ID, name: "Tomato" } }),
    "locations.list": () =>
      json({
        locations: [
          { id: LOC_A, name: "Pantry" },
          { id: LOC_B, name: "Fridge" },
        ],
      }),
  })
  const r = await loadStockDetail(client, STOCK_ID)
  expect(r).toEqual({
    ok: true,
    detail: {
      stock: expect.objectContaining({ id: STOCK_ID, quantity: 5 }),
      itemName: "Tomato",
      locations: [
        { id: LOC_A, name: "Pantry" },
        { id: LOC_B, name: "Fridge" },
      ],
    },
  })
  expect(calls.find((c) => c.name === "item.get")?.args).toEqual({ param: { id: ITEM_ID } })
  expect(calls.find((c) => c.name === "locations.list")?.args).toEqual({
    query: { groupId: GROUP_ID },
  })
})

test("loadStockDetail reports a missing stock as a failed result", async () => {
  const { client } = fakeClient({
    "stock.get": () =>
      json({ error: { code: "NOT_FOUND", message: "stock が見つかりません" } }, 404),
  })
  expect(await loadStockDetail(client, STOCK_ID)).toEqual({
    ok: false,
    message: "stock が見つかりません",
  })
})
