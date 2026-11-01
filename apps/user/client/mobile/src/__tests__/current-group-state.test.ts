import { describe, expect, test } from "bun:test"
import {
  afterCreate,
  afterJoin,
  afterListFailed,
  afterListFetched,
  afterSelect,
  afterSignOut,
  type CurrentGroupGroup,
  type Fetched,
} from "../current-group-state"

const g = (id: string, name: string): CurrentGroupGroup => ({
  id,
  name,
  createdAt: "2026-01-01T00:00:00.000Z",
})

const home = g("id-home", "家")
const office = g("id-office", "職場")
const club = g("id-club", "サークル")
const created = g("id-new", "新しい")
const joined = g("id-joined", "参加先")

const okState = (groups: CurrentGroupGroup[], storedId: string | null): Fetched => ({
  status: "ok",
  groups,
  storedId,
})

describe("afterSignOut", () => {
  test("drops the groups of the previous user", () => {
    expect(afterSignOut()).toEqual({ status: "loading" })
  })
})

describe("afterListFetched / afterListFailed", () => {
  test("keeps the fetched groups and the stored id", () => {
    expect(afterListFetched([home, office], "id-office")).toEqual({
      status: "ok",
      groups: [home, office],
      storedId: "id-office",
    })
  })

  test("carries the failure message", () => {
    expect(afterListFailed("groups HTTP 500")).toEqual({
      status: "error",
      message: "groups HTTP 500",
    })
  })
})

describe("afterSelect", () => {
  test("changes only the stored id", () => {
    expect(afterSelect(okState([home, office, club], "id-home"), "id-club")).toEqual(
      okState([home, office, club], "id-club"),
    )
  })

  test("ignores a select while not loaded", () => {
    expect(afterSelect({ status: "loading" }, "id-club")).toEqual({ status: "loading" })
  })
})

describe("afterCreate", () => {
  test("adds the new group and selects it", () => {
    expect(afterCreate(okState([home, office], "id-home"), created, false)).toEqual(
      okState([home, office, created], "id-new"),
    )
  })

  test("adds the new group but keeps the selection made while creating", () => {
    expect(afterCreate(okState([home, office, club], "id-office"), created, true)).toEqual(
      okState([home, office, club, created], "id-office"),
    )
  })

  test("does nothing while the list is not loaded", () => {
    expect(afterCreate({ status: "loading" }, created, false)).toEqual({ status: "loading" })
  })
})

describe("afterJoin", () => {
  test("replaces the list and selects the joined group", () => {
    expect(afterJoin([home, joined, club], "id-joined")).toEqual(
      okState([home, joined, club], "id-joined"),
    )
  })
})
