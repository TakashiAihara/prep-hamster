import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { groups, memberships } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import {
  createGroupBodyDtoSchema,
  errorResponseSchema,
  groupDtoSchema,
  membershipDtoSchema,
  updateGroupBodyDtoSchema,
} from "./schemas"

const IdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
})

const toGroupDto = (row: typeof groups.$inferSelect): z.infer<typeof groupDtoSchema> => ({
  id: row.id,
  name: row.name,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
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

const listGroupsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["groups"],
  summary: "current user が所属する group 一覧",
  responses: {
    200: {
      description: "所属 group 一覧",
      content: {
        "application/json": {
          schema: z.object({ groups: z.array(groupDtoSchema) }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const createGroupRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["groups"],
  summary: "group を作成し、作成者を OWNER として membership 追加",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createGroupBodyDtoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "作成成功",
      content: {
        "application/json": {
          schema: z.object({
            group: groupDtoSchema,
            membership: membershipDtoSchema,
          }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "ボディ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const getGroupRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["groups"],
  summary: "group 単件取得（member のみ）",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "取得成功",
      content: {
        "application/json": {
          schema: z.object({ group: groupDtoSchema }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "未参加 or 存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const patchGroupRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["groups"],
  summary: "group の名前変更（OWNER のみ）",
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: updateGroupBodyDtoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "更新成功",
      content: {
        "application/json": {
          schema: z.object({ group: groupDtoSchema }),
        },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "OWNER でない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "未参加 or 存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "ボディ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const groupsRouter = new OpenAPIHono<AppEnv>()
  .openapi(listGroupsRoute, async (c) => {
    const db = c.get("db")
    const userId = c.get("userId")

    const memberRows = await db
      .select({ groupId: memberships.groupId })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), isNull(memberships.deletedAt)))

    if (memberRows.length === 0) {
      return c.json({ groups: [] }, 200)
    }

    const rows = await db
      .select()
      .from(groups)
      .where(
        and(
          inArray(
            groups.id,
            memberRows.map((m) => m.groupId),
          ),
          isNull(groups.deletedAt),
        ),
      )

    return c.json({ groups: rows.map(toGroupDto) }, 200)
  })
  .openapi(createGroupRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const now = new Date()
    const result = await db.transaction(async (tx) => {
      const [createdGroup] = await tx
        .insert(groups)
        .values({
          id: crypto.randomUUID(),
          name: body.name,
          createdBy: userId,
        })
        .returning()
      if (!createdGroup) {
        throw new Error("group insert returned no row")
      }

      const [createdMembership] = await tx
        .insert(memberships)
        .values({
          id: crypto.randomUUID(),
          userId,
          groupId: createdGroup.id,
          role: "OWNER",
          joinedAt: now,
        })
        .returning()
      if (!createdMembership) {
        throw new Error("membership insert returned no row")
      }

      return { group: createdGroup, membership: createdMembership }
    })

    return c.json(
      {
        group: toGroupDto(result.group),
        membership: toMembershipDto(result.membership),
      },
      201,
    )
  })
  .openapi(getGroupRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [member] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.groupId, id),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1)

    if (!member) {
      return c.json({ error: { code: "NOT_FOUND", message: "group が見つかりません" } }, 404)
    }

    const [row] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
      .limit(1)

    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "group が見つかりません" } }, 404)
    }

    return c.json({ group: toGroupDto(row) }, 200)
  })
  .openapi(patchGroupRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [member] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.groupId, id),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1)

    if (!member) {
      return c.json({ error: { code: "NOT_FOUND", message: "group が見つかりません" } }, 404)
    }
    if (member.role !== "OWNER") {
      return c.json({ error: { code: "FORBIDDEN", message: "OWNER のみ更新できます" } }, 403)
    }

    const [row] = await db
      .update(groups)
      .set({ name: body.name, updatedAt: new Date() })
      .where(and(eq(groups.id, id), isNull(groups.deletedAt)))
      .returning()

    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "group が見つかりません" } }, 404)
    }

    return c.json({ group: toGroupDto(row) }, 200)
  })
