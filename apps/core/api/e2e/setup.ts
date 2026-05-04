import { sql } from "drizzle-orm"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { createDb } from "@prep-hamster/db"

const TEST_DB_URL =
  process.env["TEST_DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_FOLDER = resolve(here, "../../../../packages/db/drizzle")

export const testDb = createDb(TEST_DB_URL)

let migratePromise: Promise<void> | null = null

export function ensureMigrated(): Promise<void> {
  if (!migratePromise) {
    migratePromise = migrate(testDb, { migrationsFolder: MIGRATIONS_FOLDER }).catch((err) => {
      migratePromise = null
      throw err
    })
  }
  return migratePromise
}

export async function truncateAll() {
  await testDb.execute(sql`
    TRUNCATE TABLE
      stock_events,
      stocks,
      items,
      locations,
      categories,
      product_masters,
      shopping_list_items,
      requirement_settings,
      invitations,
      memberships,
      notification_settings,
      groups,
      users
    RESTART IDENTITY CASCADE
  `)
}
