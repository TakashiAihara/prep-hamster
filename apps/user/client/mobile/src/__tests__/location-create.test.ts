import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import { createLocation, parseLocationName } from "../location-create"

const GROUP_ID = "55555555-5555-4555-8555-555555555555"
const LOC_ID = "66666666-6666-4666-8666-666666666666"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const locationDto = {
  id: LOC_ID,
  groupId: GROUP_ID,
  name: "冷蔵庫",
  sortOrder: null,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
  deletedAt: null,
}

// hono client の `client.v1.locations.$post(...)` 形だけを模した偽物。
function fakeClient(make: () => Response | Promise<Response>) {
  const calls: unknown[] = []
  const client = {
    v1: {
      locations: {
        $post: async (args: unknown) => {
          calls.push(args)
          return make()
        },
      },
    },
  } as unknown as ApiClient
  return { client, calls }
}

test("parseLocationName trims the name", () => {
  expect(parseLocationName("  冷蔵庫 ")).toEqual({ ok: true, value: "冷蔵庫" })
})

test("parseLocationName rejects an empty or blank name", () => {
  for (const input of ["", "   "]) {
    expect(parseLocationName(input)).toEqual({
      ok: false,
      message: "場所の名前を入力してください",
    })
  }
})

test("parseLocationName accepts 100 characters and rejects 101 after trimming", () => {
  expect(parseLocationName(` ${"あ".repeat(100)} `)).toEqual({ ok: true, value: "あ".repeat(100) })
  expect(parseLocationName("あ".repeat(101))).toEqual({
    ok: false,
    message: "場所の名前は 100 文字以内で入力してください",
  })
})

test("createLocation posts the group and the name and returns the created location", async () => {
  const { client, calls } = fakeClient(() => json({ location: locationDto }, 201))
  const res = await createLocation(client, GROUP_ID, "冷蔵庫")
  expect(res).toEqual({ ok: true, location: { id: LOC_ID, name: "冷蔵庫" } })
  expect(calls).toEqual([{ json: { groupId: GROUP_ID, name: "冷蔵庫" } }])
})

test("createLocation returns the API error message on failure", async () => {
  const { client } = fakeClient(() =>
    json({ error: { code: "FORBIDDEN", message: "編集権限がありません" } }, 403),
  )
  expect(await createLocation(client, GROUP_ID, "冷蔵庫")).toEqual({
    ok: false,
    message: "編集権限がありません",
  })
})

test("createLocation falls back to the HTTP status when the body has no message", async () => {
  const { client } = fakeClient(() => new Response("bad gateway", { status: 502 }))
  expect(await createLocation(client, GROUP_ID, "冷蔵庫")).toEqual({
    ok: false,
    message: "HTTP 502",
  })
})

test("createLocation returns the thrown error message when the request fails", async () => {
  const { client } = fakeClient(() => {
    throw new Error("Network request failed")
  })
  expect(await createLocation(client, GROUP_ID, "冷蔵庫")).toEqual({
    ok: false,
    message: "Network request failed",
  })
})
