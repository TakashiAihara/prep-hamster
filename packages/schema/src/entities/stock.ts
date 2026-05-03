import { z } from "zod"
import { Id, DateOnly, TimestampedFields } from "../common"

export const StockSchema = z.object({
  id: Id,
  groupId: Id,
  itemId: Id,
  locationId: Id,
  quantity: z.number().nonnegative(),
  unit: z.string(),
  useByDate: DateOnly.nullable(),
  bestBeforeDate: DateOnly.nullable(),
  openedAt: DateOnly.nullable(),
  note: z.string().nullable(),
  ...TimestampedFields,
})
export type Stock = z.infer<typeof StockSchema>
