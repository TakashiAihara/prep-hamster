import { expect, test } from "bun:test"
import { normalizeTagName } from "../tag-name"

test("normalizeTagName trims surrounding whitespace", () => {
  expect(normalizeTagName("  pet\t")).toBe("pet")
  expect(normalizeTagName("　pet　")).toBe("pet")
})

test("normalizeTagName folds full-width forms with NFKC", () => {
  expect(normalizeTagName("ＰＥＴ１")).toBe("pet1")
  expect(normalizeTagName("ﾍﾟｯﾄ")).toBe("ペット")
})

test("normalizeTagName lower-cases", () => {
  expect(normalizeTagName("Water")).toBe("water")
})

test("normalizeTagName keeps inner whitespace and distinct names distinct", () => {
  expect(normalizeTagName("a b")).toBe("a b")
  expect(normalizeTagName("水")).not.toBe(normalizeTagName("犬"))
})
