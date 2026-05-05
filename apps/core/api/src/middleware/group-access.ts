import type { Context } from "hono"
import { createMiddleware } from "hono/factory"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import { memberships } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import type { ApiErrorBody } from "./error"

// 全 groupId-scoped endpoint で「current user がその group の member であること」を強制する。
// 個別 route の handler から DB アクセス権チェックを取り除き、漏れを防ぐ。

export type Role = "OWNER" | "EDITOR" | "VIEWER"

// 上位 role が下位 role の権限を包含する: OWNER > EDITOR > VIEWER
const ROLE_RANK: Record<Role, number> = { OWNER: 3, EDITOR: 2, VIEWER: 1 }

export type Membership = typeof memberships.$inferSelect

export type GroupAccessEnv = {
  Variables: AppEnv["Variables"] & { membership: Membership }
}

export type ExtractGroupId = (c: Context) => string | undefined

const uuidSchema = z.string().uuid()

export const withGroupAccess = (extractGroupId: ExtractGroupId, requiredRole?: Role) =>
  createMiddleware<AppEnv & GroupAccessEnv>(async (c, next) => {
    const groupId = extractGroupId(c)
    if (!groupId || !uuidSchema.safeParse(groupId).success) {
      return c.json<ApiErrorBody>(
        {
          error: {
            code: "BAD_REQUEST",
            message: "有効な groupId が必要です",
          },
        },
        400,
      )
    }

    const userId = c.get("userId")
    const db = c.get("db")

    const [member] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.groupId, groupId),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1)

    if (!member) {
      return c.json<ApiErrorBody>(
        {
          error: {
            code: "FORBIDDEN_GROUP_ACCESS",
            message: "この group に対するアクセス権がありません",
          },
        },
        403,
      )
    }

    if (requiredRole && ROLE_RANK[member.role as Role] < ROLE_RANK[requiredRole]) {
      return c.json<ApiErrorBody>(
        {
          error: {
            code: "INSUFFICIENT_ROLE",
            message: `${requiredRole} 以上の権限が必要です`,
          },
        },
        403,
      )
    }

    c.set("membership", member)
    await next()
    return
  })
