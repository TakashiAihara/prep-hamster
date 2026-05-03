import { z } from "zod"
import { Id, TimestampedFields } from "../common"

export const ItemSchema = z.object({
  id: Id,
  groupId: Id,
  productMasterId: Id.nullable(),
  name: z.string().min(1),
  barcode: z.string().nullable(),
  categoryId: Id.nullable(),
  defaultUnit: z.string().nullable(),
  manufacturer: z.string().nullable(),
  memo: z.string().nullable(),
  ...TimestampedFields,
})
export type Item = z.infer<typeof ItemSchema>
