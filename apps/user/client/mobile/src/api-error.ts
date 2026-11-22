// API の失敗は { error: { code, message, details? } } で返る。読めない本文 (プロキシの HTML 等) は fallback に倒す。
// RN 0.81 の global Response と hono client の Response は FormData の型が食い違うので、使う json() だけを受ける。

// 本文は 1 回しか読めないので、message と details の両方が要る呼び出し側は
// res.json() を 1 回呼んでから apiErrorMessageFromBody / alreadyMemberGroupId に渡す。
export async function apiErrorMessage(
  res: { json: () => Promise<unknown> },
  fallback: string,
): Promise<string> {
  try {
    return apiErrorMessageFromBody(await res.json(), fallback)
  } catch {
    return fallback
  }
}

export function apiErrorMessageFromBody(body: unknown, fallback: string): string {
  const error = (body as { error?: { message?: unknown } } | null)?.error
  const message = error?.message
  return typeof message === "string" && message.length > 0 ? message : fallback
}

// 既に member のグループの招待コードを貼ると、accept は 409 ALREADY_MEMBER +
// details.groupId を返す。その group を選び直すために id を取り出す。該当しなければ null。
export function alreadyMemberGroupId(body: unknown): string | null {
  const error = (body as { error?: { code?: unknown; details?: unknown } } | null)?.error
  if (error?.code !== "ALREADY_MEMBER") return null
  const groupId = (error.details as { groupId?: unknown } | null | undefined)?.groupId
  return typeof groupId === "string" && groupId.length > 0 ? groupId : null
}
