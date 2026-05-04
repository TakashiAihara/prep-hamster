import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import type { AppEnv } from "../app"

// v1.0.0 では `x-user-id` ヘッダで stub 認証する。
// Supabase Auth (Bearer JWT) への置き換え時はこの 1 ファイルを差し替える。
export const withUserAuth = createMiddleware<AppEnv>(async (c, next) => {
  const userId = c.req.header("x-user-id")
  if (!userId) {
    throw new HTTPException(401, { message: "x-user-id header required" })
  }
  c.set("userId", userId)
  await next()
})
