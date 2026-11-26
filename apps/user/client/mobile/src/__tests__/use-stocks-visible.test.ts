import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import { isExpired, loadStockRows } from "../stock-join"

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

function fakeListClient(
  over: {
    stocks?: () => Response
    items?: () => Response
    locations?: () => Response
    categories?: () => Response
  } = {},
) {
  const queries: {
    stocks?: unknown
    items?: unknown
    locations?: unknown
    categories?: unknown
  } = {}
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
      items: {
        $get: async (args: { query: unknown }) => {
          queries.items = args.query
          return over.items?.() ?? json({ items: [{ id: "i1", name: "Tomato", categoryId: "c1" }] })
        },
      },
      locations: {
        $get: async (args: { query: unknown }) => {
          queries.locations = args.query
          return over.locations?.() ?? json({ locations: [{ id: "l1", name: "Pantry" }] })
        },
      },
      categories: {
        $get: async (args: { query: unknown }) => {
          queries.categories = args.query
          return over.categories?.() ?? json({ categories: [{ id: "c1", name: "野菜" }] })
        },
      },
    },
  } as unknown as ApiClient
  return { client, queries }
}

test("loadStockRows asks for expired stocks too and shows the rows the API returns as is", async () => {
  // 数量 0 の在庫を除くのは API の既定 (includeEmpty なし)。偽の API にあえて数量 0 の行を返させ、
  // 端末側では絞り直さずにそのまま出すことを確かめる
  const { client, queries } = fakeListClient()
  const r = await loadStockRows(client, GROUP)
  expect(queries.stocks).toEqual({ groupId: GROUP, includeExpired: "true" })
  expect(queries.items).toEqual({ groupId: GROUP })
  expect(queries.locations).toEqual({ groupId: GROUP })
  expect(queries.categories).toEqual({ groupId: GROUP })
  expect(r.ok && r.rows.map((x) => x.id)).toEqual(["alive", "used-up", "expired"])
  expect(r.ok && r.rows[0]?.itemName).toBe("Tomato")
  expect(r.ok && r.rows[0]?.categoryId).toBe("c1")
  expect(r.ok && r.rows[0]?.categoryName).toBe("野菜")
})

test("loadStockRows reports which request failed", async () => {
  const { client } = fakeListClient({ stocks: () => new Response("x", { status: 500 }) })
  expect(await loadStockRows(client, GROUP)).toEqual({ ok: false, message: "stocks HTTP 500" })
  const items = fakeListClient({ items: () => new Response("x", { status: 502 }) })
  expect(await loadStockRows(items.client, GROUP)).toEqual({ ok: false, message: "items HTTP 502" })
  const locs = fakeListClient({ locations: () => new Response("x", { status: 503 }) })
  expect(await loadStockRows(locs.client, GROUP)).toEqual({
    ok: false,
    message: "locations HTTP 503",
  })
  const cats = fakeListClient({ categories: () => new Response("x", { status: 504 }) })
  expect(await loadStockRows(cats.client, GROUP)).toEqual({
    ok: false,
    message: "categories HTTP 504",
  })
})
