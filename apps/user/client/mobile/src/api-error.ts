// API の失敗は { error: { message } } で返る。読めない本文 (プロキシの HTML 等) は fallback に倒す。
// RN 0.81 の global Response と hono client の Response は FormData の型が食い違うので、使う json() だけを受ける。
export async function apiErrorMessage(
  res: { json: () => Promise<unknown> },
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    const message = body.error?.message
    if (typeof message === "string" && message.length > 0) return message
  } catch {
    // 本文が JSON でなければ fallback を使う
  }
  return fallback
}
