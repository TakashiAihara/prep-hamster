import { z } from "zod"
import { Id, TimestampedFields } from "../common"

export const PerCategoryRequirementSchema = z.object({
  minQuantity: z.number().nonnegative(),
  unit: z.string().nullable(),
  coefficient: z.number().nullable(),
})
export type PerCategoryRequirement = z.infer<typeof PerCategoryRequirementSchema>

export const RequirementSettingSchema = z.object({
  id: Id,
  groupId: Id,
  peopleCount: z.number().int().positive(),
  days: z.number().int().positive(),
  perCategorySettings: z.record(z.string(), PerCategoryRequirementSchema).nullable(),
  ...TimestampedFields,
})
export type RequirementSetting = z.infer<typeof RequirementSettingSchema>
