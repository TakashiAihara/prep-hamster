import type { PushError, PushMessage, PushResult, PushSender } from "./expiry-notify"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
// Expo Push API は 1 リクエスト 100 通まで。
const CHUNK_SIZE = 100
const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 1000

type Ticket = { status: "ok" | "error"; message?: string; details?: { error?: string } }

// 429 / 5xx だけ再試行する。他の 4xx は同じ入力では直らないので即失敗にする。
const isRetryable = (status: number) => status === 429 || status >= 500

const wholeChunkFailed = (chunk: PushMessage[], error: string, message: string): PushError[] =>
  chunk.map((m) => ({ to: m.to, error, message }))

export function createExpoPushSender(
  opts: {
    fetch?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    maxAttempts?: number
    baseDelayMs?: number
  } = {},
): PushSender {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS
  const baseDelayMs = opts.baseDelayMs ?? BASE_DELAY_MS

  // 1 チャンクを送り、失敗した宛先を返す。チケットは data[] が送った順に対応する。
  const sendChunk = async (chunk: PushMessage[]): Promise<PushError[]> => {
    // 再試行は前の応答を見てから次を送るので、ループ内の await は意図したもの。
    for (let attempt = 1; ; attempt++) {
      let res: Response | undefined
      let failure: string
      try {
        // oxlint-disable-next-line no-await-in-loop
        res = await doFetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(chunk),
        })
        failure = `Expo push API responded ${res.status}`
      } catch (err) {
        failure = `Expo push API request failed: ${err instanceof Error ? err.message : String(err)}`
      }

      if (res?.ok) {
        // oxlint-disable-next-line no-await-in-loop
        const json = (await res.json().catch(() => null)) as { data?: unknown } | null
        const tickets = Array.isArray(json?.data) ? (json.data as Ticket[]) : []
        return chunk.flatMap((m, i): PushError[] => {
          const ticket = tickets[i]
          if (!ticket) {
            return [{ to: m.to, error: "MISSING_TICKET", message: "Expo returned no ticket" }]
          }
          if (ticket.status === "ok") return []
          return [
            {
              to: m.to,
              error: ticket.details?.error ?? "UNKNOWN",
              ...(ticket.message ? { message: ticket.message } : {}),
            },
          ]
        })
      }

      const retryable = res === undefined || isRetryable(res.status)
      if (!retryable || attempt >= maxAttempts) {
        return wholeChunkFailed(chunk, "REQUEST_FAILED", failure)
      }
      // oxlint-disable-next-line no-await-in-loop
      await sleep(baseDelayMs * 2 ** (attempt - 1))
    }
  }

  return {
    // チャンクは順番に送る (Expo の上限は project 全体で 600 通/秒)。
    // 1 チャンクの失敗で、受理済みの他のチャンクを巻き込まない。
    async send(messages: PushMessage[]): Promise<PushResult> {
      const errors: PushError[] = []
      for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
        // oxlint-disable-next-line no-await-in-loop
        errors.push(...(await sendChunk(messages.slice(i, i + CHUNK_SIZE))))
      }
      return { sent: messages.length - errors.length, failed: errors.length, errors }
    },
  }
}
