import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import { isExpired, loadStockRows, visibleStocks, type StockListItem } from "../use-stocks"

const row = (id: string, quantity: number): StockListItem => ({
  id,
  itemName: "X",
  locationName: "Y",
  quantity,
  unit: "個",
  useByDate: null,
  bestBeforeDate: null,
})

test("visibleStocks hides empty stocks and keeps order", () => {
  const rows = [row("a", 2), row("b", 0), row("c", 0.5)]
  expect(visibleStocks(rows).map((r) => r.id)).toEqual(["a", "c"])
})

test("visibleStocks returns an empty list when everything is used up", () => {
  expect(visibleStocks([row("a", 0)])).toEqual([])
})

test("visibleStocks hides a float residue left by repeated consumption", () => {
  expect(visibleStocks([row("a", 1 - 0.7 - 0.3)])).toEqual([])
})

test("isExpired is true on or after the use-by / best-before date and false before it", () => {
  const today = "2026-10-25"
  const base = { useByDate: null, bestBeforeDate: null }
  expect(isExpired(base, today)).toBe(false)
  expect(isExpired({ ...base, useByDate: "2026-10-25" }, today)).toBe(true)
  expect(isExpired({ ...base, useByDate: "2026-10-26" }, today)).toBe(false)
  expect(isExpired({ ...base, bestBeforeDate: "2026-10-25" }, today)).toBe(true)
  expect(isExpired({ ...base, bestBeforeDate: "2026-10-26" }, today)).toBe(false)
  expect(isExpired({ useByDate: "2027-01-01", bestBeforeDate: "2026-10-01" }, today)).toBe(true)
})

const GROUP = "55555555-5555-4555-8555-555555555555"
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const stockDto = (id: string, quantity: number) => ({
  id,
  itemId: "i1",
  locationId: "l1",
  quantity,
  unit: "個",
  useByDate: null,
  bestBeforeDate: null,
})

function fakeListClient(over: { stocks?: () => Response } = {}) {
  const queries: { stocks?: unknown } = {}
  const client = {
    v1: {
      stocks: {
        $get: async (args: { query: unknown }) => {
          queries.stocks = args.query
          return (
            over.stocks?.() ??
            json({ stocks: [stockDto("alive", 2), stockDto("used-up", 0), stockDto("expired", 1)] })
          )
        },
      },
      items: { $get: async () => json({ items: [{ id: "i1", name: "Tomato" }] }) },
      locations: { $get: async () => json({ locations: [{ id: "l1", name: "Pantry" }] }) },
    },
  } as unknown as ApiClient
  return { client, queries }
}

test("loadStockRows asks for expired stocks too and hides the emptied ones", async () => {
  const { client, queries } = fakeListClient()
  const r = await loadStockRows(client, GROUP)
  expect(queries.stocks).toEqual({ groupId: GROUP, includeExpired: "true" })
  expect(r.ok && r.rows.map((x) => x.id)).toEqual(["alive", "expired"])
  expect(r.ok && r.rows[0]?.itemName).toBe("Tomato")
})

test("loadStockRows reports which request failed", async () => {
  const { client } = fakeListClient({ stocks: () => new Response("x", { status: 500 }) })
  expect(await loadStockRows(client, GROUP)).toEqual({ ok: false, message: "stocks HTTP 500" })
})
