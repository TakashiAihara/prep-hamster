import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq, isNull } from "drizzle-orm"
import { locations, stocks } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { checkGroupAccess, withGroupAccess } from "../middleware/group-access"
import {
  createLocationBodyDtoSchema,
  errorResponseSchema,
  locationDtoSchema,
  updateLocationBodyDtoSchema,
} from "./schemas"

const IdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
})

const ListQuerySchema = z.object({
  groupId: z.string().uuid().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
})

const toLocationDto = (row: typeof locations.$inferSelect): z.infer<typeof locationDtoSchema> => ({
  id: row.id,
  groupId: row.groupId,
  name: row.name,
  sortOrder: row.sortOrder,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
})

const listLocationsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["locations"],
  summary: "group 単位で location 一覧",
  middleware: [withGroupAccess((c) => c.req.query("groupId"))] as const,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: "一覧",
      content: {
        "application/json": {
          schema: z.object({ locations: z.array(locationDtoSchema) }),
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
    422: {
      description: "クエリ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const createLocationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["locations"],
  summary: "location を作成 (EDITOR 以上)",
  request: {
    body: { content: { "application/json": { schema: createLocationBodyDtoSchema } } },
  },
  responses: {
    201: {
      description: "作成成功",
      content: {
        "application/json": { schema: z.object({ location: locationDtoSchema }) },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "未参加 / role 不足",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "ボディ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const getLocationRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["locations"],
  summary: "location 単件取得",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "取得成功",
      content: {
        "application/json": { schema: z.object({ location: locationDtoSchema }) },
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
    404: {
      description: "存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const patchLocationRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["locations"],
  summary: "location を更新 (EDITOR 以上)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: updateLocationBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "更新成功",
      content: {
        "application/json": { schema: z.object({ location: locationDtoSchema }) },
      },
    },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "未参加 / role 不足",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "ボディ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const deleteLocationRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["locations"],
  summary: "location を soft delete (EDITOR 以上)",
  request: { params: IdParamSchema },
  responses: {
    204: { description: "削除成功" },
    401: {
      description: "未認証",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    403: {
      description: "未参加 / role 不足",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    404: {
      description: "存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
    422: {
      description: "子 stock が参照中",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const locationsRouter = new OpenAPIHono<AppEnv>()
  .openapi(listLocationsRoute, async (c) => {
    const { groupId } = c.req.valid("query")
    const db = c.get("db")

    const rows = await db
      .select()
      .from(locations)
      .where(and(eq(locations.groupId, groupId), isNull(locations.deletedAt)))
      .orderBy(asc(locations.sortOrder), asc(locations.name))

    return c.json({ locations: rows.map(toLocationDto) }, 200)
  })
  .openapi(createLocationRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const access = await checkGroupAccess(db, userId, body.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const [created] = await db
      .insert(locations)
      .values({
        id: crypto.randomUUID(),
        groupId: body.groupId,
        name: body.name,
        sortOrder: body.sortOrder ?? null,
      })
      .returning()
    if (!created) {
      throw new Error("location insert returned no row")
    }
    return c.json({ location: toLocationDto(created) }, 201)
  })
  .openapi(getLocationRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [row] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
      .limit(1)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "location が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, row.groupId)
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    return c.json({ location: toLocationDto(row) }, 200)
  })
  .openapi(patchLocationRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "location が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const updates: Partial<typeof locations.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) updates.name = body.name
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder

    const [row] = await db
      .update(locations)
      .set(updates)
      .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
      .returning()
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "location が見つかりません" } }, 404)
    }
    return c.json({ location: toLocationDto(row) }, 200)
  })
  .openapi(deleteLocationRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(locations)
      .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "location が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    // 子 stock が参照していたら 422 (cascade ルールは v1.0.0 では「参照ありなら blocked」に統一)
    const [referencingStock] = await db
      .select({ id: stocks.id })
      .from(stocks)
      .where(and(eq(stocks.locationId, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (referencingStock) {
      return c.json(
        {
          error: {
            code: "LOCATION_IN_USE",
            message: "この location を参照している stock が存在するため削除できません",
          },
        },
        422,
      )
    }

    await db
      .update(locations)
      .set({ deletedAt: new Date() })
      .where(and(eq(locations.id, id), isNull(locations.deletedAt)))

    return c.body(null, 204)
  })
