import { z } from "zod"
import { Id, TimestampedFields } from "../common"

export const ShoppingListSourceSchema = z.enum(["AUTO", "MANUAL"])
export type ShoppingListSource = z.infer<typeof ShoppingListSourceSchema>

export const ShoppingListStatusSchema = z.enum(["OPEN", "BOUGHT", "CANCELLED"])
export type ShoppingListStatus = z.infer<typeof ShoppingListStatusSchema>

export const ShoppingListItemSchema = z.object({
  id: Id,
  groupId: Id,
  itemId: Id.nullable(),
  name: z.string().min(1),
  quantity: z.number().nonnegative(),
  unit: z.string().nullable(),
  source: ShoppingListSourceSchema,
  status: ShoppingListStatusSchema,
  addedBy: Id,
  ...TimestampedFields,
})
export type ShoppingListItem = z.infer<typeof ShoppingListItemSchema>
