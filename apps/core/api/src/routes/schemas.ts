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

export const locationDtoSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid(),
    name: z.string(),
    sortOrder: z.number().int().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Location")

export const createLocationBodyDtoSchema = z
  .object({
    groupId: z.string().uuid(),
    name: z.string().min(1).max(100),
    sortOrder: z.number().int().nullable().optional(),
  })
  .openapi("CreateLocationBody")

export const updateLocationBodyDtoSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    sortOrder: z.number().int().nullable().optional(),
  })
  .openapi("UpdateLocationBody")

export const categoryDtoSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid(),
    name: z.string(),
    sortOrder: z.number().int().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Category")

export const createCategoryBodyDtoSchema = z
  .object({
    groupId: z.string().uuid(),
    name: z.string().min(1).max(100),
    sortOrder: z.number().int().nullable().optional(),
  })
  .openapi("CreateCategoryBody")

export const updateCategoryBodyDtoSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    sortOrder: z.number().int().nullable().optional(),
  })
  .openapi("UpdateCategoryBody")

export const itemDtoSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid(),
    productMasterId: z.string().uuid().nullable(),
    name: z.string(),
    barcode: z.string().nullable(),
    categoryId: z.string().uuid().nullable(),
    defaultUnit: z.string().nullable(),
    manufacturer: z.string().nullable(),
    memo: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Item")

export const productMasterDtoSchema = z
  .object({
    id: z.string().uuid(),
    jan: z.string(),
    name: z.string(),
    manufacturer: z.string().nullable(),
    brand: z.string().nullable(),
    contentAmount: z.number().nullable(),
    contentUnit: z.string().nullable(),
    categoryHint: z.string().nullable(),
    imageUrl: z.string().nullable(),
    source: z.enum(["YAHOO_SHOPPING", "RAKUTEN_ICHIBA", "JANCODE_LOOKUP", "GS1_JICFS", "OTHER"]),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable(),
    fetchedAt: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("ProductMaster")

export const itemByBarcodeBodyDtoSchema = z
  .object({
    groupId: z.string().uuid(),
    barcode: z.string().min(1).max(64),
  })
  .openapi("ItemByBarcodeBody")

export const itemByBarcodeResponseDtoSchema = z
  .object({
    item: itemDtoSchema,
    productMaster: productMasterDtoSchema.nullable(),
    productLookup: z.enum(["existing", "hit", "miss"]),
  })
  .openapi("ItemByBarcodeResponse")

// 手動入力では productMasterId は指定不可（バーコード経路で別途自動紐付け）
export const createItemBodyDtoSchema = z
  .object({
    groupId: z.string().uuid(),
    name: z.string().min(1).max(200),
    categoryId: z.string().uuid().nullable().optional(),
    defaultUnit: z.string().min(1).max(50).nullable().optional(),
    manufacturer: z.string().max(200).nullable().optional(),
    memo: z.string().max(2000).nullable().optional(),
    barcode: z.string().min(1).max(64).nullable().optional(),
  })
  .openapi("CreateItemBody")

export const updateItemBodyDtoSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    defaultUnit: z.string().min(1).max(50).nullable().optional(),
    manufacturer: z.string().max(200).nullable().optional(),
    memo: z.string().max(2000).nullable().optional(),
    barcode: z.string().min(1).max(64).nullable().optional(),
  })
  .openapi("UpdateItemBody")

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

// quantity は consume / move / discard / soft-delete 経由で履歴を残しつつ更新する方針のため、
// PATCH では受け付けない。.strict() で未知キー (quantity を含む) を 422 で reject する。
export const updateStockBodyDtoSchema = z
  .object({
    locationId: z.string().uuid().optional(),
    unit: z.string().min(1).optional(),
    useByDate: z.string().date().nullable().optional(),
    bestBeforeDate: z.string().date().nullable().optional(),
    openedAt: z.string().date().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .strict()
  .openapi("UpdateStockBody")

export const stockEventDtoSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid(),
    stockId: z.string().uuid(),
    eventType: z.enum(["ADD", "CONSUME", "DISCARD", "MOVE", "EDIT"]),
    quantityDelta: z.number(),
    fromLocationId: z.string().uuid().nullable(),
    toLocationId: z.string().uuid().nullable(),
    occurredAt: z.string().datetime({ offset: true }),
    actorUserId: z.string().uuid().nullable(),
    reason: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .openapi("StockEvent")

// 数量変動 (consume / discard) の body。quantityDelta は **削減量を正で** 渡す。
// stock_events には `-quantityDelta` を保存することで集計時の SUM 整合を保つ。
export const stockQuantityDeltaBodyDtoSchema = z
  .object({
    quantityDelta: z.number().positive(),
    reason: z.string().max(500).nullable().optional(),
  })
  .openapi("StockQuantityDeltaBody")

export const stockMoveBodyDtoSchema = z
  .object({
    toLocationId: z.string().uuid(),
    reason: z.string().max(500).nullable().optional(),
  })
  .openapi("StockMoveBody")
