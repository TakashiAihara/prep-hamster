import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq, isNull } from "drizzle-orm"
import { categories, items } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { checkGroupAccess, withGroupAccess } from "../middleware/group-access"
import {
  categoryDtoSchema,
  createCategoryBodyDtoSchema,
  errorResponseSchema,
  updateCategoryBodyDtoSchema,
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

const toCategoryDto = (row: typeof categories.$inferSelect): z.infer<typeof categoryDtoSchema> => ({
  id: row.id,
  groupId: row.groupId,
  name: row.name,
  sortOrder: row.sortOrder,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
})

const listCategoriesRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["categories"],
  summary: "group 単位で category 一覧",
  middleware: [withGroupAccess((c) => c.req.query("groupId"))] as const,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: "一覧",
      content: {
        "application/json": {
          schema: z.object({ categories: z.array(categoryDtoSchema) }),
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

const createCategoryRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["categories"],
  summary: "category を作成 (EDITOR 以上)",
  request: {
    body: { content: { "application/json": { schema: createCategoryBodyDtoSchema } } },
  },
  responses: {
    201: {
      description: "作成成功",
      content: {
        "application/json": { schema: z.object({ category: categoryDtoSchema }) },
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

const getCategoryRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["categories"],
  summary: "category 単件取得",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "取得成功",
      content: {
        "application/json": { schema: z.object({ category: categoryDtoSchema }) },
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

const patchCategoryRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["categories"],
  summary: "category を更新 (EDITOR 以上)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: updateCategoryBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "更新成功",
      content: {
        "application/json": { schema: z.object({ category: categoryDtoSchema }) },
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

const deleteCategoryRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["categories"],
  summary: "category を soft delete (EDITOR 以上)",
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
      description: "子 item が参照中",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const categoriesRouter = new OpenAPIHono<AppEnv>()
  .openapi(listCategoriesRoute, async (c) => {
    const { groupId } = c.req.valid("query")
    const db = c.get("db")

    const rows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.groupId, groupId), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sortOrder), asc(categories.name))

    return c.json({ categories: rows.map(toCategoryDto) }, 200)
  })
  .openapi(createCategoryRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const access = await checkGroupAccess(db, userId, body.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const [created] = await db
      .insert(categories)
      .values({
        id: crypto.randomUUID(),
        groupId: body.groupId,
        name: body.name,
        sortOrder: body.sortOrder ?? null,
      })
      .returning()
    if (!created) {
      throw new Error("category insert returned no row")
    }
    return c.json({ category: toCategoryDto(created) }, 201)
  })
  .openapi(getCategoryRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [row] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .limit(1)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "category が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, row.groupId)
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    return c.json({ category: toCategoryDto(row) }, 200)
  })
  .openapi(patchCategoryRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "category が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const updates: Partial<typeof categories.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) updates.name = body.name
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder

    const [row] = await db
      .update(categories)
      .set(updates)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .returning()
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "category が見つかりません" } }, 404)
    }
    return c.json({ category: toCategoryDto(row) }, 200)
  })
  .openapi(deleteCategoryRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "category が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const [referencingItem] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.categoryId, id), isNull(items.deletedAt)))
      .limit(1)
    if (referencingItem) {
      return c.json(
        {
          error: {
            code: "CATEGORY_IN_USE",
            message: "この category を参照している item が存在するため削除できません",
          },
        },
        422,
      )
    }

    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))

    return c.body(null, 204)
  })
