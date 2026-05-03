import { z } from "zod"
import { Id, Timestamp, TimestampedFields, RoleSchema } from "../common"

export const InvitationSchema = z.object({
  id: Id,
  groupId: Id,
  inviterId: Id,
  role: RoleSchema,
  token: z.string(),
  expiresAt: Timestamp,
  usedAt: Timestamp.nullable(),
  usedBy: Id.nullable(),
  ...TimestampedFields,
})
export type Invitation = z.infer<typeof InvitationSchema>
