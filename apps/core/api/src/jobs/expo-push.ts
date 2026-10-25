import type { PushMessage, PushSender } from "./expiry-notify"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
// Expo Push API は 1 リクエスト 100 通まで。
const CHUNK_SIZE = 100

export function createExpoPushSender(opts: { fetch?: typeof fetch } = {}): PushSender {
  const doFetch = opts.fetch ?? fetch
  const sendChunk = async (chunk: PushMessage[]) => {
    const res = await doFetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      throw new Error(`Expo push API responded ${res.status}`)
    }
  }
  return {
    async send(messages: PushMessage[]) {
      const chunks: PushMessage[][] = []
      for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
        chunks.push(messages.slice(i, i + CHUNK_SIZE))
      }
      await Promise.all(chunks.map(sendChunk))
    },
  }
}
