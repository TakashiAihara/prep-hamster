import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

export type Db = ReturnType<typeof createDb>

// max は接続数の上限 (既定は driver の既定)。接続を握ったままの処理をテストで見つけるために絞れるようにしてある
export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const client = postgres(databaseUrl, options)
  return drizzle(client, { schema })
}
