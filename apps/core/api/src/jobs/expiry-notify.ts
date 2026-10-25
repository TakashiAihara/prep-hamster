import { and, asc, eq, isNull, sql } from "drizzle-orm"
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
  data: { type: "expiring_stocks"; stockIds: string[] }
}

export type PushSender = {
  send(messages: PushMessage[]): Promise<void>
}

// notification_settings の行がまだ無いユーザーは schema の既定 (有効 / 7 日前) として扱う。
const DEFAULT_DAYS_BEFORE = 7
const BODY_ITEM_LIMIT = 3

// 日付は date 型 (タイムゾーン無し) なので、今日は運用地域 (JST) の暦日で決める。
const todayInJst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date())

export type RunExpiryNotifyOptions = {
  db: Db
  sender: PushSender
  today?: string
}

export async function runExpiryNotify(
  opts: RunExpiryNotifyOptions,
): Promise<{ users: number; messages: number }> {
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
    .leftJoin(
      notificationSettings,
      and(eq(notificationSettings.userId, users.id), isNull(notificationSettings.deletedAt)),
    )
    .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)))
    .innerJoin(groups, and(eq(groups.id, memberships.groupId), isNull(groups.deletedAt)))
    .innerJoin(stocks, and(eq(stocks.groupId, groups.id), isNull(stocks.deletedAt)))
    .innerJoin(items, and(eq(items.id, stocks.itemId), isNull(items.deletedAt)))
    .where(
      and(
        isNull(users.deletedAt),
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
  if (dueByUser.size === 0) {
    return { users: 0, messages: 0 }
  }

  const tokenRows = await opts.db.select().from(pushTokens)
  const messages: PushMessage[] = []
  let notifiedUsers = 0
  for (const [userId, due] of dueByUser) {
    const tokens = tokenRows.filter((t) => t.userId === userId)
    if (tokens.length === 0) continue
    notifiedUsers++
    const shown = due
      .slice(0, BODY_ITEM_LIMIT)
      .map((r) => `${r.itemName} ${r.deadline.slice(5).replace("-", "/")}`)
      .join("、")
    const rest = due.length - BODY_ITEM_LIMIT
    for (const t of tokens) {
      messages.push({
        to: t.token,
        title: `期限が近い在庫が ${due.length} 件あります`,
        body: rest > 0 ? `${shown} ほか${rest}件` : shown,
        data: { type: "expiring_stocks", stockIds: due.map((r) => r.stockId) },
      })
    }
  }

  if (messages.length > 0) {
    await opts.sender.send(messages)
  }
  return { users: notifiedUsers, messages: messages.length }
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
    console.log(`[expiry-notify] sent ${result.messages} messages to ${result.users} users`)
    process.exit(0)
  } catch (err) {
    console.error("[expiry-notify] failed:", err)
    process.exit(1)
  }
}
