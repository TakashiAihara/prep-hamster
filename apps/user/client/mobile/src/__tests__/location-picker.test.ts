import { expect, test } from "bun:test"
import {
  applyLocationFetch,
  emptyLocationPicker,
  noteCreatedLocation,
  pickLocation,
} from "../location-picker"

const GROUP_A = "55555555-5555-4555-8555-555555555555"
const GROUP_B = "77777777-7777-4777-8777-777777777777"
const LOC_X = { id: "88888888-8888-4888-8888-888888888888", name: "冷凍庫" }
const LOC_Y = { id: "99999999-9999-4999-8999-999999999999", name: "棚" }
const LOC_L = { id: "66666666-6666-4666-8666-666666666666", name: "冷蔵庫" }
const LOC_M = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "床下" }

test("a fetch answered before the create shows the server list as-is", () => {
  // POST が終わる前に返った GET には、これから作る場所はまだ無い
  const res = applyLocationFetch(emptyLocationPicker, 1, GROUP_A, [LOC_X, LOC_Y])
  expect(res.locations).toEqual([LOC_X, LOC_Y])
  expect(res.selectedId).toBe(LOC_X.id)

  // そのあと作成が成功すると、次の読み直しで作った場所が選ばれる
  const created = noteCreatedLocation(res.state, 1, GROUP_A, LOC_L)
  const again = applyLocationFetch(created, 2, GROUP_A, [LOC_X, LOC_Y, LOC_L])
  expect(again.selectedId).toBe(LOC_L.id)
})

test("a fetch issued before the create merges the created location into the stale list", () => {
  // GET(seq=1) の応答を待つ間に POST が完了した。応答は作成を追い越して LOC_L を含まない
  const created = noteCreatedLocation(emptyLocationPicker, 1, GROUP_A, LOC_L)
  const res = applyLocationFetch(created, 1, GROUP_A, [LOC_X, LOC_Y])
  expect(res.locations).toEqual([LOC_X, LOC_Y, LOC_L])
  expect(res.selectedId).toBe(LOC_L.id)
  // まだ作成より後に発行された GET を見ていないので、記憶は残る
  expect(res.state.created[GROUP_A]).toEqual([{ ...LOC_L, seq: 1 }])
})

test("a fetch issued after the create trusts the server list and forgets the created location", () => {
  const created = noteCreatedLocation(emptyLocationPicker, 1, GROUP_A, LOC_L)
  const res = applyLocationFetch(created, 2, GROUP_A, [LOC_X, LOC_Y, LOC_L])
  // サーバが返した並びをそのまま使い、覚えた場所は足さない
  expect(res.locations).toEqual([LOC_X, LOC_Y, LOC_L])
  expect(res.state.created[GROUP_A]).toBeUndefined()
  expect(res.selectedId).toBe(LOC_L.id)
})

test("a fetch issued after the create does not bring back a location the server no longer returns", () => {
  // 別の端末で消された場所は、作成を覚えていても一覧に復活させない
  const created = noteCreatedLocation(emptyLocationPicker, 1, GROUP_A, LOC_L)
  const res = applyLocationFetch(created, 2, GROUP_A, [LOC_X, LOC_Y])
  expect(res.locations).toEqual([LOC_X, LOC_Y])
  expect(res.state.created[GROUP_A]).toBeUndefined()
  // picked が指す場所は一覧に無いので、先頭に戻る
  expect(res.selectedId).toBe(LOC_X.id)
})

test("a fetch for another group neither merges nor forgets the created location", () => {
  const created = noteCreatedLocation(emptyLocationPicker, 1, GROUP_A, LOC_L)
  const other = applyLocationFetch(created, 2, GROUP_B, [LOC_M])
  expect(other.locations).toEqual([LOC_M])
  expect(other.selectedId).toBe(LOC_M.id)
  expect(other.state.created[GROUP_A]).toEqual([{ ...LOC_L, seq: 1 }])

  // A に戻った GET は作成より後に発行されているので、サーバの一覧をそのまま使う
  const back = applyLocationFetch(other.state, 3, GROUP_A, [LOC_X, LOC_Y, LOC_L])
  expect(back.locations).toEqual([LOC_X, LOC_Y, LOC_L])
  expect(back.state.created[GROUP_A]).toBeUndefined()
  expect(back.selectedId).toBe(LOC_L.id)
})

test("a fetch issued between two creates merges only the location created before it", () => {
  // seq=2 の GET は L の作成後・M の作成前に発行された。L はサーバが返すはずで、M は追い越しうる
  let state = noteCreatedLocation(emptyLocationPicker, 1, GROUP_A, LOC_L)
  state = noteCreatedLocation(state, 3, GROUP_A, LOC_M)
  const res = applyLocationFetch(state, 2, GROUP_A, [LOC_X, LOC_Y, LOC_L])
  expect(res.locations).toEqual([LOC_X, LOC_Y, LOC_L, LOC_M])
  expect(res.state.created[GROUP_A]).toEqual([{ ...LOC_M, seq: 3 }])
})

test("does not duplicate a created location the server list already has", () => {
  const created = noteCreatedLocation(emptyLocationPicker, 1, GROUP_A, LOC_L)
  const res = applyLocationFetch(created, 1, GROUP_A, [LOC_X, LOC_L, LOC_Y])
  expect(res.locations).toEqual([LOC_X, LOC_L, LOC_Y])
})

test("selects nothing when the group has no locations", () => {
  const res = applyLocationFetch(emptyLocationPicker, 1, GROUP_A, [])
  expect(res.locations).toEqual([])
  expect(res.selectedId).toBeNull()
})

test("a manual pick survives a group switch round trip", () => {
  let state = pickLocation(emptyLocationPicker, GROUP_A, LOC_Y.id)
  const first = applyLocationFetch(state, 1, GROUP_A, [LOC_X, LOC_Y])
  expect(first.selectedId).toBe(LOC_Y.id)

  const other = applyLocationFetch(first.state, 2, GROUP_B, [LOC_M])
  expect(other.selectedId).toBe(LOC_M.id)

  const back = applyLocationFetch(other.state, 3, GROUP_A, [LOC_X, LOC_Y])
  expect(back.selectedId).toBe(LOC_Y.id)
})

test("a manual pick after creating beats the created location on the next fetch", () => {
  // 作成で自動選択されたあと、利用者が手で別の場所を選ぶ。読み直しで作った場所に戻らない
  let state = noteCreatedLocation(emptyLocationPicker, 1, GROUP_A, LOC_L)
  state = pickLocation(state, GROUP_A, LOC_X.id)
  const res = applyLocationFetch(state, 2, GROUP_A, [LOC_X, LOC_Y, LOC_L])
  expect(res.selectedId).toBe(LOC_X.id)
})

test("creating a location becomes the selection even over an earlier manual pick", () => {
  // 手で選んだあとに場所を作ると、作った場所が新しい選択になる
  let state = pickLocation(emptyLocationPicker, GROUP_A, LOC_X.id)
  state = noteCreatedLocation(state, 1, GROUP_A, LOC_L)
  const res = applyLocationFetch(state, 2, GROUP_A, [LOC_X, LOC_Y, LOC_L])
  expect(res.selectedId).toBe(LOC_L.id)
})

test("a pick in one group does not select a location in another", () => {
  const state = pickLocation(emptyLocationPicker, GROUP_B, LOC_M.id)
  const res = applyLocationFetch(state, 1, GROUP_A, [LOC_X, LOC_Y])
  expect(res.selectedId).toBe(LOC_X.id)
})

test("falls back to the first location when the picked one is gone", () => {
  const state = pickLocation(emptyLocationPicker, GROUP_A, LOC_L.id)
  const res = applyLocationFetch(state, 1, GROUP_A, [LOC_X, LOC_Y])
  expect(res.selectedId).toBe(LOC_X.id)
})
