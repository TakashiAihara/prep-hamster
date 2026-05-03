import { z } from "zod"
import { Id, TimestampedFields } from "../common"

export const NotificationSettingSchema = z.object({
  id: Id,
  userId: Id,
  expiringNotifyEnabled: z.boolean(),
  expiringDaysBefore: z.number().int().min(1).max(30),
  expiredNotifyEnabled: z.boolean(),
  shortageNotifyEnabled: z.boolean(),
  invitationNotifyEnabled: z.boolean(),
  pushToken: z.string().nullable(),
  ...TimestampedFields,
})
export type NotificationSetting = z.infer<typeof NotificationSettingSchema>
