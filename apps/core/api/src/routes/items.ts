import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq, isNull } from "drizzle-orm"
import { categories, items, productMasters, stocks } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { checkGroupAccess, withGroupAccess } from "../middleware/group-access"
import {
  createItemBodyDtoSchema,
  errorResponseSchema,
  itemByBarcodeBodyDtoSchema,
  itemByBarcodeResponseDtoSchema,
  itemDtoSchema,
  productMasterDtoSchema,
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

const toProductMasterDto = (
  row: typeof productMasters.$inferSelect,
): z.infer<typeof productMasterDtoSchema> => ({
  id: row.id,
  jan: row.jan,
  name: row.name,
  manufacturer: row.manufacturer,
  brand: row.brand,
  contentAmount: row.contentAmount,
  contentUnit: row.contentUnit,
  categoryHint: row.categoryHint,
  imageUrl: row.imageUrl,
  source: row.source,
  confidence: row.confidence,
  fetchedAt: row.fetchedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
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

// Postgres unique violation (SQLSTATE 23505) かを判定する。
// 事前 check と INSERT/UPDATE の間に race が発生した場合の最終防衛で使う。
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  )
}

const BARCODE_DUPLICATE_RESPONSE = {
  error: {
    code: "ITEM_BARCODE_DUPLICATE",
    message: "同じ group に同じ barcode の item が既に存在します",
  },
} as const

async function loadProductMaster(
  db: AppEnv["Variables"]["db"],
  productMasterId: string,
): Promise<typeof productMasters.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(productMasters)
    .where(and(eq(productMasters.id, productMasterId), isNull(productMasters.deletedAt)))
    .limit(1)
  return row ?? null
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

const itemByBarcodeRoute = createRoute({
  method: "post",
  path: "/by-barcode",
  tags: ["items"],
  summary: "barcode から item を find-or-create (EDITOR 以上)",
  request: {
    body: { content: { "application/json": { schema: itemByBarcodeBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "既存 item を返却",
      content: {
        "application/json": { schema: itemByBarcodeResponseDtoSchema },
      },
    },
    201: {
      description: "外部 lookup hit / miss いずれかで新規作成",
      content: {
        "application/json": { schema: itemByBarcodeResponseDtoSchema },
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
        return c.json(BARCODE_DUPLICATE_RESPONSE, 422)
      }
    }

    try {
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
    } catch (err) {
      // 並行リクエストで事前 check を双方通過した場合に DB の uniqueIndex で 23505。
      // 500 として扱わずユーザーに 422 ITEM_BARCODE_DUPLICATE で返す。
      if (isUniqueViolation(err)) {
        return c.json(BARCODE_DUPLICATE_RESPONSE, 422)
      }
      throw err
    }
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
        return c.json(BARCODE_DUPLICATE_RESPONSE, 422)
      }
    }

    const updates: Partial<typeof items.$inferInsert> = { updatedAt: new Date() }
    if (body.name !== undefined) updates.name = body.name
    if (body.categoryId !== undefined) updates.categoryId = body.categoryId
    if (body.defaultUnit !== undefined) updates.defaultUnit = body.defaultUnit
    if (body.manufacturer !== undefined) updates.manufacturer = body.manufacturer
    if (body.memo !== undefined) updates.memo = body.memo
    if (body.barcode !== undefined) updates.barcode = body.barcode

    try {
      const [row] = await db
        .update(items)
        .set(updates)
        .where(and(eq(items.id, id), isNull(items.deletedAt)))
        .returning()
      if (!row) {
        return c.json({ error: { code: "NOT_FOUND", message: "item が見つかりません" } }, 404)
      }
      return c.json({ item: toItemDto(row) }, 200)
    } catch (err) {
      if (isUniqueViolation(err)) {
        return c.json(BARCODE_DUPLICATE_RESPONSE, 422)
      }
      throw err
    }
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

    // PATCH と同様 updatedAt も touch する。差分同期 / キャッシュ無効化が
    // updatedAt を見るクライアントから論理削除を検知できるようにするため。
    const now = new Date()
    await db
      .update(items)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(items.id, id), isNull(items.deletedAt)))

    return c.body(null, 204)
  })
  .openapi(itemByBarcodeRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")
    const janApi = c.get("janApi")

    const access = await checkGroupAccess(db, userId, body.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    // 1. 既存 item 検索: 同じ group + barcode で active な item があれば再利用。
    //    productMasterId の有無は問わない (手動入力 / バーコード経路の両方を拾う)。
    const [existingItem] = await db
      .select()
      .from(items)
      .where(
        and(
          eq(items.groupId, body.groupId),
          eq(items.barcode, body.barcode),
          isNull(items.deletedAt),
        ),
      )
      .limit(1)

    if (existingItem) {
      const productMaster = existingItem.productMasterId
        ? await loadProductMaster(db, existingItem.productMasterId)
        : null
      return c.json(
        {
          item: toItemDto(existingItem),
          productMaster: productMaster ? toProductMasterDto(productMaster) : null,
          productLookup: "existing" as const,
        },
        200,
      )
    }

    // 2. 外部 lookup。null ならフォールバック (placeholder で進む)。
    const candidate = await janApi.lookup(body.barcode)

    if (!candidate) {
      const [created] = await db
        .insert(items)
        .values({
          id: crypto.randomUUID(),
          groupId: body.groupId,
          productMasterId: null,
          // 外部 lookup miss 時は barcode をそのまま name に置く placeholder。
          // ユーザーが後で PATCH で書き換える前提。
          name: body.barcode,
          barcode: body.barcode,
          categoryId: null,
          defaultUnit: null,
          manufacturer: null,
          memo: null,
        })
        .returning()
      if (!created) {
        throw new Error("item insert (placeholder) returned no row")
      }
      return c.json(
        {
          item: toItemDto(created),
          productMaster: null,
          productLookup: "miss" as const,
        },
        201,
      )
    }

    // 3. lookup hit: productMaster を upsert (jan UNIQUE) してから item insert。
    //    同じ JAN を別 group が先に登録していれば既存 master を再利用する。
    //    fetchedAt と confidence / 各メタは最新 lookup 結果で更新する。
    const [pm] = await db
      .insert(productMasters)
      .values({
        id: crypto.randomUUID(),
        jan: candidate.jan,
        name: candidate.name,
        manufacturer: candidate.manufacturer,
        brand: candidate.brand,
        contentAmount: candidate.contentAmount,
        contentUnit: candidate.contentUnit,
        categoryHint: candidate.categoryHint,
        imageUrl: candidate.imageUrl,
        source: candidate.source,
        sourceRaw: candidate.sourceRaw,
        confidence: candidate.confidence,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: productMasters.jan,
        set: {
          name: candidate.name,
          manufacturer: candidate.manufacturer,
          brand: candidate.brand,
          contentAmount: candidate.contentAmount,
          contentUnit: candidate.contentUnit,
          categoryHint: candidate.categoryHint,
          imageUrl: candidate.imageUrl,
          source: candidate.source,
          sourceRaw: candidate.sourceRaw,
          confidence: candidate.confidence,
          fetchedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning()
    if (!pm) {
      throw new Error("productMaster upsert returned no row")
    }

    const [createdItem] = await db
      .insert(items)
      .values({
        id: crypto.randomUUID(),
        groupId: body.groupId,
        productMasterId: pm.id,
        // item の name / manufacturer は productMaster からコピーして group 内で
        // 上書き可能にする (data-model.md 準拠: items はプロジェクト内の overrides 層)。
        name: candidate.name,
        barcode: body.barcode,
        categoryId: null,
        defaultUnit: null,
        manufacturer: candidate.manufacturer,
        memo: null,
      })
      .returning()
    if (!createdItem) {
      throw new Error("item insert (hit) returned no row")
    }

    return c.json(
      {
        item: toItemDto(createdItem),
        productMaster: toProductMasterDto(pm),
        productLookup: "hit" as const,
      },
      201,
    )
  })
