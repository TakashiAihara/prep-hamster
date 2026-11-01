// createdAt は offset 付きの ISO 文字列になりうるので、文字列比較ではなく Date.parse で比べる。
// 一覧の順序は API が保証しないので、同時刻なら id の小さい方に決める
export function pickCurrentGroup<G extends { id: string; createdAt: string }>(
  groups: G[],
  storedId: string | null,
): G | null {
  const stored = groups.find((g) => g.id === storedId)
  if (stored) return stored

  let oldest: G | null = null
  for (const g of groups) {
    if (oldest === null) {
      oldest = g
      continue
    }
    const diff = Date.parse(g.createdAt) - Date.parse(oldest.createdAt)
    if (diff < 0 || (diff === 0 && g.id < oldest.id)) oldest = g
  }
  return oldest
}
