import { beforeAll, beforeEach, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import {
  items,
  memberships,
  notificationSettings,
  pushTokens,
  stocks,
  groups,
} from "@prep-hamster/db"
import { runExpiryNotify, type PushMessage, type PushSender } from "../src/jobs/expiry-notify"
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

const fakeSender = () => {
  const calls: PushMessage[][] = []
  const sender: PushSender = {
    send: async (messages) => {
      calls.push(messages)
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

  expect(result).toEqual({ users: 2, messages: 3 })
  expect(calls).toHaveLength(1)
  const u1Payload: Omit<PushMessage, "to"> = {
    title: "期限が近い在庫が 5 件あります",
    body: "Tea 10/25、Water 10/27、Pasta 10/28 ほか2件",
    data: { type: "expiring_stocks", stockIds: [tea, water, pasta, oats, rice] },
  }
  const expected: PushMessage[] = [
    { to: "ExponentPushToken[u1-phone]", ...u1Payload },
    { to: "ExponentPushToken[u1-tablet]", ...u1Payload },
    {
      to: "ExponentPushToken[u2-phone]",
      title: "期限が近い在庫が 1 件あります",
      body: "Jam 10/31",
      data: { type: "expiring_stocks", stockIds: [jam] },
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

  expect(result).toEqual({ users: 0, messages: 0 })
  expect(calls).toHaveLength(0)
})
