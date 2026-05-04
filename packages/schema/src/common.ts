import { z } from "zod"

// API I/F の共通プリミティブ。row schema (drizzle-zod 生成) では型が DB ネイティブ
// (Date など) で来るため、HTTP I/O と区別するためにここに集約する。

export const Id = z.string().uuid()
export type Id = z.infer<typeof Id>

export const TimestampString = z.string().datetime({ offset: true })
export type TimestampString = z.infer<typeof TimestampString>

export const DateOnly = z.string().date()
export type DateOnly = z.infer<typeof DateOnly>

export const RoleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"])
export type Role = z.infer<typeof RoleSchema>
