import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm"
import { items, locations, memberships, stockEvents, stocks } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { checkGroupAccess, withGroupAccess } from "../middleware/group-access"
import {
  createStockBodyDtoSchema,
  errorResponseSchema,
  stockDtoSchema,
  stockEventDtoSchema,
  stockMoveBodyDtoSchema,
  stockQuantityDeltaBodyDtoSchema,
  updateStockBodyDtoSchema,
} from "./schemas"

const IdParamSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
})

// `?includeExpired=true` のように文字列で来るため、boolean は文字列パース後に変換する。
const booleanQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .openapi({ type: "boolean" })

const ListQuerySchema = z.object({
  groupId: z.string().uuid().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
  categoryId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  expiringBefore: z.string().date().optional(),
  includeExpired: booleanQuery.optional(),
})

// drizzle 行を API DTO 形式 (timestamp は ISO string、id は plain UUID) に変換
const toStockDto = (row: typeof stocks.$inferSelect): z.infer<typeof stockDtoSchema> => ({
  id: row.id,
  groupId: row.groupId,
  itemId: row.itemId,
  locationId: row.locationId,
  quantity: row.quantity,
  unit: row.unit,
  useByDate: row.useByDate,
  bestBeforeDate: row.bestBeforeDate,
  openedAt: row.openedAt,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
})

const toStockEventDto = (
  row: typeof stockEvents.$inferSelect,
): z.infer<typeof stockEventDtoSchema> => ({
  id: row.id,
  groupId: row.groupId,
  stockId: row.stockId,
  eventType: row.eventType,
  quantityDelta: row.quantityDelta,
  fromLocationId: row.fromLocationId,
  toLocationId: row.toLocationId,
  occurredAt: row.occurredAt.toISOString(),
  actorUserId: row.actorUserId,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
})

const listStocksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["stocks"],
  summary: "在庫一覧を取得 (categoryId / locationId / 期限で絞り込み可)",
  middleware: [withGroupAccess((c) => c.req.query("groupId"))] as const,
  request: {
    query: ListQuerySchema,
  },
  responses: {
    200: {
      description: "在庫一覧 (useByDate ASC NULLS LAST, bestBeforeDate ASC NULLS LAST)",
      content: {
        "application/json": {
          schema: z.object({ stocks: z.array(stockDtoSchema) }),
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

const getStockRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["stocks"],
  summary: "在庫を 1 件取得",
  request: { params: IdParamSchema },
  responses: {
    200: {
      description: "取得成功",
      content: {
        "application/json": {
          schema: z.object({ stock: stockDtoSchema }),
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
    404: {
      description: "存在しない",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const patchStockRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["stocks"],
  summary: "在庫の属性を部分更新 (EDITOR 以上、quantity は対象外)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: updateStockBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "更新成功",
      content: {
        "application/json": {
          schema: z.object({ stock: stockDtoSchema }),
        },
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
      description: "ボディ不正 (quantity を含む / 移動先 location が group 外)",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const createStockRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["stocks"],
  summary: "在庫を 1 件作成",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createStockBodyDtoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "作成成功",
      content: {
        "application/json": {
          schema: z.object({ stock: stockDtoSchema }),
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
      description: "ボディ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const consumeStockRoute = createRoute({
  method: "post",
  path: "/{id}/consume",
  tags: ["stocks"],
  summary: "在庫を消費 (EDITOR 以上)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: stockQuantityDeltaBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "消費成功",
      content: {
        "application/json": {
          schema: z.object({ stock: stockDtoSchema, event: stockEventDtoSchema }),
        },
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
      description: "数量不正 (delta 負 / 結果が負)",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const discardStockRoute = createRoute({
  method: "post",
  path: "/{id}/discard",
  tags: ["stocks"],
  summary: "在庫を廃棄 (EDITOR 以上)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: stockQuantityDeltaBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "廃棄成功",
      content: {
        "application/json": {
          schema: z.object({ stock: stockDtoSchema, event: stockEventDtoSchema }),
        },
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
      description: "数量不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const moveStockRoute = createRoute({
  method: "post",
  path: "/{id}/move",
  tags: ["stocks"],
  summary: "在庫の保管場所を移動 (EDITOR 以上)",
  request: {
    params: IdParamSchema,
    body: { content: { "application/json": { schema: stockMoveBodyDtoSchema } } },
  },
  responses: {
    200: {
      description: "移動成功",
      content: {
        "application/json": {
          schema: z.object({ stock: stockDtoSchema, event: stockEventDtoSchema }),
        },
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
      description: "toLocationId が同じ group ではない / 同 location への移動",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

const deleteStockRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["stocks"],
  summary: "在庫を soft delete (EDITOR 以上)",
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
  },
})

export const stocksRouter = new OpenAPIHono<AppEnv>()
  .openapi(listStocksRoute, async (c) => {
    const { groupId, categoryId, locationId, expiringBefore, includeExpired } = c.req.valid("query")
    const db = c.get("db")

    // YYYY-MM-DD 文字列で比較するため、PG 上の DATE 列に対しても辞書順 = 日付順で正しく動く。
    const today = new Date().toISOString().slice(0, 10)

    const conditions = [eq(stocks.groupId, groupId), isNull(stocks.deletedAt)]
    if (locationId) {
      conditions.push(eq(stocks.locationId, locationId))
    }
    if (expiringBefore) {
      // 「いずれかの期限日が指定日以前」= useByDate <= X OR bestBeforeDate <= X
      const expiringCond = or(
        lte(stocks.useByDate, expiringBefore),
        lte(stocks.bestBeforeDate, expiringBefore),
      )
      if (expiringCond) conditions.push(expiringCond)
    }
    if (!includeExpired) {
      // 既に期限切れ (useByDate or bestBeforeDate <= today) のものを除外。
      // null は期限が無いので残す。
      const notExpired = and(
        or(isNull(stocks.useByDate), sql`${stocks.useByDate} > ${today}`),
        or(isNull(stocks.bestBeforeDate), sql`${stocks.bestBeforeDate} > ${today}`),
      )
      if (notExpired) conditions.push(notExpired)
    }

    const baseQuery = db
      .select({ stock: stocks })
      .from(stocks)
      // categoryId は items 経由で絞る。filter 無しでも JOIN すると stocks 列に影響するため、
      // categoryId 指定時のみ JOIN を追加する。
      .$dynamic()

    const query = categoryId
      ? baseQuery
          .innerJoin(items, eq(stocks.itemId, items.id))
          .where(and(...conditions, eq(items.categoryId, categoryId)))
      : baseQuery.where(and(...conditions))

    const rows = await query.orderBy(
      sql`${stocks.useByDate} ASC NULLS LAST`,
      sql`${stocks.bestBeforeDate} ASC NULLS LAST`,
      asc(stocks.createdAt),
    )

    return c.json({ stocks: rows.map((r) => toStockDto(r.stock)) }, 200)
  })
  .openapi(getStockRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "stock が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId)
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    return c.json({ stock: toStockDto(existing) }, 200)
  })
  .openapi(patchStockRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "stock が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    // locationId 変更を PATCH で許容するが、move エンドポイントとは違い stock_events への
    // MOVE 記録は行わない (PATCH は属性訂正系。物理移動は /move を使うこと)。
    // ただし group をまたいだ location は弾く。
    if (body.locationId && body.locationId !== existing.locationId) {
      const [toLoc] = await db
        .select({ groupId: locations.groupId })
        .from(locations)
        .where(and(eq(locations.id, body.locationId), isNull(locations.deletedAt)))
        .limit(1)
      if (!toLoc || toLoc.groupId !== existing.groupId) {
        return c.json(
          {
            error: {
              code: "LOCATION_GROUP_MISMATCH",
              message: "locationId が同じ group の active な location ではありません",
            },
          },
          422,
        )
      }
    }

    const now = new Date()
    const [updated] = await db
      .update(stocks)
      .set({
        ...(body.locationId !== undefined && { locationId: body.locationId }),
        ...(body.unit !== undefined && { unit: body.unit }),
        ...(body.useByDate !== undefined && { useByDate: body.useByDate }),
        ...(body.bestBeforeDate !== undefined && { bestBeforeDate: body.bestBeforeDate }),
        ...(body.openedAt !== undefined && { openedAt: body.openedAt }),
        ...(body.note !== undefined && { note: body.note }),
        updatedAt: now,
      })
      .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      .returning()
    if (!updated) {
      throw new Error("stock update returned no row")
    }

    return c.json({ stock: toStockDto(updated) }, 200)
  })
  .openapi(createStockRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    // body.groupId の membership は middleware では検査できないため (body 読込のタイミング)、
    // ここで明示的にチェックする。本検査の middleware 化は別 Issue (#69 後続) で扱う。
    const [member] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.groupId, body.groupId),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1)
    if (!member) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN_GROUP_ACCESS",
            message: "この group に対するアクセス権がありません",
          },
        },
        403,
      )
    }

    const [created] = await db
      .insert(stocks)
      .values({
        id: crypto.randomUUID(),
        groupId: body.groupId,
        itemId: body.itemId,
        locationId: body.locationId,
        quantity: body.quantity,
        unit: body.unit,
        useByDate: body.useByDate,
        bestBeforeDate: body.bestBeforeDate,
        openedAt: body.openedAt,
        note: body.note,
      })
      .returning()

    if (!created) {
      throw new Error("insert returned no row")
    }
    return c.json({ stock: toStockDto(created) }, 201)
  })
  .openapi(consumeStockRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "stock が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const newQty = existing.quantity - body.quantityDelta
    if (newQty < 0) {
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_QUANTITY",
            message: `在庫数量 ${existing.quantity} に対して消費量 ${body.quantityDelta} が大きすぎます`,
          },
        },
        422,
      )
    }

    // quantity 更新 + stock_events 追加を 1 transaction で原子化。
    // 失敗時に片方だけ反映されるのを防ぐ。
    const result = await db.transaction(async (tx) => {
      const now = new Date()
      const [updated] = await tx
        .update(stocks)
        .set({ quantity: newQty, updatedAt: now })
        .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
        .returning()
      if (!updated) {
        throw new Error("stock update returned no row")
      }
      const [event] = await tx
        .insert(stockEvents)
        .values({
          id: crypto.randomUUID(),
          groupId: existing.groupId,
          stockId: id,
          eventType: "CONSUME",
          // 集計を SUM(quantityDelta) で取れるよう、CONSUME は負値で記録
          quantityDelta: -body.quantityDelta,
          fromLocationId: null,
          toLocationId: null,
          occurredAt: now,
          actorUserId: userId,
          reason: body.reason ?? null,
        })
        .returning()
      if (!event) {
        throw new Error("stock_event insert returned no row")
      }
      return { stock: updated, event }
    })

    return c.json({ stock: toStockDto(result.stock), event: toStockEventDto(result.event) }, 200)
  })
  .openapi(discardStockRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "stock が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    const newQty = existing.quantity - body.quantityDelta
    if (newQty < 0) {
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_QUANTITY",
            message: `在庫数量 ${existing.quantity} に対して廃棄量 ${body.quantityDelta} が大きすぎます`,
          },
        },
        422,
      )
    }

    const result = await db.transaction(async (tx) => {
      const now = new Date()
      const [updated] = await tx
        .update(stocks)
        .set({ quantity: newQty, updatedAt: now })
        .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
        .returning()
      if (!updated) {
        throw new Error("stock update returned no row")
      }
      const [event] = await tx
        .insert(stockEvents)
        .values({
          id: crypto.randomUUID(),
          groupId: existing.groupId,
          stockId: id,
          eventType: "DISCARD",
          quantityDelta: -body.quantityDelta,
          fromLocationId: null,
          toLocationId: null,
          occurredAt: now,
          actorUserId: userId,
          reason: body.reason ?? null,
        })
        .returning()
      if (!event) {
        throw new Error("stock_event insert returned no row")
      }
      return { stock: updated, event }
    })

    return c.json({ stock: toStockDto(result.stock), event: toStockEventDto(result.event) }, 200)
  })
  .openapi(moveStockRoute, async (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "stock が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    if (body.toLocationId === existing.locationId) {
      return c.json(
        {
          error: {
            code: "MOVE_NOOP",
            message: "移動先が現在の locationId と同じです",
          },
        },
        422,
      )
    }

    // 移動先 location が同じ group に属することを検証する。
    // location が deletedAt なら移動先として不正なので除外。
    const [toLoc] = await db
      .select({ groupId: locations.groupId })
      .from(locations)
      .where(and(eq(locations.id, body.toLocationId), isNull(locations.deletedAt)))
      .limit(1)
    if (!toLoc || toLoc.groupId !== existing.groupId) {
      return c.json(
        {
          error: {
            code: "LOCATION_GROUP_MISMATCH",
            message: "toLocationId が同じ group の active な location ではありません",
          },
        },
        422,
      )
    }

    const result = await db.transaction(async (tx) => {
      const now = new Date()
      const [updated] = await tx
        .update(stocks)
        .set({ locationId: body.toLocationId, updatedAt: now })
        .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
        .returning()
      if (!updated) {
        throw new Error("stock update returned no row")
      }
      const [event] = await tx
        .insert(stockEvents)
        .values({
          id: crypto.randomUUID(),
          groupId: existing.groupId,
          stockId: id,
          eventType: "MOVE",
          // MOVE は数量変動なし
          quantityDelta: 0,
          fromLocationId: existing.locationId,
          toLocationId: body.toLocationId,
          occurredAt: now,
          actorUserId: userId,
          reason: body.reason ?? null,
        })
        .returning()
      if (!event) {
        throw new Error("stock_event insert returned no row")
      }
      return { stock: updated, event }
    })

    return c.json({ stock: toStockDto(result.stock), event: toStockEventDto(result.event) }, 200)
  })
  .openapi(deleteStockRoute, async (c) => {
    const { id } = c.req.valid("param")
    const db = c.get("db")
    const userId = c.get("userId")

    const [existing] = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      .limit(1)
    if (!existing) {
      return c.json({ error: { code: "NOT_FOUND", message: "stock が見つかりません" } }, 404)
    }

    const access = await checkGroupAccess(db, userId, existing.groupId, "EDITOR")
    if (!access.ok) {
      return c.json(access.body, access.status)
    }

    // soft delete + 残数量を DISCARD として 1 件 stock_event に残すことで、
    // 過去の集計 (SUM(quantityDelta)) で「いま 0」を再現できる。
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(stocks)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(stocks.id, id), isNull(stocks.deletedAt)))
      // 残数量があるなら DISCARD イベントを残す。0 ならイベントは作らない。
      if (existing.quantity > 0) {
        await tx.insert(stockEvents).values({
          id: crypto.randomUUID(),
          groupId: existing.groupId,
          stockId: id,
          eventType: "DISCARD",
          quantityDelta: -existing.quantity,
          fromLocationId: null,
          toLocationId: null,
          occurredAt: now,
          actorUserId: userId,
          reason: "soft-delete",
        })
      }
    })

    return c.body(null, 204)
  })
