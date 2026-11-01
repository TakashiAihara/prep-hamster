// API の失敗は { error: { message } } で返る。読めない本文 (プロキシの HTML 等) は fallback に倒す。
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    const message = body.error?.message
    if (typeof message === "string" && message.length > 0) return message
  } catch {
    // 本文が JSON でなければ fallback を使う
  }
  return fallback
}
