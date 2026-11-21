import { expect, test } from "bun:test"
import type { ApiClient } from "@prep-hamster/api-client"
import {
  notificationTarget,
  registerPushToken,
  unregisterPushToken,
  type NotificationTarget,
} from "../push"

const STOCK_ID = "11111111-1111-4111-8111-111111111111"
const TOKEN = "ExponentPushToken[aaaa-1111-phone]"
const HOME: NotificationTarget = { kind: "home" }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

type Call = { name: string; args: unknown }

// hono client の `client.v1["push-tokens"].$post(...)` / `$delete(...)` 形だけを模した偽物。
function fakeClient(responses: Record<string, () => Response>) {
  const calls: Call[] = []
  const handler = (name: string) => async (args: unknown) => {
    calls.push({ name, args })
    const make = responses[name]
    if (!make) throw new Error(`unexpected call ${name}`)
    return make()
  }
  const client = {
    v1: {
      "push-tokens": {
        $post: handler("push.register"),
        $delete: handler("push.unregister"),
      },
    },
  } as unknown as ApiClient
  return { client, calls }
}

test("notificationTarget opens the first stock of an expiring_stocks notification", () => {
  expect(
    notificationTarget({ type: "expiring_stocks", stockIds: [STOCK_ID, "other"], more: 0 }),
  ).toEqual({ kind: "stock", stockId: STOCK_ID })
})

test("notificationTarget stays home when stockIds is empty, missing, or not a string list", () => {
  expect(notificationTarget({ type: "expiring_stocks", stockIds: [], more: 0 })).toEqual(HOME)
  expect(notificationTarget({ type: "expiring_stocks", more: 0 })).toEqual(HOME)
  expect(notificationTarget({ type: "expiring_stocks", stockIds: STOCK_ID })).toEqual(HOME)
  expect(notificationTarget({ type: "expiring_stocks", stockIds: [42] })).toEqual(HOME)
  expect(notificationTarget({ type: "expiring_stocks", stockIds: [""] })).toEqual(HOME)
})

test("notificationTarget stays home for other types and non-object data", () => {
  expect(notificationTarget({ type: "other", stockIds: [STOCK_ID] })).toEqual(HOME)
  expect(notificationTarget(null)).toEqual(HOME)
  expect(notificationTarget("expiring_stocks")).toEqual(HOME)
  expect(notificationTarget(undefined)).toEqual(HOME)
})

test("registerPushToken posts the token to /v1/push-tokens", async () => {
  const { client, calls } = fakeClient({
    "push.register": () => json({ pushToken: { token: TOKEN } }),
  })

  await registerPushToken(client, TOKEN)

  expect(calls).toEqual([{ name: "push.register", args: { json: { token: TOKEN } } }])
})

test("registerPushToken throws the API error message on failure", async () => {
  const { client } = fakeClient({
    "push.register": () => json({ error: { code: "X", message: "token の形式が不正です" } }, 422),
  })

  await expect(registerPushToken(client, "bad")).rejects.toThrow("token の形式が不正です")
})

test("unregisterPushToken deletes the token via /v1/push-tokens", async () => {
  const { client, calls } = fakeClient({
    "push.unregister": () => new Response(null, { status: 204 }),
  })

  await unregisterPushToken(client, TOKEN)

  expect(calls).toEqual([{ name: "push.unregister", args: { json: { token: TOKEN } } }])
})

test("unregisterPushToken throws on failure so sign-out can surface it", async () => {
  const { client } = fakeClient({
    "push.unregister": () => new Response("bad gateway", { status: 502 }),
  })

  await expect(unregisterPushToken(client, TOKEN)).rejects.toThrow("HTTP 502")
})
