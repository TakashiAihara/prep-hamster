import { z } from "zod"
import { Id, TimestampedFields } from "../common"

export const GroupSchema = z.object({
  id: Id,
  name: z.string().min(1),
  createdBy: Id,
  ...TimestampedFields,
})
export type Group = z.infer<typeof GroupSchema>
