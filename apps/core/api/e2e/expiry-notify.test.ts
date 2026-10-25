import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  items,
  memberships,
  expiryNotifications,
  notificationSettings,
  pushTokens,
  stocks,
  groups,
} from "@prep-hamster/db"
import {
  exitCodeFor,
  runExpiryNotify,
  type PushError,
  type PushMessage,
  type PushSender,
} from "../src/jobs/expiry-notify"
import {
  seedGroupWithMembership,
  seedItem,
  seedLocation,
  seedMembership,
  seedStock,
  seedUser,
} from "./seed"
import { ensureMigrated, testDb, truncateAll } from "./setup"

beforeAll(async () => {
  await ensureMigrated()
})

beforeEach(async () => {
  await truncateAll()
})

const TODAY = "2026-10-25"

const fakeSender = (failWith?: (m: PushMessage) => string | undefined) => {
  const calls: PushMessage[][] = []
  const sender: PushSender = {
    send: async (messages) => {
      calls.push(messages)
      const errors: PushError[] = messages.flatMap((m) => {
        const error = failWith?.(m)
        return error ? [{ to: m.to, error }] : []
      })
      return { sent: messages.length - errors.length, failed: errors.length, errors }
    },
  }
  return { sender, calls }
}

const addToken = (userId: string, token: string) =>
  testDb.insert(pushTokens).values({ id: crypto.randomUUID(), userId, token })

const setSettings = (userId: string, v: { days: number; enabled?: boolean }) =>
  testDb.insert(notificationSettings).values({
    id: crypto.randomUUID(),
    userId,
    expiringDaysBefore: v.days,
    expiringNotifyEnabled: v.enabled ?? true,
  })

const byTo = (a: PushMessage, b: PushMessage) => a.to.localeCompare(b.to)

test("sends one message per device, only for stocks due within the user's N days", async () => {
  const u1 = await seedUser("u1")
  await setSettings(u1, { days: 5 })
  await addToken(u1, "ExponentPushToken[u1-phone]")
  await addToken(u1, "ExponentPushToken[u1-tablet]")
  const g1 = await seedGroupWithMembership(u1, "G1")
  const loc = await seedLocation(g1)
  const stock = async (name: string, q: number, dates: Parameters<typeof seedStock>[4]) =>
    seedStock(g1, await seedItem(g1, name), loc, q, dates)

  const tea = await stock("Tea", 3, { bestBeforeDate: "2026-10-25" })
  const water = await stock("Water", 2, { useByDate: "2026-10-27" })
  const pasta = await stock("Pasta", 4, { useByDate: "2026-10-28", bestBeforeDate: "2027-01-01" })
  const oats = await stock("Oats", 5, { useByDate: "2026-12-01", bestBeforeDate: "2026-10-29" })
  const rice = await stock("Rice", 6, { bestBeforeDate: "2026-10-30" })
  await stock("Salt", 7, { bestBeforeDate: "2026-10-31" })
  await stock("Milk", 8, { bestBeforeDate: "2026-10-24" })
  await stock("Beans", 0, { bestBeforeDate: "2026-10-26" })
  await stock("Plain", 9, {})
  await stock("Curry", 2, { useByDate: "2026-10-24", bestBeforeDate: "2026-10-28" })
  const tuna = await stock("Tuna", 3, { bestBeforeDate: "2026-10-26" })
  await testDb.update(stocks).set({ deletedAt: new Date() }).where(eq(stocks.id, tuna))
  const gone = await stock("Gone", 3, { bestBeforeDate: "2026-10-26" })
  await testDb
    .update(items)
    .set({ deletedAt: new Date() })
    .where(eq(items.id, (await testDb.select().from(stocks).where(eq(stocks.id, gone)))[0]!.itemId))

  // default settings (no row): 7 days, in another group
  const u2 = await seedUser("u2")
  await addToken(u2, "ExponentPushToken[u2-phone]")
  const g2 = await seedGroupWithMembership(u2, "G2")
  const jam = await seedStock(g2, await seedItem(g2, "Jam"), await seedLocation(g2), 1, {
    bestBeforeDate: "2026-10-31",
  })

  // excluded users
  const off = await seedUser("off")
  await setSettings(off, { days: 5, enabled: false })
  await addToken(off, "ExponentPushToken[off-phone]")
  await seedMembership(off, g1, "VIEWER")
  const noToken = await seedUser("no-token")
  await seedMembership(noToken, g1, "VIEWER")
  const left = await seedUser("left")
  await addToken(left, "ExponentPushToken[left-phone]")
  const leftMembership = await seedMembership(left, g2, "VIEWER")
  await testDb
    .update(memberships)
    .set({ deletedAt: new Date() })
    .where(eq(memberships.id, leftMembership))
  const g3 = await seedGroupWithMembership(u1, "G3-deleted")
  await seedStock(g3, await seedItem(g3, "Ghost"), await seedLocation(g3), 1, {
    bestBeforeDate: "2026-10-26",
  })
  await testDb.update(groups).set({ deletedAt: new Date() }).where(eq(groups.id, g3))

  const { sender, calls } = fakeSender()
  const result = await runExpiryNotify({ db: testDb, sender, today: TODAY })

  expect(result).toEqual({
    users: 2,
    messages: 3,
    sent: 3,
    failed: 0,
    errors: [],
    removedTokens: 0,
  })
  expect(calls).toHaveLength(1)
  const u1Payload: Omit<PushMessage, "to"> = {
    title: "期限が近い在庫が 5 件あります",
    body: "Tea 10/25、Water 10/27、Pasta 10/28 ほか2件",
    data: { type: "expiring_stocks", stockIds: [tea, water, pasta, oats, rice], more: 0 },
  }
  const expected: PushMessage[] = [
    { to: "ExponentPushToken[u1-phone]", ...u1Payload },
    { to: "ExponentPushToken[u1-tablet]", ...u1Payload },
    {
      to: "ExponentPushToken[u2-phone]",
      title: "期限が近い在庫が 1 件あります",
      body: "Jam 10/31",
      data: { type: "expiring_stocks", stockIds: [jam], more: 0 },
    },
  ]
  expect((calls[0] ?? []).toSorted(byTo)).toEqual(expected.toSorted(byTo))
})

test("does not call the sender when nobody is due", async () => {
  const u = await seedUser()
  await addToken(u, "ExponentPushToken[lonely]")
  const g = await seedGroupWithMembership(u)
  await seedStock(g, await seedItem(g), await seedLocation(g), 2, { bestBeforeDate: "2026-11-30" })

  const { sender, calls } = fakeSender()
  const result = await runExpiryNotify({ db: testDb, sender, today: TODAY })

  expect(result).toEqual({
    users: 0,
    messages: 0,
    sent: 0,
    failed: 0,
    errors: [],
    removedTokens: 0,
  })
  expect(calls).toHaveLength(0)
})

const seedDueUser = async (name: string, tokens: string[], bestBeforeDate = "2026-10-30") => {
  const u = await seedUser(name)
  await Promise.all(tokens.map((t) => addToken(u, t)))
  const g = await seedGroupWithMembership(u)
  await seedStock(g, await seedItem(g), await seedLocation(g), 2, { bestBeforeDate })
  return u
}

test("a second run on the same JST day sends nothing, the next day sends again", async () => {
  const u = await seedDueUser("u", ["ExponentPushToken[once]"])
  const { sender, calls } = fakeSender()

  const first = await runExpiryNotify({ db: testDb, sender, today: TODAY })
  const second = await runExpiryNotify({ db: testDb, sender, today: TODAY })
  const nextDay = await runExpiryNotify({ db: testDb, sender, today: "2026-10-26" })

  expect([first.messages, second.messages, nextDay.messages]).toEqual([1, 0, 1])
  expect(calls).toHaveLength(2)
  const [row] = await testDb.select().from(expiryNotifications)
  expect(row).toEqual({ userId: u, notifiedOn: "2026-10-26" })
})

test("a user whose every message failed is not marked notified and is retried by the next run", async () => {
  await seedDueUser("u", ["ExponentPushToken[flaky]"])
  const down = fakeSender(() => "MessageRateExceeded")
  const up = fakeSender()

  const failed = await runExpiryNotify({ db: testDb, sender: down.sender, today: TODAY })
  const retried = await runExpiryNotify({ db: testDb, sender: up.sender, today: TODAY })

  expect(failed).toMatchObject({ messages: 1, sent: 0, failed: 1 })
  expect(failed.errors).toEqual([{ to: "ExponentPushToken[flaky]", error: "MessageRateExceeded" }])
  expect(retried).toMatchObject({ messages: 1, sent: 1, failed: 0 })
  expect(await testDb.select().from(pushTokens)).toHaveLength(1)
})

test("deletes a token the ticket reports as DeviceNotRegistered and keeps the user's other devices", async () => {
  const u = await seedDueUser("u", [
    "ExponentPushToken[dead-phone]",
    "ExponentPushToken[live-tablet]",
  ])
  const other = await seedDueUser("other", ["ExponentPushToken[other-phone]"])
  const { sender } = fakeSender((m) =>
    m.to === "ExponentPushToken[dead-phone]" ? "DeviceNotRegistered" : undefined,
  )

  const result = await runExpiryNotify({ db: testDb, sender, today: TODAY })

  expect(result).toMatchObject({ messages: 3, sent: 2, failed: 1, removedTokens: 1 })
  const left = await testDb.select().from(pushTokens)
  expect(left.map((t) => t.token).toSorted()).toEqual([
    "ExponentPushToken[live-tablet]",
    "ExponentPushToken[other-phone]",
  ])
  expect((await testDb.select().from(expiryNotifications)).map((r) => r.userId).toSorted()).toEqual(
    [u, other].toSorted(),
  )
})

test("does not delete tokens for other errors", async () => {
  await seedDueUser("u", ["ExponentPushToken[big]"])
  const { sender } = fakeSender(() => "MessageTooBig")

  const result = await runExpiryNotify({ db: testDb, sender, today: TODAY })

  expect(result.removedTokens).toBe(0)
  expect(await testDb.select().from(pushTokens)).toHaveLength(1)
})

test("caps stockIds in the payload and reports the rest as more, keeping the message under 4096 bytes", async () => {
  const u = await seedUser("u")
  await addToken(u, "ExponentPushToken[many]")
  const g = await seedGroupWithMembership(u)
  const loc = await seedLocation(g)
  const ids = await Promise.all(
    Array.from({ length: 120 }, async (_, i) => {
      const day = String(25 + Math.floor(i / 40)).padStart(2, "0")
      const item = await seedItem(g, `Item ${String(i).padStart(3, "0")}`)
      return seedStock(g, item, loc, 1, { bestBeforeDate: `2026-10-${day}` })
    }),
  )
  const { sender, calls } = fakeSender()

  await runExpiryNotify({ db: testDb, sender, today: TODAY })

  const message = calls[0]![0]!
  expect(message.title).toBe("期限が近い在庫が 120 件あります")
  expect(message.data.stockIds).toEqual(ids.slice(0, 20))
  expect(message.data.more).toBe(100)
  expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThan(4096)
})

test("treats a soft-deleted notification_settings row as notifications turned off", async () => {
  const u = await seedDueUser("u", ["ExponentPushToken[ghost-settings]"])
  await setSettings(u, { days: 7 })
  await testDb.update(notificationSettings).set({ deletedAt: new Date() })
  const { sender, calls } = fakeSender()

  const result = await runExpiryNotify({ db: testDb, sender, today: TODAY })

  expect(result.messages).toBe(0)
  expect(calls).toHaveLength(0)
})

test("exits non-zero only when every message failed", () => {
  expect(exitCodeFor({ messages: 0, sent: 0 })).toBe(0)
  expect(exitCodeFor({ messages: 3, sent: 0 })).toBe(1)
  expect(exitCodeFor({ messages: 3, sent: 1 })).toBe(0)
  expect(exitCodeFor({ messages: 3, sent: 3 })).toBe(0)
})
