import { expect, test } from "bun:test"
import { createExpoPushSender } from "./expo-push"
import type { PushMessage } from "./expiry-notify"

const msg = (i: number): PushMessage => ({
  to: `ExponentPushToken[dev-${i}]`,
  title: "t",
  body: "b",
  data: { type: "expiring_stocks", stockIds: [`s-${i}`], more: 0 },
})

const okTickets = (n: number) => ({ data: Array.from({ length: n }, () => ({ status: "ok" })) })
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const noSleep = async () => {}

test("posts messages to the Expo push endpoint in chunks of 100, one chunk at a time", async () => {
  const requests: { url: string; body: PushMessage[] }[] = []
  let inFlight = 0
  let maxInFlight = 0
  const fakeFetch = (async (url: string, init: RequestInit) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    const body = JSON.parse(String(init.body)) as PushMessage[]
    requests.push({ url, body })
    inFlight--
    return json(okTickets(body.length))
  }) as unknown as typeof fetch

  const result = await createExpoPushSender({ fetch: fakeFetch }).send(
    Array.from({ length: 230 }, (_, i) => msg(i)),
  )

  expect(requests.map((r) => r.url)).toEqual(Array(3).fill("https://exp.host/--/api/v2/push/send"))
  expect(requests.map((r) => r.body.length)).toEqual([100, 100, 30])
  expect(requests[2]?.body[29]?.to).toBe("ExponentPushToken[dev-229]")
  expect(maxInFlight).toBe(1)
  expect(result).toEqual({ sent: 230, failed: 0, errors: [] })
})

test("reports error tickets per token with Expo's details.error", async () => {
  const fakeFetch = (async () =>
    json({
      data: [
        { status: "ok", id: "r1" },
        {
          status: "error",
          message: "not a registered push notification recipient",
          details: { error: "DeviceNotRegistered" },
        },
        { status: "error", message: "too big", details: { error: "MessageTooBig" } },
      ],
    })) as unknown as typeof fetch

  const result = await createExpoPushSender({ fetch: fakeFetch }).send([msg(1), msg(2), msg(3)])

  expect(result).toEqual({
    sent: 1,
    failed: 2,
    errors: [
      {
        to: "ExponentPushToken[dev-2]",
        error: "DeviceNotRegistered",
        message: "not a registered push notification recipient",
      },
      { to: "ExponentPushToken[dev-3]", error: "MessageTooBig", message: "too big" },
    ],
  })
})

test("counts messages without a ticket as failed", async () => {
  const fakeFetch = (async () => json({ data: [{ status: "ok" }] })) as unknown as typeof fetch

  const result = await createExpoPushSender({ fetch: fakeFetch }).send([msg(1), msg(2)])

  expect(result.sent).toBe(1)
  expect(result.errors).toEqual([
    { to: "ExponentPushToken[dev-2]", error: "MISSING_TICKET", message: "Expo returned no ticket" },
  ])
})

test("retries 429 and 5xx with exponential backoff and then succeeds", async () => {
  const statuses = [429, 503]
  let calls = 0
  const fakeFetch = (async () => {
    const status = statuses[calls++]
    return status ? new Response("busy", { status }) : json(okTickets(1))
  }) as unknown as typeof fetch
  const sleeps: number[] = []

  const result = await createExpoPushSender({
    fetch: fakeFetch,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  }).send([msg(1)])

  expect(calls).toBe(3)
  expect(sleeps).toEqual([1000, 2000])
  expect(result).toEqual({ sent: 1, failed: 0, errors: [] })
})

test("gives up after 3 attempts and fails only that chunk, other chunks still go out", async () => {
  const seen: string[] = []
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as PushMessage[]
    seen.push(body[0]!.to)
    return body[0]!.to === "ExponentPushToken[dev-0]"
      ? new Response("down", { status: 502 })
      : json(okTickets(body.length))
  }) as unknown as typeof fetch

  const result = await createExpoPushSender({ fetch: fakeFetch, sleep: noSleep }).send(
    Array.from({ length: 101 }, (_, i) => msg(i)),
  )

  expect(seen).toEqual([
    "ExponentPushToken[dev-0]",
    "ExponentPushToken[dev-0]",
    "ExponentPushToken[dev-0]",
    "ExponentPushToken[dev-100]",
  ])
  expect(result.sent).toBe(1)
  expect(result.failed).toBe(100)
  expect(result.errors[0]).toEqual({
    to: "ExponentPushToken[dev-0]",
    error: "REQUEST_FAILED",
    message: "Expo push API responded 502",
  })
})

test("does not retry a 4xx other than 429", async () => {
  let calls = 0
  const fakeFetch = (async () => {
    calls++
    return new Response("bad", { status: 400 })
  }) as unknown as typeof fetch

  const result = await createExpoPushSender({ fetch: fakeFetch, sleep: noSleep }).send([msg(1)])

  expect(calls).toBe(1)
  expect(result.errors).toEqual([
    {
      to: "ExponentPushToken[dev-1]",
      error: "REQUEST_FAILED",
      message: "Expo push API responded 400",
    },
  ])
})

test("retries a network error", async () => {
  let calls = 0
  const fakeFetch = (async () => {
    if (calls++ === 0) throw new Error("socket hang up")
    return json(okTickets(1))
  }) as unknown as typeof fetch

  const result = await createExpoPushSender({ fetch: fakeFetch, sleep: noSleep }).send([msg(1)])

  expect(calls).toBe(2)
  expect(result.sent).toBe(1)
})
