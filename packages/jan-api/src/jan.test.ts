import { expect, test } from "bun:test"
import { computeJanCheckDigit, isValidJan } from "./jan"

test("isValidJan accepts a known-good EAN-13", () => {
  // 4901234567894 は EAN-13 のサンプルで広く流通している値
  expect(isValidJan("4901234567894")).toBe(true)
})

test("isValidJan rejects bad check digit", () => {
  expect(isValidJan("4901234567890")).toBe(false)
})

test("isValidJan rejects non-13/8 length", () => {
  expect(isValidJan("123")).toBe(false)
  expect(isValidJan("12345678901234")).toBe(false)
})

test("isValidJan rejects non-digit string", () => {
  expect(isValidJan("49012abcd5678")).toBe(false)
})

test("computeJanCheckDigit matches known EAN-13", () => {
  expect(computeJanCheckDigit("490123456789")).toBe(4)
})

test("computeJanCheckDigit throws on non-digit input", () => {
  expect(() => computeJanCheckDigit("abc")).toThrow()
})
