import { Hono } from "hono"
import type { Db } from "@prep-hamster/db"
import { stocksRouter } from "./routes/stocks"

export type AppEnv = {
  Variables: {
    db: Db
    userId: string
  }
}

export function createApp(opts: { db: Db }) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("db", opts.db)
      await next()
    })
    .get("/health", (c) => c.json({ ok: true as const }))
    .use("/v1/*", async (c, next) => {
      const userId = c.req.header("x-user-id")
      if (!userId) {
        return c.json({ error: "x-user-id header required" }, 401)
      }
      c.set("userId", userId)
      await next()
    })
    .route("/v1/stocks", stocksRouter)
}

export type AppType = ReturnType<typeof createApp>
