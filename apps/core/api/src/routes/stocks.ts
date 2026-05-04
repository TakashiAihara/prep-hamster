import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { and, eq, isNull } from "drizzle-orm"
import { stocks } from "@prep-hamster/db"
import type { AppEnv } from "../app"
import { createStockBodyDtoSchema, errorResponseSchema, stockDtoSchema } from "./schemas"

const ListQuerySchema = z.object({
  groupId: z.string().uuid().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
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

const listStocksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["stocks"],
  summary: "在庫一覧を取得",
  request: {
    query: ListQuerySchema,
  },
  responses: {
    200: {
      description: "在庫一覧",
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
    422: {
      description: "クエリ不正",
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
    422: {
      description: "ボディ不正",
      content: { "application/json": { schema: errorResponseSchema } },
    },
  },
})

export const stocksRouter = new OpenAPIHono<AppEnv>()
  .openapi(listStocksRoute, async (c) => {
    const { groupId } = c.req.valid("query")
    const db = c.get("db")

    const rows = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.groupId, groupId), isNull(stocks.deletedAt)))

    return c.json({ stocks: rows.map(toStockDto) }, 200)
  })
  .openapi(createStockRoute, async (c) => {
    const body = c.req.valid("json")
    const db = c.get("db")

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
