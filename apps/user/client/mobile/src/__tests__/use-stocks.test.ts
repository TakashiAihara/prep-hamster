import { expect, test } from "bun:test"
import { joinStocksWithMasters } from "../use-stocks"

test("joinStocksWithMasters joins by id with item / location names", () => {
  const stocks = [
    {
      id: "s1",
      itemId: "i1",
      locationId: "l1",
      quantity: 3,
      unit: "個",
      useByDate: "2026-06-01",
      bestBeforeDate: null,
    },
  ]
  const items = [{ id: "i1", name: "Tomato" }]
  const locations = [{ id: "l1", name: "Pantry" }]
  expect(joinStocksWithMasters(stocks, items, locations)).toEqual([
    {
      id: "s1",
      itemName: "Tomato",
      locationName: "Pantry",
      quantity: 3,
      unit: "個",
      useByDate: "2026-06-01",
      bestBeforeDate: null,
    },
  ])
})

test("joinStocksWithMasters falls back to '(unknown ...)' when masters are missing", () => {
  const stocks = [
    {
      id: "s1",
      itemId: "missing-item",
      locationId: "missing-loc",
      quantity: 1,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
    },
  ]
  const rows = joinStocksWithMasters(stocks, [], [])
  expect(rows[0]?.itemName).toBe("(unknown item)")
  expect(rows[0]?.locationName).toBe("(unknown location)")
})

test("joinStocksWithMasters preserves the input order of stocks", () => {
  const stocks = [
    {
      id: "a",
      itemId: "i",
      locationId: "l",
      quantity: 1,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
    },
    {
      id: "b",
      itemId: "i",
      locationId: "l",
      quantity: 1,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
    },
    {
      id: "c",
      itemId: "i",
      locationId: "l",
      quantity: 1,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
    },
  ]
  const rows = joinStocksWithMasters(stocks, [{ id: "i", name: "X" }], [{ id: "l", name: "Y" }])
  expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"])
})
