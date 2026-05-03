import { z } from "zod"
import { Id, TimestampedFields } from "../common"

export const LocationSchema = z.object({
  id: Id,
  groupId: Id,
  name: z.string().min(1),
  sortOrder: z.number().int().nullable(),
  ...TimestampedFields,
})
export type Location = z.infer<typeof LocationSchema>
