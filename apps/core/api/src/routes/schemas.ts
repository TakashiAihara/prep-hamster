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

// JSON body を取る route が schema 検証の手前で返す失敗
// (壊れた JSON = 400 / body 1 MiB 超過 = 413 / content-type 不正 = 415)。
export const jsonBodyErrorResponses = {
  400: {
    description: "JSON として読めないボディ",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  413: {
    description: "ボディが上限 (1 MiB) を超過",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  415: {
    // JSON 系は application/json と application/*+json を受け付ける (`; charset=utf-8` 等の
    // parameter 付きも可)。content-type なし + 空ボディは 415 にならず {} として検証される
    // (body を `required: true` にした route だけ。required で無いと検証自体が飛ばされる)。
    description:
      "JSON 系 content-type (application/json / application/*+json) 以外、または content-type なしでボディあり",
    content: { "application/json": { schema: errorResponseSchema } },
  },
}

// /v1 全 route の前段にある auth middleware が返すので、route ごとではなくここで共通に定義する
export const authErrorResponses = {
  409: {
    description: "同じメールアドレスのアカウントが別にある (新規アカウントの初回リクエスト)",
    content: { "application/json": { schema: errorResponseSchema } },
  },
  503: {
    description: "認証サーバ (Supabase) の署名鍵を取得できない",
    content: { "application/json": { schema: errorResponseSchema } },
  },
}

export const roleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]).openapi("Role")

// 全フィールド optional な PATCH body で「更新対象が 1 つ以上」を担保する。{} は 422
// VALIDATION_ERROR「更新する項目がありません」になる。
// 必須フィールドを持つ body (group name / membership role) には付けない: 必須検査が先に効く。
// undefined のみのキー (JSON では表現できない) も「無い」扱いにする。
// message は issue を 1 つだけ持たせ、validationErrorResponse の error.message にそのまま出る。
// refine は spec に出ないので、spec には minProperties で近い制約を書く。strict でない body では
// spec 上は未知キー 1 つでも満たすが、実行時は未知キーを落としてから refine するので 422 になる。
export const requireUpdatableField = <T extends z.ZodType<Record<string, unknown>>>(schema: T) =>
  schema
    .refine((value) => Object.values(value).some((v) => v !== undefined), {
      message: "更新する項目がありません",
    })
    .openapi({ minProperties: 1 })

export const groupDtoSchema = z
  .object({
    id: z.string().guid(),
    name: z.string(),
    createdBy: z.string().guid(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Group")

export const membershipDtoSchema = z
  .object({
    id: z.string().guid(),
    userId: z.string().guid(),
    groupId: z.string().guid(),
    role: roleSchema,
    joinedAt: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Membership")

// 招待発行時の role は EDITOR / VIEWER のみ。OWNER は手動 PATCH で昇格させる。
export const inviteRoleSchema = z.enum(["EDITOR", "VIEWER"]).openapi("InviteRole")

export const invitationDtoSchema = z
  .object({
    id: z.string().guid(),
    groupId: z.string().guid(),
    inviterId: z.string().guid(),
    role: roleSchema,
    token: z.string(),
    expiresAt: z.string().datetime({ offset: true }),
    usedAt: z.string().datetime({ offset: true }).nullable(),
    usedBy: z.string().guid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Invitation")

export const createInvitationBodyDtoSchema = z
  .object({
    role: inviteRoleSchema,
    // 1〜90 日。default は handler 側で 7 日に置き換える。
    expiresInDays: z.number().int().min(1).max(90).optional(),
  })
  .openapi("CreateInvitationBody")

export const updateMembershipRoleBodyDtoSchema = z
  .object({
    role: roleSchema,
  })
  .openapi("UpdateMembershipRoleBody")

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
    id: z.string().guid(),
    groupId: z.string().guid(),
    name: z.string(),
    sortOrder: z.number().int().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Location")

export const createLocationBodyDtoSchema = z
  .object({
    groupId: z.string().guid(),
    name: z.string().min(1).max(100),
    sortOrder: z.number().int().nullable().optional(),
  })
  .openapi("CreateLocationBody")

export const updateLocationBodyDtoSchema = requireUpdatableField(
  z.object({
    name: z.string().min(1).max(100).optional(),
    sortOrder: z.number().int().nullable().optional(),
  }),
).openapi("UpdateLocationBody")

export const categoryDtoSchema = z
  .object({
    id: z.string().guid(),
    groupId: z.string().guid(),
    name: z.string(),
    sortOrder: z.number().int().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .openapi("Category")

export const createCategoryBodyDtoSchema = z
  .object({
    groupId: z.string().guid(),
    name: z.string().min(1).max(100),
    sortOrder: z.number().int().nullable().optional(),
  })
  .openapi("CreateCategoryBody")

export const updateCategoryBodyDtoSchema = requireUpdatableField(
  z.object({
    name: z.string().min(1).max(100).optional(),
    sortOrder: z.number().int().nullable().optional(),
  }),
).openapi("UpdateCategoryBody")

export const itemDtoSchema = z
  .object({
    id: z.string().guid(),
    groupId: z.string().guid(),
    productMasterId: z.string().guid().nullable(),
    name: z.string(),
    barcode: z.string().nullable(),
    categoryId: z.string().guid().nullable(),
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
    id: z.string().guid(),
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
    groupId: z.string().guid(),
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
    groupId: z.string().guid(),
    name: z.string().min(1).max(200),
    categoryId: z.string().guid().nullable().optional(),
    defaultUnit: z.string().min(1).max(50).nullable().optional(),
    manufacturer: z.string().max(200).nullable().optional(),
    memo: z.string().max(2000).nullable().optional(),
    barcode: z.string().min(1).max(64).nullable().optional(),
  })
  .openapi("CreateItemBody")

export const updateItemBodyDtoSchema = requireUpdatableField(
  z.object({
    name: z.string().min(1).max(200).optional(),
    categoryId: z.string().guid().nullable().optional(),
    defaultUnit: z.string().min(1).max(50).nullable().optional(),
    manufacturer: z.string().max(200).nullable().optional(),
    memo: z.string().max(2000).nullable().optional(),
    barcode: z.string().min(1).max(64).nullable().optional(),
  }),
).openapi("UpdateItemBody")

export const stockDtoSchema = z
  .object({
    id: z.string().guid(),
    groupId: z.string().guid(),
    itemId: z.string().guid(),
    locationId: z.string().guid(),
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
    groupId: z.string().guid(),
    itemId: z.string().guid(),
    locationId: z.string().guid(),
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
export const updateStockBodyDtoSchema = requireUpdatableField(
  z
    .object({
      locationId: z.string().guid().optional(),
      unit: z.string().min(1).optional(),
      useByDate: z.string().date().nullable().optional(),
      bestBeforeDate: z.string().date().nullable().optional(),
      openedAt: z.string().date().nullable().optional(),
      note: z.string().nullable().optional(),
    })
    .strict(),
).openapi("UpdateStockBody")

export const stockEventDtoSchema = z
  .object({
    id: z.string().guid(),
    groupId: z.string().guid(),
    stockId: z.string().guid(),
    eventType: z.enum(["ADD", "CONSUME", "DISCARD", "MOVE", "EDIT"]),
    quantityDelta: z.number(),
    fromLocationId: z.string().guid().nullable(),
    toLocationId: z.string().guid().nullable(),
    occurredAt: z.string().datetime({ offset: true }),
    actorUserId: z.string().guid().nullable(),
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
    toLocationId: z.string().guid(),
    reason: z.string().max(500).nullable().optional(),
  })
  .openapi("StockMoveBody")
