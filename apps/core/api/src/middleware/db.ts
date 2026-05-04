import { createMiddleware } from "hono/factory"
import type { Db } from "@prep-hamster/db"
import type { AppEnv } from "../app"

// `c.set("db", ...)` を 1 箇所に集約。テスト/本番で同じ middleware を使い、
// 注入する Db インスタンスだけ差し替える。
export const withDb = (db: Db) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set("db", db)
    await next()
  })
