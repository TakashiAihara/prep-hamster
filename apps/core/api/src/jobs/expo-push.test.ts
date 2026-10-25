import { expect, test } from "bun:test"
import { createExpoPushSender } from "./expo-push"
import type { PushMessage } from "./expiry-notify"

const msg = (i: number): PushMessage => ({
  to: `ExponentPushToken[dev-${i}]`,
  title: "t",
  body: "b",
  data: { type: "expiring_stocks", stockIds: [`s-${i}`] },
})

test("posts messages to the Expo push endpoint in chunks of 100", async () => {
  const requests: { url: string; body: PushMessage[] }[] = []
  const fakeFetch = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }) as unknown as typeof fetch

  await createExpoPushSender({ fetch: fakeFetch }).send(
    Array.from({ length: 230 }, (_, i) => msg(i)),
  )

  expect(requests.map((r) => r.url)).toEqual(Array(3).fill("https://exp.host/--/api/v2/push/send"))
  expect(requests.map((r) => r.body.length)).toEqual([100, 100, 30])
  expect(requests[2]?.body[29]?.to).toBe("ExponentPushToken[dev-229]")
})

test("rejects when Expo answers with a non-2xx status", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch

  expect(createExpoPushSender({ fetch: fakeFetch }).send([msg(1)])).rejects.toThrow(
    "Expo push API responded 503",
  )
})
