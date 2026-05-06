import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, count, eq, isNull, ne } from "drizzle-orm"
import { memberships } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { withGroupAccess } from "../middleware/group-access"
import {
  errorResponseSchema,
  membershipDtoSchema,
  updateMembershipRoleBodyDtoSchema,
} from "./schemas"

const GroupAndUserParamSchema = z.object({
  groupId: z
    .string()
    .uuid()
    .openapi({ param: { name: "groupId", in: "path" } }),
  userId: z
    .string()
    .uuid()
    .openapi({ param: { name: "userId", in: "path" } }),
})

const GroupParamSchema = z.object({
  groupId: z
    .string()
    .uuid()
    .openapi({ param: { name: "groupId", in: "path" } }),
})

const toMembershipDto = (
  row: typeof memberships.$inferSelect,
): z.infer<typeof membershipDtoSchema> => ({
  id: row.id,
  userId: row.userId,
  groupId: row.groupId,
  role: row.role,
  joinedAt: row.joinedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
})

const listMembershipsRoute = createRoute({
  method: "get",
  path: "/groups/{groupId}/memberships",
  tags: ["memberships"],
  summary: "group の member 一覧 (member 全員に open)",
  middleware: [withGroupAccess((c) => c.req.param("groupId"))] as const,
  request: { params: GroupParamSchema },
  responses: {
    200: {
      description: "member 一覧",
      content: {
        "application/json": {
          schema: z.object({ memberships: z.array(membershipDtoSchema) }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "未参加",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const patchMembershipRoute = createRoute({
  method: "patch",
  path: "/groups/{groupId}/memberships/{userId}",
  tags: ["memberships"],
  summary: "メンバーの role を変更 (OWNER のみ、自分の OWNER 剥奪不可)",
  middleware: [withGroupAccess((c) => c.req.param("groupId"), "OWNER")] as const,
  request: {
    params: GroupAndUserParamSchema,
    body: { content: { "application/json": { schema: updateMembershipRoleBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "更新成功",
      content: {
        "application/json": {
          schema: z.object({ membership: membershipDtoSchema }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "OWNER でない / 未参加",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "対象メンバーが存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "ボディ不正 / 自分の OWNER 剥奪を試行",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const deleteMembershipRoute = createRoute({
  method: "delete",
  path: "/groups/{groupId}/memberships/{userId}",
  tags: ["memberships"],
  summary: "メンバーを削除 (OWNER のみ、最後の OWNER は削除不可)",
  middleware: [withGroupAccess((c) => c.req.param("groupId"), "OWNER")] as const,
  request: { params: GroupAndUserParamSchema },
  responses: {
    204: { description: "削除成功" },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "OWNER でない / 未参加",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "対象メンバーが存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "最後の OWNER の削除試行",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const membershipsRouter = new OpenAPIHono<AppEnv>()
  .openapi(listMembershipsRoute, async (c) => {
    const { groupId } = c.req.valid("param")
    const db = c.get("db")

    const rows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, groupId), isNull(memberships.deletedAt)))

    return c.json({ memberships: rows.map(toMembershipDto) }, 200)
  })
  .openapi(patchMembershipRoute, async (c) => {
    const { groupId, userId } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const currentUserId = c.get("userId")

    const [target] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.groupId, groupId),
          eq(memberships.userId, userId),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1)
    if (!target) {
      return c.json({ error: { code: "NOT_FOUND", message: "対象メンバーが見つかりません" } }, 404)
    }

    // 自分自身を OWNER から降格させると group が orphan 化するリスクがあるため、
    // 自身の OWNER 剥奪のみ拒否する。他者の昇格・降格は OK。
    if (target.userId === currentUserId && target.role === "OWNER" && body.role !== "OWNER") {
      return c.json(
        {
          error: {
            code: "SELF_OWNER_DEMOTE",
            message: "自分自身の OWNER 権限は剥奪できません",
          },
        },
        422,
      )
    }

    const [updated] = await db
      .update(memberships)
      .set({ role: body.role, updatedAt: new Date() })
      .where(
        and(
          eq(memberships.groupId, groupId),
          eq(memberships.userId, userId),
          isNull(memberships.deletedAt),
        ),
      )
      .returning()
    if (!updated) {
      throw new Error("membership update returned no row")
    }

    return c.json({ membership: toMembershipDto(updated) }, 200)
  })
  .openapi(deleteMembershipRoute, async (c) => {
    const { groupId, userId } = c.req.valid("param")
    const db = c.get("db")

    const [target] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.groupId, groupId),
          eq(memberships.userId, userId),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1)
    if (!target) {
      return c.json({ error: { code: "NOT_FOUND", message: "対象メンバーが見つかりません" } }, 404)
    }

    // 削除対象が OWNER の場合、削除後に少なくとも 1 名 OWNER が残ることを保証する。
    // 同 tx 内に置かないのは race の影響が「最後の OWNER が並行で抜ける」レアケースに限定され、
    // 実害は再 invite で復旧可能なため。厳密性が必要なら SERIALIZABLE iso か行ロックで補強する。
    if (target.role === "OWNER") {
      const rows = await db
        .select({ remaining: count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.groupId, groupId),
            eq(memberships.role, "OWNER"),
            ne(memberships.userId, userId),
            isNull(memberships.deletedAt),
          ),
        )
      // SQL の COUNT は常に 1 行返す (空集合でも { count: 0 })
      const remaining = rows[0]?.remaining ?? 0
      if (remaining === 0) {
        return c.json(
          {
            error: {
              code: "LAST_OWNER",
              message: "最後の OWNER は削除できません",
            },
          },
          422,
        )
      }
    }

    const now = new Date()
    await db
      .update(memberships)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(memberships.groupId, groupId),
          eq(memberships.userId, userId),
          isNull(memberships.deletedAt),
        ),
      )

    return c.body(null, 204)
  })
