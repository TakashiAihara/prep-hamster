import { sql } from "drizzle-orm"
import { testDb } from "./setup"

// 別の接続で在庫の行を FOR UPDATE で押さえ、release で放して commit まで待つ
export async function holdStockRow(stockId: string) {
  const held = Promise.withResolvers<void>()
  const taken = Promise.withResolvers<void>()
  const locker = testDb.transaction(async (tx) => {
    await tx.execute(sql`select id from stocks where id = ${stockId} for update`)
    taken.resolve()
    await held.promise
  })
  await taken.promise
  return {
    release: async () => {
      held.resolve()
      await locker
    },
  }
}

export async function waitForLockWaiters(count: number) {
  // 待ちの数が揃うまで順に見に行くポーリングなので、ループの中で待つ
  for (let i = 0; i < 100; i++) {
    // oxlint-disable-next-line no-await-in-loop
    const rows = (await testDb.execute(
      // 共有の Postgres なので、この DB で在庫を更新しようとして待っている要求だけを数える
      sql`select count(*)::int as n from pg_stat_activity
          where wait_event_type = 'Lock' and datname = current_database()
            and query ilike 'update "stocks"%'`,
    )) as unknown as Array<{ n: number }>
    if ((rows[0]?.n ?? 0) >= count) return
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`lock waiters did not reach ${count}`)
}
