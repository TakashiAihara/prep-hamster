import { z } from "zod"
import { Id, Timestamp } from "../common"

export const StockEventTypeSchema = z.enum([
  "ADD",
  "CONSUME",
  "DISCARD",
  "MOVE",
  "EDIT",
])
export type StockEventType = z.infer<typeof StockEventTypeSchema>

export const StockEventSchema = z.object({
  id: Id,
  groupId: Id,
  stockId: Id,
  eventType: StockEventTypeSchema,
  quantityDelta: z.number(),
  fromLocationId: Id.nullable(),
  toLocationId: Id.nullable(),
  occurredAt: Timestamp,
  actorUserId: Id.nullable(),
  reason: z.string().nullable(),
  createdAt: Timestamp,
})
export type StockEvent = z.infer<typeof StockEventSchema>
