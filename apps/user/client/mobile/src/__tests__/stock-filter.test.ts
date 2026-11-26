import { expect, test } from "bun:test"
import {
  EMPTY_STOCK_FILTER,
  filterStockRows,
  sortStockRowsByExpiry,
  stockFilterOptions,
} from "../stock-filter"
import type { StockListItem } from "../stock-join"

const row = (over: Partial<StockListItem> & { id: string }): StockListItem => ({
  itemName: "トマト",
  locationId: "l1",
  locationName: "冷蔵庫",
  categoryId: null,
  categoryName: null,
  quantity: 1,
  unit: "個",
  useByDate: null,
  bestBeforeDate: null,
  ...over,
})

test("filterStockRows returns every row when the filter is empty", () => {
  const rows = [row({ id: "a" }), row({ id: "b", locationId: "l2", locationName: "パントリー" })]
  expect(filterStockRows(rows, EMPTY_STOCK_FILTER)).toEqual(rows)
})

test("filterStockRows keeps only rows in the selected location", () => {
  const rows = [
    row({ id: "a", locationId: "l1" }),
    row({ id: "b", locationId: "l2", locationName: "パントリー" }),
    row({ id: "c", locationId: "l1" }),
  ]
  expect(
    filterStockRows(rows, { ...EMPTY_STOCK_FILTER, locationId: "l2" }).map((r) => r.id),
  ).toEqual(["b"])
})

test("filterStockRows keeps only rows in the selected category and drops uncategorized rows", () => {
  const rows = [
    row({ id: "a", categoryId: "c1", categoryName: "野菜" }),
    row({ id: "b", categoryId: "c2", categoryName: "肉" }),
    row({ id: "c" }),
  ]
  expect(
    filterStockRows(rows, { ...EMPTY_STOCK_FILTER, categoryId: "c1" }).map((r) => r.id),
  ).toEqual(["a"])
})

test("filterStockRows matches the item name partially, ignoring case and surrounding spaces", () => {
  const rows = [
    row({ id: "a", itemName: "トマトジュース" }),
    row({ id: "b", itemName: "Milk" }),
    row({ id: "c", itemName: "抹茶" }),
  ]
  const byName = (query: string) =>
    filterStockRows(rows, { ...EMPTY_STOCK_FILTER, query }).map((r) => r.id)
  expect(byName("トマト")).toEqual(["a"])
  expect(byName("milk")).toEqual(["b"])
  expect(byName("  MILK  ")).toEqual(["b"])
  expect(byName("   ")).toEqual(["a", "b", "c"])
  expect(byName("存在しない")).toEqual([])
})

test("filterStockRows applies category, location and name together", () => {
  const rows = [
    row({ id: "a", itemName: "トマト", categoryId: "c1", locationId: "l1" }),
    row({ id: "b", itemName: "トマト缶", categoryId: "c1", locationId: "l2" }),
    row({ id: "c", itemName: "トマトジュース", categoryId: "c2", locationId: "l1" }),
  ]
  const result = filterStockRows(rows, {
    categoryId: "c1",
    locationId: "l1",
    query: "トマト",
  })
  expect(result.map((r) => r.id)).toEqual(["a"])
})

test("sortStockRowsByExpiry orders by the displayed expiry date ascending with undated rows last", () => {
  const rows = [
    row({ id: "none", useByDate: null, bestBeforeDate: null }),
    row({ id: "late", useByDate: "2026-12-01", bestBeforeDate: null }),
    row({ id: "early-bb", useByDate: null, bestBeforeDate: "2026-01-01" }),
    row({ id: "early", useByDate: "2026-06-01", bestBeforeDate: null }),
  ]
  expect(sortStockRowsByExpiry(rows).map((r) => r.id)).toEqual([
    "early-bb",
    "early",
    "late",
    "none",
  ])
})

test("sortStockRowsByExpiry prefers useByDate like the row display does", () => {
  const rows = [
    row({ id: "bb-only", useByDate: null, bestBeforeDate: "2026-01-01" }),
    row({ id: "use-by", useByDate: "2026-06-01", bestBeforeDate: "2026-01-01" }),
  ]
  // use-by の行は表示が「期限 2026-06-01」なので、賞味期限 2026-01-01 の行より後ろ
  expect(sortStockRowsByExpiry(rows).map((r) => r.id)).toEqual(["bb-only", "use-by"])
})

test("sortStockRowsByExpiry keeps the input order for equal expiry dates", () => {
  const rows = [
    row({ id: "first", useByDate: "2026-06-01" }),
    row({ id: "second", useByDate: "2026-06-01" }),
    row({ id: "third", useByDate: null, bestBeforeDate: "2026-06-01" }),
  ]
  expect(sortStockRowsByExpiry(rows).map((r) => r.id)).toEqual(["first", "second", "third"])
})

test("sortStockRowsByExpiry does not mutate the input", () => {
  const rows = [
    row({ id: "b", useByDate: "2026-12-01" }),
    row({ id: "a", useByDate: "2026-01-01" }),
  ]
  const sorted = sortStockRowsByExpiry(rows)
  expect(rows.map((r) => r.id)).toEqual(["b", "a"])
  expect(sorted.map((r) => r.id)).toEqual(["a", "b"])
})

test("stockFilterOptions lists only categories and locations present in the rows, sorted by name", () => {
  const rows = [
    row({
      id: "a",
      locationId: "l2",
      locationName: "パントリー",
      categoryId: "c2",
      categoryName: "肉",
    }),
    row({
      id: "b",
      locationId: "l1",
      locationName: "冷蔵庫",
      categoryId: "c1",
      categoryName: "野菜",
    }),
    row({
      id: "c",
      locationId: "l1",
      locationName: "冷蔵庫",
      categoryId: "c1",
      categoryName: "野菜",
    }),
    row({ id: "d", locationId: "l2", locationName: "パントリー" }),
  ]
  const options = stockFilterOptions(rows)
  expect(options.locations).toEqual([
    { id: "l2", name: "パントリー" },
    { id: "l1", name: "冷蔵庫" },
  ])
  expect(options.categories).toEqual([
    { id: "c2", name: "肉" },
    { id: "c1", name: "野菜" },
  ])
})

test("stockFilterOptions skips rows whose category name could not be joined", () => {
  const rows = [
    row({ id: "a", categoryId: "c-gone", categoryName: null }),
    row({ id: "b", categoryId: "c1", categoryName: "野菜" }),
  ]
  expect(stockFilterOptions(rows).categories).toEqual([{ id: "c1", name: "野菜" }])
})
