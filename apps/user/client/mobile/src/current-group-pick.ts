// createdAt は offset 付きの ISO 文字列になりうるので、文字列比較ではなく Date.parse で比べる
export function pickCurrentGroup<G extends { id: string; createdAt: string }>(
  groups: G[],
  storedId: string | null,
): G | null {
  const stored = groups.find((g) => g.id === storedId)
  if (stored) return stored

  let oldest: G | null = null
  for (const g of groups) {
    if (oldest === null || Date.parse(g.createdAt) < Date.parse(oldest.createdAt)) oldest = g
  }
  return oldest
}
