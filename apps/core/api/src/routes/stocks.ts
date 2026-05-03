import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { stocks } from "@prep-hamster/db"
import { StockSchema } from "@prep-hamster/schema"
import type { AppEnv } from "../app"

const ListQuerySchema = z.object({
  groupId: z.string().uuid(),
})

const CreateStockBodySchema = StockSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
})

export const stocksRouter = new Hono<AppEnv>()
  .get("/", zValidator("query", ListQuerySchema), async (c) => {
    const { groupId } = c.req.valid("query")
    const db = c.get("db")

    const rows = await db
      .select()
      .from(stocks)
      .where(and(eq(stocks.groupId, groupId), isNull(stocks.deletedAt)))

    return c.json({ stocks: rows })
  })
  .post("/", zValidator("json", CreateStockBodySchema), async (c) => {
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

    return c.json({ stock: created }, 201)
  })
