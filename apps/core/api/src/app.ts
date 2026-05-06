import { OpenAPIHono } from "@hono/zod-openapi"
import { Scalar } from "@scalar/hono-api-reference"
import type { Db } from "@prep-hamster/db"
import { createJanApiClient, type JanApiClient } from "@prep-hamster/jan-api"
import { withUserAuth } from "./middleware/auth"
import { withDb } from "./middleware/db"
import { onError } from "./middleware/error"
import { categoriesRouter } from "./routes/categories"
import { groupsRouter } from "./routes/groups"
import { itemsRouter } from "./routes/items"
import { locationsRouter } from "./routes/locations"
import { stocksRouter } from "./routes/stocks"

export type AppEnv = {
  Variables: {
    db: Db
    userId: string
    janApi: JanApiClient
  }
}

export type CreateAppOptions = {
  db: Db
  // 消費者は JanApiClient interface のみに依存。
  // 未指定なら env (YAHOO_SHOPPING_APP_ID) ベースの default chain を使う。
  janApi?: JanApiClient
}

export function createApp(opts: CreateAppOptions) {
  const app = new OpenAPIHono<AppEnv>()
  const janApi = opts.janApi ?? createJanApiClient()

  app.onError(onError)
  app.use("*", withDb(opts.db))
  app.use("*", async (c, next) => {
    c.set("janApi", janApi)
    await next()
  })
  app.use("/v1/*", withUserAuth)

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "prep-hamster API",
      version: "0.0.0",
      description: "備蓄管理アプリのバックエンド API",
    },
    servers: [{ url: "http://localhost:3000", description: "local dev" }],
  })

  app.get("/docs", Scalar({ url: "/openapi.json", theme: "default" }))

  // route 定義をチェイン化することで `hc<typeof app>` が
  // 全 endpoint を型として認識できるようにする。
  return app
    .get("/health", (c) => c.json({ ok: true as const }))
    .route("/v1/groups", groupsRouter)
    .route("/v1/locations", locationsRouter)
    .route("/v1/categories", categoriesRouter)
    .route("/v1/items", itemsRouter)
    .route("/v1/stocks", stocksRouter)
}

export type AppType = ReturnType<typeof createApp>
