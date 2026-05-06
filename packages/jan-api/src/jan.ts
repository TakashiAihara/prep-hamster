// EAN-13 / EAN-8 (JAN) のチェックディジット検証。
// バーコード読取の精度ノイズを早期に弾くために提供する純関数。

const DIGITS_RE = /^\d+$/

export function isValidJan(jan: string): boolean {
  if (jan.length !== 13 && jan.length !== 8) return false
  if (!DIGITS_RE.test(jan)) return false
  return computeJanCheckDigit(jan.slice(0, -1)) === Number(jan.at(-1))
}

// EAN-13 / EAN-8 共通のチェックディジット算出。
// 末尾を除いた桁を 3:1 重みで右から交互に乗じ、その合計の 10 補数の下 1 桁。
//   - 13 桁では右端から (3,1,3,1,3,1,3,1,3,1,3,1) で重み付け
//   - 8 桁でも同じパターン (右端から 3,1,3,1,3,1,3)
export function computeJanCheckDigit(prefix: string): number {
  if (!DIGITS_RE.test(prefix)) {
    throw new Error("computeJanCheckDigit: prefix must be a digit string")
  }
  let sum = 0
  for (let i = 0; i < prefix.length; i++) {
    const digit = Number(prefix[prefix.length - 1 - i])
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10
}
