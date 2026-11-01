export type CurrentGroupGroup = { id: string; name: string; createdAt: string }

export type Fetched =
  | { status: "loading" }
  | { status: "ok"; groups: CurrentGroupGroup[]; storedId: string | null }
  | { status: "error"; message: string }

// サインアウトしたら、次にサインインするユーザーへ前のユーザーのグループを見せないよう捨てる
export const afterSignOut = (): Fetched => ({ status: "loading" })

export const afterListFetched = (
  groups: CurrentGroupGroup[],
  storedId: string | null,
): Fetched => ({
  status: "ok",
  groups,
  storedId,
})

export const afterListFailed = (message: string): Fetched => ({ status: "error", message })

export const afterSelect = (prev: Fetched, id: string): Fetched =>
  prev.status === "ok" ? { ...prev, storedId: id } : prev

// 作成の応答を待つ間に利用者が別のグループを選んでいたら、作ったグループは一覧に足すだけで選択は奪わない
export const afterCreate = (
  prev: Fetched,
  created: CurrentGroupGroup,
  selectedMeanwhile: boolean,
): Fetched => {
  if (prev.status !== "ok") return prev
  const withCreated: Fetched = { ...prev, groups: [...prev.groups, created] }
  return selectedMeanwhile ? withCreated : afterSelect(withCreated, created.id)
}

// loading を挟まずに一覧ごと差し替える (開いている切替画面を入口へ飛ばさないため)
export const afterJoin = (groups: CurrentGroupGroup[], joinedGroupId: string): Fetched => ({
  status: "ok",
  groups,
  storedId: joinedGroupId,
})
