import { appendCreatedLocation } from "./location-create"

// 詳細入力 (/add/details) の保管場所まわりの非 UI ロジック。
// 作成した場所を読み直しに足すことと、グループごとの選択の記憶を、
// 描画なしの unit test で固定する。

export type PickerLocation = { id: string; name: string }

// created の seq は、その場所を作った時点で発行済みだった locations GET の通し番号。
// seq 以下で発行された GET は作成を追い越した一覧を返しうるので、覚えた場所を足して出す。
// seq より後に発行された GET は作成後のサーバの一覧を返すので、覚えた場所は足さずに忘れる
// (別の端末で消えた場所を一覧に復活させて、stock の POST を失敗させない)
export type CreatedLocation = PickerLocation & { seq: number }

export type LocationPickerState = {
  created: Record<string, CreatedLocation[]>
  // groupId -> 利用者が最後に選んだ場所。手で選んだものと、作ったばかりで自動選択されたもの
  picked: Record<string, string>
}

export const emptyLocationPicker: LocationPickerState = { created: {}, picked: {} }

// 場所を手で選んだとき。グループごとに覚え、別グループから戻った読み直しで選択を戻す
export function pickLocation(
  state: LocationPickerState,
  groupId: string,
  locationId: string,
): LocationPickerState {
  return { ...state, picked: { ...state.picked, [groupId]: locationId } }
}

// POST /locations が成功したとき。fetchSeq は発行済み GET の通し番号で、
// これ以前に発行された GET は作成を追い越した一覧を返しうるので seq に残す。
// picked にも入れて、読み直し後もこの場所が選ばれたままにする
export function noteCreatedLocation(
  state: LocationPickerState,
  fetchSeq: number,
  groupId: string,
  location: PickerLocation,
): LocationPickerState {
  const created = [...(state.created[groupId] ?? []), { ...location, seq: fetchSeq }]
  return {
    created: { ...state.created, [groupId]: created },
    picked: { ...state.picked, [groupId]: location.id },
  }
}

export type LocationFetchResult = {
  state: LocationPickerState
  locations: PickerLocation[]
  selectedId: string | null
}

// GET /locations の応答を一覧に反映する。
// seq はこの GET を発行したときの通し番号。作成より後に発行された GET の応答なら
// サーバの一覧を信じ、覚えている場所は足さずに忘れる
export function applyLocationFetch(
  state: LocationPickerState,
  seq: number,
  groupId: string,
  serverLocations: PickerLocation[],
): LocationFetchResult {
  const remembered = state.created[groupId] ?? []
  const pending = remembered.filter((loc) => loc.seq >= seq)
  const locations = pending.reduce(
    (acc, loc) => appendCreatedLocation(acc, groupId, { id: loc.id, name: loc.name }) ?? acc,
    { groupId, locations: serverLocations },
  ).locations

  let created = state.created
  if (pending.length !== remembered.length) {
    created = { ...state.created }
    if (pending.length === 0) delete created[groupId]
    else created[groupId] = pending
  }
  const next = created === state.created ? state : { ...state, created }

  const pickedId = state.picked[groupId]
  const selectedId =
    pickedId !== undefined && locations.some((l) => l.id === pickedId)
      ? pickedId
      : (locations[0]?.id ?? null)
  return { state: next, locations, selectedId }
}
