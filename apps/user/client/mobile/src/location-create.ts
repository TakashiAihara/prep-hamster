import type { ApiClient } from "@prep-hamster/api-client"
import { apiErrorMessage } from "./api-error"

// 場所 (location) 作成の非 UI ロジック: 名前の検証と POST /v1/locations。
// 画面から切り出して描画なしの unit test で固定する。

const NAME_MAX = 100

export type CreateLocationResult =
  | { ok: true; location: { id: string; name: string } }
  | { ok: false; message: string }

export function parseLocationName(
  input: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = input.trim()
  if (value === "") return { ok: false, message: "場所の名前を入力してください" }
  if (value.length > NAME_MAX) {
    return { ok: false, message: `場所の名前は ${NAME_MAX} 文字以内で入力してください` }
  }
  return { ok: true, value }
}

export async function createLocation(
  client: ApiClient,
  groupId: string,
  name: string,
): Promise<CreateLocationResult> {
  try {
    const res = await client.v1.locations.$post({ json: { groupId, name } })
    if (!res.ok) {
      return { ok: false, message: await apiErrorMessage(res, `HTTP ${res.status}`) }
    }
    const { location } = await res.json()
    return { ok: true, location: { id: location.id, name: location.name } }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "unknown" }
  }
}

// 読み直した一覧が別グループのものか、作成した場所を既に含むことがあるので、その場合は足さない
export function appendCreatedLocation<
  T extends { groupId: string; locations: { id: string; name: string }[] },
>(state: T, submittedGroupId: string, created: { id: string; name: string }): T | null {
  if (state.groupId !== submittedGroupId) return null
  if (state.locations.some((l) => l.id === created.id)) return state
  return { ...state, locations: [...state.locations, created] } as T
}
