const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// 招待コードは 1 回しか使えない (API が使用済みにする) ので、文面にもそう書く。
// 期限は API の既定値を写さず、発行の応答の expiresAt から端末の日付で出す
export function inviteMessage(groupName: string, token: string, expiresAt: string): string {
  const until = new Date(expiresAt)
  return [
    `prep-hamster の「${groupName}」への招待コード (1 人だけ・${until.getMonth() + 1}/${until.getDate()} まで使えます):`,
    token,
    "アプリの「招待コードで参加」に、このメッセージをまるごと貼ってください",
  ].join("\n")
}

// 共有シートの本文をまるごと貼られても通るよう、文中の最初の UUID を取り出す。
// API の token は今 UUID (randomUUID)。形を変えたらここも合わせる
export function parseInviteCode(text: string): string | null {
  return text.match(UUID)?.[0].toLowerCase() ?? null
}
