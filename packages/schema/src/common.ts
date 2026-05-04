import { z } from "zod"

// API I/F の共通プリミティブ。row schema (drizzle-zod 生成) では型が DB ネイティブ
// (Date など) で来るため、HTTP I/O と区別するためにここに集約する。

// Branded UUID 型ファクトリ。`UserId` と `StockId` は実体としては string でも
// 型レベルで区別したいので nominal type を作る。consumer 側では `Brand<...>`
// で受け渡しするだけで他の id を渡そうとすると compile error になる。
export const brandedId = <const TName extends string>(_name: TName) =>
  z.string().uuid().brand<TName>()

export const UserId = brandedId("UserId")
export type UserId = z.infer<typeof UserId>

export const GroupId = brandedId("GroupId")
export type GroupId = z.infer<typeof GroupId>

export const MembershipId = brandedId("MembershipId")
export type MembershipId = z.infer<typeof MembershipId>

export const InvitationId = brandedId("InvitationId")
export type InvitationId = z.infer<typeof InvitationId>

export const LocationId = brandedId("LocationId")
export type LocationId = z.infer<typeof LocationId>

export const CategoryId = brandedId("CategoryId")
export type CategoryId = z.infer<typeof CategoryId>

export const ProductMasterId = brandedId("ProductMasterId")
export type ProductMasterId = z.infer<typeof ProductMasterId>

export const ItemId = brandedId("ItemId")
export type ItemId = z.infer<typeof ItemId>

export const StockId = brandedId("StockId")
export type StockId = z.infer<typeof StockId>

export const StockEventId = brandedId("StockEventId")
export type StockEventId = z.infer<typeof StockEventId>

export const RequirementSettingId = brandedId("RequirementSettingId")
export type RequirementSettingId = z.infer<typeof RequirementSettingId>

export const ShoppingListItemId = brandedId("ShoppingListItemId")
export type ShoppingListItemId = z.infer<typeof ShoppingListItemId>

export const NotificationSettingId = brandedId("NotificationSettingId")
export type NotificationSettingId = z.infer<typeof NotificationSettingId>

// 旧称 `Id` (汎用 UUID) は新規コードでは使わない。互換のため当面残す。
export const Id = z.string().uuid()
export type Id = z.infer<typeof Id>

export const TimestampString = z.string().datetime({ offset: true })
export type TimestampString = z.infer<typeof TimestampString>

export const DateOnly = z.string().date()
export type DateOnly = z.infer<typeof DateOnly>

export const RoleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"])
export type Role = z.infer<typeof RoleSchema>
