import { z } from "zod"

export const Id = z.string().uuid()
export type Id = z.infer<typeof Id>

export const Timestamp = z.string().datetime({ offset: true })
export type Timestamp = z.infer<typeof Timestamp>

export const DateOnly = z.string().date()
export type DateOnly = z.infer<typeof DateOnly>

export const TimestampedFields = {
  createdAt: Timestamp,
  updatedAt: Timestamp,
  deletedAt: Timestamp.nullable(),
}

export const RoleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"])
export type Role = z.infer<typeof RoleSchema>
