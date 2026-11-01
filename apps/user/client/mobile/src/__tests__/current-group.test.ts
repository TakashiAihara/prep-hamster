import { describe, expect, test } from "bun:test"
import { pickCurrentGroup } from "../current-group-pick"

const group = (id: string, createdAt: string) => ({ id, name: `g-${id}`, createdAt })

const older = group("11111111-1111-4111-8111-111111111111", "2026-01-02T00:00:00.000Z")
const oldest = group("22222222-2222-4222-8222-222222222222", "2026-01-01T00:00:00.000Z")
const newer = group("33333333-3333-4333-8333-333333333333", "2026-01-03T00:00:00.000Z")

describe("pickCurrentGroup", () => {
  test("keeps the stored group while the user still belongs to it", () => {
    expect(pickCurrentGroup([older, oldest, newer], newer.id)).toEqual(newer)
  })

  test("falls back to the oldest group when the stored one is gone", () => {
    expect(
      pickCurrentGroup([newer, oldest, older], "44444444-4444-4444-8444-444444444444"),
    ).toEqual(oldest)
  })

  test("falls back to the oldest group when nothing is stored", () => {
    expect(pickCurrentGroup([older, newer, oldest], null)).toEqual(oldest)
  })

  test("returns null when the user has no group", () => {
    expect(pickCurrentGroup([], older.id)).toBeNull()
  })
})
