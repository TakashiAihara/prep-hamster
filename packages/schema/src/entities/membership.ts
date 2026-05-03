import { z } from "zod"
import { Id, Timestamp, TimestampedFields, RoleSchema } from "../common"

export const MembershipSchema = z.object({
  id: Id,
  userId: Id,
  groupId: Id,
  role: RoleSchema,
  joinedAt: Timestamp,
  ...TimestampedFields,
})
export type Membership = z.infer<typeof MembershipSchema>
