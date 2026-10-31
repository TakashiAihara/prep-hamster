import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, desc, eq, isNull, notInArray } from "drizzle-orm"
import { pushTokens, users } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { errorResponseSchema, jsonBodyErrorResponses } from "./schemas"

const bodySchema = z.object({
  token: z
    .string()
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,200}\]$/)
    .openapi({ example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }),
})

const MAX_TOKENS_PER_USER = 10

const registerRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["push-tokens"],
  summary: "端末の Expo push token を登録 (同じ token は current user に付け替え)",
  description:
    "クライアントの契約: サインアウト時に必ず DELETE /v1/push-tokens で自分の token を消すこと。" +
    "消さないと、その端末に前のユーザーの在庫通知が次の登録まで届く。" +
    "他のユーザーが持っている token を登録すると、その token は呼び出したユーザーに付け替わる (共有端末で別ユーザーがログインする場合の想定)。" +
    "1 ユーザーあたり最大 10 件で、11 件目を登録すると updated_at が最も古い token が削除される。",
  request: { body: { content: { "application/json": { schema: bodySchema } } } },
  responses: {
    ...jsonBodyErrorResponses,
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
      description: "user が存在しない (論理削除済みを含む)",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
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
    ...jsonBodyErrorResponses,
    204: { description: "削除済み" },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
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

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    if (!user) {
      return c.json({ error: { code: "NOT_FOUND", message: "user が見つかりません" } }, 404)
    }

    // 付け替え (他ユーザーの token の登録) は仕様。サインアウト時の DELETE はクライアントの責務 (route の description 参照)。
    const now = new Date()
    await db
      .insert(pushTokens)
      .values({ id: crypto.randomUUID(), userId, token, updatedAt: now })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, updatedAt: now } })

    // 偽の token を大量に登録されても毎日の送信枠を食わせないよう、更新が新しい順に MAX_TOKENS_PER_USER 件だけ残す。
    const keep = await db
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(eq(pushTokens.userId, userId))
      .orderBy(desc(pushTokens.updatedAt), desc(pushTokens.createdAt))
      .limit(MAX_TOKENS_PER_USER)
    await db.delete(pushTokens).where(
      and(
        eq(pushTokens.userId, userId),
        notInArray(
          pushTokens.id,
          keep.map((r) => r.id),
        ),
      ),
    )

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
