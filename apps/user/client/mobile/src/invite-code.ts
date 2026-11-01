const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// 共有シートの本文をまるごと貼られても通るよう、文中の最初の UUID を取り出す。
export function parseInviteCode(text: string): string | null {
  return text.match(UUID)?.[0].toLowerCase() ?? null
}
