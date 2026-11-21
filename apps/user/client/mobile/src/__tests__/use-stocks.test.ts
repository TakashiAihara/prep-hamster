import { expect, test } from "bun:test"
import { joinStocksWithMasters, todayUtc } from "../stock-join"

test("joinStocksWithMasters joins by id with item / location / category names", () => {
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
  const items = [{ id: "i1", name: "Tomato", categoryId: "c1" }]
  const locations = [{ id: "l1", name: "Pantry" }]
  const categories = [{ id: "c1", name: "野菜" }]
  expect(joinStocksWithMasters(stocks, items, locations, categories)).toEqual([
    {
      id: "s1",
      itemName: "Tomato",
      locationId: "l1",
      locationName: "Pantry",
      categoryId: "c1",
      categoryName: "野菜",
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
  const rows = joinStocksWithMasters(stocks, [], [], [])
  expect(rows[0]?.itemName).toBe("不明な商品")
  expect(rows[0]?.locationName).toBe("不明な場所")
  expect(rows[0]?.categoryId).toBeNull()
  expect(rows[0]?.categoryName).toBeNull()
})

test("joinStocksWithMasters leaves category null when the item has none or the master is missing", () => {
  const stocks = [
    {
      id: "no-cat",
      itemId: "i1",
      locationId: "l1",
      quantity: 1,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
    },
    {
      id: "lost-cat",
      itemId: "i2",
      locationId: "l1",
      quantity: 1,
      unit: "個",
      useByDate: null,
      bestBeforeDate: null,
    },
  ]
  const items = [
    { id: "i1", name: "A", categoryId: null },
    { id: "i2", name: "B", categoryId: "c-gone" },
  ]
  const rows = joinStocksWithMasters(
    stocks,
    items,
    [{ id: "l1", name: "Pantry" }],
    [{ id: "c1", name: "野菜" }],
  )
  expect(rows[0]?.categoryId).toBeNull()
  expect(rows[0]?.categoryName).toBeNull()
  expect(rows[1]?.categoryId).toBe("c-gone")
  expect(rows[1]?.categoryName).toBeNull()
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
  const rows = joinStocksWithMasters(
    stocks,
    [{ id: "i", name: "X", categoryId: null }],
    [{ id: "l", name: "Y" }],
    [],
  )
  expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"])
})

test("todayUtc is the UTC calendar date even when the local date differs", () => {
  const prev = process.env.TZ
  process.env.TZ = "Asia/Tokyo"
  try {
    expect(todayUtc(new Date("2026-06-01T20:00:00Z"))).toBe("2026-06-01")
  } finally {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
})
