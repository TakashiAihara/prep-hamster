import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq } from "drizzle-orm"
import { pushTokens, users } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { errorResponseSchema } from "./schemas"

const bodySchema = z.object({
  token: z
    .string()
    .regex(/^Expo(nent)?PushToken\[.+\]$/)
    .openapi({ example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }),
})

const registerRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["push-tokens"],
  summary: "端末の Expo push token を登録 (同じ token は current user に付け替え)",
  request: { body: { content: { "application/json": { schema: bodySchema } } } },
  responses: {
    200: {
      description: "登録成功",
      content: {
        "application/json": { schema: z.object({ pushToken: z.object({ token: z.string() }) }) },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "user が存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    400: {
      description: "token の形式不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const removeRoute = createRoute({
  method: "delete",
  path: "/",
  tags: ["push-tokens"],
  summary: "current user の push token を削除 (無ければ何もしない)",
  request: { body: { content: { "application/json": { schema: bodySchema } } } },
  responses: {
    204: { description: "削除済み" },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    400: {
      description: "token の形式不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const pushTokensRouter = new OpenAPIHono<AppEnv>()
  .openapi(registerRoute, async (c) => {
    const { token } = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId))
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "user が見つかりません" } }, 404)
    }

    await db
      .insert(pushTokens)
      .values({ id: crypto.randomUUID(), userId, token })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, updatedAt: new Date() } })

    return c.json({ pushToken: { token } }, 200)
  })
  .openapi(removeRoute, async (c) => {
    const { token } = c.req.valid("json")
    await c
      .get("db")
      .delete(pushTokens)
      .where(and(eq(pushTokens.token, token), eq(pushTokens.userId, c.get("userId"))))
    return c.body(null, 204)
  })
