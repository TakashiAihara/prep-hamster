import { z } from "@hono/zod-openapi"

// API I/O 用 DTO スキーマ。drizzle-zod 由来の row schema は branded type を含むが、
// HTTP I/O 層では plain string で十分なため API 専用に切り出す。
// branded type は内部ロジック (誤った id を渡さない) で使い、境界では plain UUID。

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string().openapi({ example: "リクエストの形式が不正です" }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ApiError")

export const roleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]).openapi("Role")

export const groupDtoSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Group")

export const membershipDtoSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    groupId: z.string().uuid(),
    role: roleSchema,
    joinedAt: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Membership")

export const createGroupBodyDtoSchema = z
  .object({
    name: z.string().min(1).max(100),
  })
  .openapi("CreateGroupBody")

export const updateGroupBodyDtoSchema = z
  .object({
    name: z.string().min(1).max(100),
  })
  .openapi("UpdateGroupBody")

export const stockDtoSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid(),
    itemId: z.string().uuid(),
    locationId: z.string().uuid(),
    quantity: z.number().nonnegative(),
    unit: z.string(),
    useByDate: z.string().date().nullable(),
    bestBeforeDate: z.string().date().nullable(),
    openedAt: z.string().date().nullable(),
    note: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Stock")

export const createStockBodyDtoSchema = z
  .object({
    groupId: z.string().uuid(),
    itemId: z.string().uuid(),
    locationId: z.string().uuid(),
    quantity: z.number().nonnegative(),
    unit: z.string().min(1),
    useByDate: z.string().date().nullable(),
    bestBeforeDate: z.string().date().nullable(),
    openedAt: z.string().date().nullable(),
    note: z.string().nullable(),
  })
  .openapi("CreateStockBody")
