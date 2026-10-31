import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import {
  createDb,
  groups,
  items,
  memberships,
  notificationSettings,
  pushTokens,
  stocks,
  users,
  type Db,
} from "@prep-hamster/db"
import { createExpoPushSender } from "./expo-push"

export type PushMessage = {
  to: string
  title: string
  body: string
  data: { type: "expiring_stocks"; stockIds: string[]; more: number }
}

export type PushError = { to: string; error: string; message?: string }

export type PushResult = { sent: number; failed: number; errors: PushError[] }

export type PushSender = {
  send(messages: PushMessage[]): Promise<PushResult>
}

// notification_settings の行がまだ無いユーザーは schema の既定 (有効 / 7 日前) として扱う。
// 論理削除された行は「無効にした」と読む (行を作る経路がまだ無く、削除の意味が確定していないため安全側)。
const DEFAULT_DAYS_BEFORE = 7
const BODY_ITEM_LIMIT = 3
// Expo の payload 上限は 4096 byte。UUID 1 件が約 39 byte なので、一覧は上限を切って残りは件数で渡す。
const PAYLOAD_STOCK_ID_LIMIT = 20
const DEVICE_NOT_REGISTERED = "DeviceNotRegistered"

// 全メッセージが失敗したときだけ、運用者に気づかせるため終了コードを非 0 にする。
// 一部の失敗 (死んだ token など) は次回に回るだけなので、ジョブ自体は成功として扱う。
export const exitCodeFor = (r: { messages: number; sent: number }) =>
  r.messages > 0 && r.sent === 0 ? 1 : 0

// 日付は date 型 (タイムゾーン無し) なので、今日は運用地域 (JST) の暦日で決める。
const todayInJst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date())

export type RunExpiryNotifyOptions = {
  db: Db
  sender: PushSender
  today?: string
}

export type RunExpiryNotifyResult = {
  users: number
  messages: number
  sent: number
  failed: number
  errors: PushError[]
  removedTokens: number
}

export async function runExpiryNotify(
  opts: RunExpiryNotifyOptions,
): Promise<RunExpiryNotifyResult> {
  const today = opts.today ?? todayInJst()
  // use_by / best_before の早い方が期限。LEAST は NULL を無視する。
  const deadline = sql<string>`least(${stocks.useByDate}, ${stocks.bestBeforeDate})`

  const rows = await opts.db
    .select({
      userId: users.id,
      stockId: stocks.id,
      itemName: items.name,
      deadline,
    })
    .from(users)
    .leftJoin(notificationSettings, eq(notificationSettings.userId, users.id))
    .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)))
    .innerJoin(groups, and(eq(groups.id, memberships.groupId), isNull(groups.deletedAt)))
    .innerJoin(stocks, and(eq(stocks.groupId, groups.id), isNull(stocks.deletedAt)))
    .innerJoin(items, and(eq(items.id, stocks.itemId), isNull(items.deletedAt)))
    .where(
      and(
        isNull(users.deletedAt),
        isNull(notificationSettings.deletedAt),
        sql`coalesce(${notificationSettings.expiringNotifyEnabled}, true)`,
        sql`${stocks.quantity} > 0`,
        sql`${deadline} >= ${today}::date`,
        sql`${deadline} <= ${today}::date + coalesce(${notificationSettings.expiringDaysBefore}, ${DEFAULT_DAYS_BEFORE})`,
      ),
    )
    .orderBy(asc(deadline), asc(items.name))

  const dueByUser = new Map<string, typeof rows>()
  for (const row of rows) {
    dueByUser.set(row.userId, [...(dueByUser.get(row.userId) ?? []), row])
  }
  const nothing: RunExpiryNotifyResult = {
    users: 0,
    messages: 0,
    sent: 0,
    failed: 0,
    errors: [],
    removedTokens: 0,
  }
  if (dueByUser.size === 0) return nothing

  // 同じ JST 暦日に通知済みのユーザーは飛ばす (ジョブの再実行・二重起動で二重送信しない)。
  const alreadyNotified = await opts.db
    .select({ userId: notificationSettings.userId })
    .from(notificationSettings)
    .where(
      and(
        inArray(notificationSettings.userId, [...dueByUser.keys()]),
        eq(notificationSettings.expiryNotifiedOn, today),
      ),
    )
  for (const { userId } of alreadyNotified) dueByUser.delete(userId)
  if (dueByUser.size === 0) return nothing

  const tokenRows = await opts.db
    .select()
    .from(pushTokens)
    .where(inArray(pushTokens.userId, [...dueByUser.keys()]))
  const tokensByUser = new Map<string, string[]>()
  for (const t of tokenRows) {
    tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token])
  }

  const messages: PushMessage[] = []
  const attemptedTokens = new Map<string, string[]>()
  for (const [userId, due] of dueByUser) {
    const tokens = tokensByUser.get(userId) ?? []
    if (tokens.length === 0) continue
    attemptedTokens.set(userId, tokens)
    const shown = due
      .slice(0, BODY_ITEM_LIMIT)
      .map((r) => `${r.itemName} ${r.deadline.slice(5).replace("-", "/")}`)
      .join("、")
    const rest = due.length - BODY_ITEM_LIMIT
    const stockIds = due.slice(0, PAYLOAD_STOCK_ID_LIMIT).map((r) => r.stockId)
    for (const token of tokens) {
      messages.push({
        to: token,
        title: `期限が近い在庫が ${due.length} 件あります`,
        body: rest > 0 ? `${shown} ほか${rest}件` : shown,
        data: { type: "expiring_stocks", stockIds, more: due.length - stockIds.length },
      })
    }
  }
  if (messages.length === 0) return nothing

  const result = await opts.sender.send(messages)

  // 1 端末でも受理されたユーザーだけを通知済みにする。全端末が失敗したユーザーは次回の実行で再送する。
  const failedTo = new Set(result.errors.map((e) => e.to))
  const notified = [...attemptedTokens]
    .filter(([, tokens]) => tokens.some((t) => !failedTo.has(t)))
    .map(([userId]) => ({ id: crypto.randomUUID(), userId, expiryNotifiedOn: today }))
  // 行が無いユーザーは schema の既定値で作る。既存行は expiry_notified_on だけを更新する。
  if (notified.length > 0) {
    await opts.db
      .insert(notificationSettings)
      .values(notified)
      .onConflictDoUpdate({
        target: notificationSettings.userId,
        set: { expiryNotifiedOn: sql`excluded.expiry_notified_on` },
      })
  }

  // DeviceNotRegistered の token は送り続けない (Expo の指示)。レシートの確認は未対応で、チケットの時点で分かった分だけ消す。
  const dead = result.errors.filter((e) => e.error === DEVICE_NOT_REGISTERED).map((e) => e.to)
  if (dead.length > 0) {
    await opts.db.delete(pushTokens).where(inArray(pushTokens.token, dead))
  }

  return {
    users: attemptedTokens.size,
    messages: messages.length,
    sent: result.sent,
    failed: result.failed,
    errors: result.errors,
    removedTokens: dead.length,
  }
}

if (import.meta.main) {
  const databaseUrl = process.env["DATABASE_URL"]
  if (!databaseUrl) {
    console.error("[expiry-notify] DATABASE_URL is required")
    process.exit(1)
  }
  try {
    const result = await runExpiryNotify({
      db: createDb(databaseUrl),
      sender: createExpoPushSender(),
    })
    console.log(
      `[expiry-notify] ${result.sent} sent, ${result.failed} failed of ${result.messages} messages to ${result.users} users, removed ${result.removedTokens} dead tokens`,
    )
    for (const e of result.errors) {
      console.error(`[expiry-notify] ${e.to}: ${e.error}${e.message ? ` (${e.message})` : ""}`)
    }
    process.exit(exitCodeFor(result))
  } catch (err) {
    console.error("[expiry-notify] failed:", err)
    process.exit(1)
  }
}
