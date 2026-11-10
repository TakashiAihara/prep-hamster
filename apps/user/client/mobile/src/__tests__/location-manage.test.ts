import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import {
  applyRenamedLocation,
  deleteLocation,
  removeLocation,
  renameLocation,
} from "../location-manage"

const LOC_ID = "66666666-6666-4666-8666-666666666666"
const LOC_A = { id: "88888888-8888-4888-8888-888888888888", name: "冷凍庫" }
const LOC_B = { id: "99999999-9999-4999-8999-999999999999", name: "棚" }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const locationDto = {
  id: LOC_ID,
  groupId: "55555555-5555-4555-8555-555555555555",
  name: "冷蔵庫",
  sortOrder: null,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
  deletedAt: null,
}

// hono client の `client.v1.locations[":id"].$patch / $delete` 形だけを模した偽物
function fakeClient(
  makePatch: () => Response | Promise<Response>,
  makeDelete?: () => Response | Promise<Response>,
) {
  const patchCalls: unknown[] = []
  const deleteCalls: unknown[] = []
  const client = {
    v1: {
      locations: {
        ":id": {
          $patch: async (args: unknown) => {
            patchCalls.push(args)
            return makePatch()
          },
          $delete: async (args: unknown) => {
            deleteCalls.push(args)
            return (makeDelete ?? (() => new Response(null, { status: 204 })))()
          },
        },
      },
    },
  } as unknown as ApiClient
  return { client, patchCalls, deleteCalls }
}

test("renameLocation patches the name and returns the name the API stored", async () => {
  // 応答の名前を送った名前と変え、入力をそのまま返す実装を落とす
  const { client, patchCalls } = fakeClient(() =>
    json({ location: { ...locationDto, name: "冷蔵庫 (API)" } }),
  )
  const res = await renameLocation(client, LOC_ID, "冷蔵庫")
  expect(res).toEqual({ ok: true, name: "冷蔵庫 (API)" })
  expect(patchCalls).toEqual([{ param: { id: LOC_ID }, json: { name: "冷蔵庫" } }])
})

test("renameLocation returns the API error message on failure", async () => {
  const { client } = fakeClient(() =>
    json({ error: { code: "FORBIDDEN", message: "編集権限がありません" } }, 403),
  )
  expect(await renameLocation(client, LOC_ID, "冷蔵庫")).toEqual({
    ok: false,
    message: "編集権限がありません",
  })
})

test("renameLocation falls back to the HTTP status when the body has no message", async () => {
  const { client } = fakeClient(() => new Response("bad gateway", { status: 502 }))
  expect(await renameLocation(client, LOC_ID, "冷蔵庫")).toEqual({
    ok: false,
    message: "HTTP 502",
  })
})

test("renameLocation returns the thrown error message when the request fails", async () => {
  const { client } = fakeClient(() => {
    throw new Error("Network request failed")
  })
  expect(await renameLocation(client, LOC_ID, "冷蔵庫")).toEqual({
    ok: false,
    message: "Network request failed",
  })
})

test("renameLocation returns unknown when something other than an Error is thrown", async () => {
  const { client } = fakeClient(() => {
    throw "boom"
  })
  expect(await renameLocation(client, LOC_ID, "冷蔵庫")).toEqual({
    ok: false,
    message: "unknown",
  })
})

test("deleteLocation deletes by id and returns ok on 204", async () => {
  const { client, deleteCalls } = fakeClient(
    () => json({}, 500),
    () => new Response(null, { status: 204 }),
  )
  expect(await deleteLocation(client, LOC_ID)).toEqual({ ok: true })
  expect(deleteCalls).toEqual([{ param: { id: LOC_ID } }])
})

test("deleteLocation appends the next step to the API message on LOCATION_IN_USE", async () => {
  const { client } = fakeClient(
    () => json({}, 500),
    () =>
      json(
        {
          error: {
            code: "LOCATION_IN_USE",
            message: "この location を参照している stock が存在するため削除できません",
          },
        },
        422,
      ),
  )
  const res = await deleteLocation(client, LOC_ID)
  expect(res.ok).toBe(false)
  if (res.ok) return
  // API の理由に加えて、利用者が次にやることが分かる文が入る
  expect(res.message).toBe(
    "この location を参照している stock が存在するため削除できません。在庫を別の場所へ移動してから削除してください",
  )
})

test("deleteLocation returns the API message without the hint for other error codes", async () => {
  const { client } = fakeClient(
    () => json({}, 500),
    () =>
      json({ error: { code: "INSUFFICIENT_ROLE", message: "EDITOR 以上の権限が必要です" } }, 403),
  )
  expect(await deleteLocation(client, LOC_ID)).toEqual({
    ok: false,
    message: "EDITOR 以上の権限が必要です",
  })
})

test("deleteLocation falls back to the HTTP status when the body has no message", async () => {
  const { client } = fakeClient(
    () => json({}, 500),
    () => new Response("oops", { status: 500 }),
  )
  expect(await deleteLocation(client, LOC_ID)).toEqual({ ok: false, message: "HTTP 500" })
})

test("deleteLocation returns the thrown error message when the request fails", async () => {
  const { client } = fakeClient(
    () => json({}, 500),
    () => {
      throw new Error("Network request failed")
    },
  )
  expect(await deleteLocation(client, LOC_ID)).toEqual({
    ok: false,
    message: "Network request failed",
  })
})

test("applyRenamedLocation replaces the name of the matching location only", () => {
  const locations = [LOC_A, { id: LOC_ID, name: "冷蔵庫" }, LOC_B]
  const next = applyRenamedLocation(locations, LOC_ID, "冷蔵庫 (2F)")
  expect(next).toEqual([LOC_A, { id: LOC_ID, name: "冷蔵庫 (2F)" }, LOC_B])
  expect(locations[1]).toEqual({ id: LOC_ID, name: "冷蔵庫" })
})

test("applyRenamedLocation returns the same array when the id is not in the list", () => {
  const locations = [LOC_A, LOC_B]
  expect(applyRenamedLocation(locations, LOC_ID, "冷蔵庫")).toBe(locations)
})

test("removeLocation drops the matching location and keeps the rest", () => {
  const locations = [LOC_A, { id: LOC_ID, name: "冷蔵庫" }, LOC_B]
  expect(removeLocation(locations, LOC_ID)).toEqual([LOC_A, LOC_B])
})

test("removeLocation returns the same array when the id is not in the list", () => {
  const locations = [LOC_A, LOC_B]
  expect(removeLocation(locations, LOC_ID)).toBe(locations)
})
