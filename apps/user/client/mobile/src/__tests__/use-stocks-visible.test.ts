import { expect, test } from "bun:test"
import { visibleStocks, type StockListItem } from "../use-stocks"

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
