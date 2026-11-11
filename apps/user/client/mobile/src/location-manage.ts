import type { ApiClient } from "@prep-hamster/api-client"

// 場所 (location) の rename / delete の非 UI ロジック。
// 画面から切り出して描画なしの unit test で固定する。

export type LocationDto = { id: string; name: string }

export type LocationActionResult = { ok: true } | { ok: false; message: string }

export type RenameLocationResult = { ok: true; name: string } | { ok: false; message: string }

// DELETE が 422 で返す code。API は「参照している stock がある」判定に soft delete 済みを数えない
const LOCATION_IN_USE_CODE = "LOCATION_IN_USE"
const LOCATION_IN_USE_HINT = "在庫を別の場所へ移動してから削除してください"

type ApiError = { code: string | null; message: string }

// API の失敗は { error: { code, message } } で返る。読めない本文は fallback に倒す (api-error.ts と同じ約束)。
// code も欲しいので apiErrorMessage とは別に読む
async function readApiError(
  res: { json: () => Promise<unknown> },
  fallback: string,
): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } }
    const rawMessage = body.error?.message
    const message = typeof rawMessage === "string" && rawMessage.length > 0 ? rawMessage : fallback
    const rawCode = body.error?.code
    return { code: typeof rawCode === "string" ? rawCode : null, message }
  } catch {
    return { code: null, message: fallback }
  }
}

export async function renameLocation(
  client: ApiClient,
  locationId: string,
  name: string,
): Promise<RenameLocationResult> {
  try {
    const res = await client.v1.locations[":id"].$patch({
      param: { id: locationId },
      json: { name },
    })
    if (!res.ok) {
      const err = await readApiError(res, `HTTP ${res.status}`)
      return { ok: false, message: err.message }
    }
    const { location } = await res.json()
    return { ok: true, name: location.name }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "unknown" }
  }
}

export async function deleteLocation(
  client: ApiClient,
  locationId: string,
): Promise<LocationActionResult> {
  try {
    const res = await client.v1.locations[":id"].$delete({ param: { id: locationId } })
    if (!res.ok) {
      const err = await readApiError(res, `HTTP ${res.status}`)
      // 参照中の削除は利用者が次にやること (在庫を移す) が分かるよう補足を足す
      if (err.code === LOCATION_IN_USE_CODE) {
        return { ok: false, message: `${err.message}。${LOCATION_IN_USE_HINT}` }
      }
      return { ok: false, message: err.message }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "unknown" }
  }
}

// rename 成功後の一覧差し替え。対象が無ければ同じ配列を返す (React の再描画を省くため参照を保つ)
export function applyRenamedLocation<T extends LocationDto>(
  locations: T[],
  id: string,
  name: string,
): T[] {
  if (!locations.some((l) => l.id === id)) return locations
  return locations.map((l) => (l.id === id ? { ...l, name } : l))
}

// delete 成功後の一覧差し替え。対象が無ければ同じ配列を返す
export function removeLocation<T extends LocationDto>(locations: T[], id: string): T[] {
  if (!locations.some((l) => l.id === id)) return locations
  return locations.filter((l) => l.id !== id)
}
