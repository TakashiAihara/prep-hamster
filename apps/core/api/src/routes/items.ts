import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq, isNull } from "drizzle-orm"
import { categories, items, stocks } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { checkGroupAccess, withGroupAccess } from "../middleware/group-access"
import {
  createItemBodyDtoSchema,
  errorResponseSchema,
  itemDtoSchema,
  updateItemBodyDtoSchema,
} from "./schemas"

const IdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
})

const ListQuerySchema = z.object({
  groupId: z.string().uuid().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
  categoryId: z.string().uuid().optional(),
  barcode: z.string().optional(),
})

const toItemDto = (row: typeof items.$inferSelect): z.infer<typeof itemDtoSchema> => ({
  id: row.id,
  groupId: row.groupId,
  productMasterId: row.productMasterId,
  name: row.name,
  barcode: row.barcode,
  categoryId: row.categoryId,
  defaultUnit: row.defaultUnit,
  manufacturer: row.manufacturer,
  memo: row.memo,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
})

// categoryId が同じ group に属するか検証する。null なら check 不要。
async function assertCategoryInGroup(
  db: AppEnv["Variables"]["db"],
  categoryId: string | null | undefined,
  groupId: string,
): Promise<true | { code: string; message: string }> {
  if (!categoryId) return true
  const [row] = await db
    .select({ groupId: categories.groupId })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
    .limit(1)
  if (!row || row.groupId !== groupId) {
    return {
      code: "CATEGORY_GROUP_MISMATCH",
      message: "categoryId が同じ group に属していません",
    }
  }
  return true
}

// 同じ groupId + barcode の active item が既にいないか確認する。
// DB 側にも `(group_id, barcode) WHERE product_master_id IS NULL AND barcode IS NOT NULL`
// の uniqueIndex があるが、明示的に事前 check してわかりやすい 422 を返す。
async function findDuplicateBarcode(
  db: AppEnv["Variables"]["db"],
  groupId: string,
  barcode: string,
  excludeItemId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.groupId, groupId),
        eq(items.barcode, barcode),
        isNull(items.productMasterId),
        isNull(items.deletedAt),
      ),
    )
    .limit(2)
  return rows.some((r) => r.id !== excludeItemId)
}

const listItemsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["items"],
  summary: "group 単位で item 一覧 (categoryId / barcode 絞り込み可)",
  middleware: [withGroupAccess((c) => c.req.query("groupId"))] as const,
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: "一覧",
      content: {
        "application/json": { schema: z.object({ items: z.array(itemDtoSchema) }) },
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

const createItemRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["items"],
  summary: "item を手動作成 (EDITOR 以上)",
  request: {
    body: { content: { "application/json": { schema: createItemBodyDtoSchema } } },
  },
  responses: {
    201: {
      description: "作成成功",
      content: {
        "application/json": { schema: z.object({ item: itemDtoSchema }) },
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
      description: "ボディ不正 / barcode 重複 / category 不整合",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const getItemRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["items"],
  summary: "item 単件取得",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "取得成功",
      content: {
        "application/json": { schema: z.object({ item: itemDtoSchema }) },
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

const patchItemRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["items"],
  summary: "item を更新 (EDITOR 以上)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: updateItemBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "更新成功",
      content: {
        "application/json": { schema: z.object({ item: itemDtoSchema }) },
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
      description: "ボディ不正 / barcode 重複 / category 不整合",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const deleteItemRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["items"],
  summary: "item を soft delete (EDITOR 以上)",
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
      description: "active stock が参照中",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const itemsRouter = new OpenAPIHono<AppEnv>()
  .openapi(listItemsRoute, async (c) => {
    const { groupId, categoryId, barcode } = c.req.valid("query")
    const db = c.get("db")

    const conditions = [eq(items.groupId, groupId), isNull(items.deletedAt)]
    if (categoryId) conditions.push(eq(items.categoryId, categoryId))
    if (barcode) conditions.push(eq(items.barcode, barcode))

    const rows = await db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(asc(items.name))

    return c.json({ items: rows.map(toItemDto) }, 200)
  })
  .openapi(createItemRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const access = await checkGroupAccess(db, userId, body.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const categoryCheck = await assertCategoryInGroup(db, body.categoryId, body.groupId)
    if (categoryCheck !== true) {
      return c.json({ error: categoryCheck }, 422)
    }

    if (body.barcode) {
      const dup = await findDuplicateBarcode(db, body.groupId, body.barcode)
      if (dup) {
        return c.json(
          {
            error: {
              code: "ITEM_BARCODE_DUPLICATE",
              message: "同じ group に同じ barcode の item が既に存在します",
            },
          },
          422,
        )
      }
    }

    const [created] = await db
      .insert(items)
      .values({
        id: crypto.randomUUID(),
        groupId: body.groupId,
        productMasterId: null,
        name: body.name,
        barcode: body.barcode ?? null,
        categoryId: body.categoryId ?? null,
        defaultUnit: body.defaultUnit ?? null,
        manufacturer: body.manufacturer ?? null,
        memo: body.memo ?? null,
      })
      .returning()
    if (!created) {
      throw new Error("item insert returned no row")
    }
    return c.json({ item: toItemDto(created) }, 201)
  })
  .openapi(getItemRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [row] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1)
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "item が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, row.groupId)
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    return c.json({ item: toItemDto(row) }, 200)
  })
  .openapi(patchItemRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "item が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    if (body.categoryId !== undefined) {
      const categoryCheck = await assertCategoryInGroup(db, body.categoryId, existing.groupId)
      if (categoryCheck !== true) {
        return c.json({ error: categoryCheck }, 422)
      }
    }

    // barcode を変更/設定するなら同 group 内の重複を防ぐ。productMaster 紐付け済みの
    // item は uniqueIndex のスコープ外だが、本 endpoint では productMasterId は
    // 触らないので productMasterId IS NULL の item 同士の衝突だけ気にすれば十分。
    if (body.barcode !== undefined && body.barcode !== null && existing.productMasterId == null) {
      const dup = await findDuplicateBarcode(db, existing.groupId, body.barcode, id)
      if (dup) {
        return c.json(
          {
            error: {
              code: "ITEM_BARCODE_DUPLICATE",
              message: "同じ group に同じ barcode の item が既に存在します",
            },
          },
          422,
        )
      }
    }

    const updates: Partial<typeof items.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) updates.name = body.name
    if (body.categoryId !== undefined) updates.categoryId = body.categoryId
    if (body.defaultUnit !== undefined) updates.defaultUnit = body.defaultUnit
    if (body.manufacturer !== undefined) updates.manufacturer = body.manufacturer
    if (body.memo !== undefined) updates.memo = body.memo
    if (body.barcode !== undefined) updates.barcode = body.barcode

    const [row] = await db
      .update(items)
      .set(updates)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .returning()
    if (!row) {
      return c.json({ error: { code: "NOT_FOUND", message: "item が見つかりません" } }, 404)
    }
    return c.json({ item: toItemDto(row) }, 200)
  })
  .openapi(deleteItemRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "item が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const [referencingStock] = await db
      .select({ id: stocks.id })
      .from(stocks)
      .where(and(eq(stocks.itemId, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (referencingStock) {
      return c.json(
        {
          error: {
            code: "ITEM_IN_USE",
            message: "この item を参照している active な stock が存在するため削除できません",
          },
        },
        422,
      )
    }

    await db
      .update(items)
      .set({ deletedAt: new Date() })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))

    return c.body(null, 204)
  })
