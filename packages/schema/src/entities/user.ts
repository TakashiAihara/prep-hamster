import { z } from "zod"
import { Id, TimestampedFields } from "../common"

export const UserSchema = z.object({
  id: Id,
  email: z.string().email(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  locale: z.string(),
  ...TimestampedFields,
})
export type User = z.infer<typeof UserSchema>
