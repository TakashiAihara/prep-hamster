// drizzle-zod による Select / Insert / Update スキーマの自動生成。
// アプリ側 (apps / packages) はこのモジュール経由で zod を取得する。
//
// - selectSchemas: 行を「読み出した形」 (timestamps・default 値が確定した形)
// - insertSchemas: 行を「書き込む形」 (default あり col は optional)
// - updateSchemas: 部分更新 (全 col optional)
//
// ID 列は branded UUID で nominal type 化する。`UserId` と `StockId` は実体は
// string だが型では区別され、誤った id を渡すと compile error になる。
//
// refinement callback は **必ず引数 `s` を chain する**こと。`() => z.string()...`
// のように新しい schema を返すと、drizzle-zod は列の optional / default /
// nullable 属性を再適用しなくなる (CodeRabbit PR #65 で指摘)。

import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod"
import type { z } from "zod"
import {
  categories,
  groups,
  invitations,
  items,
  locations,
  memberships,
  notificationSettings,
  productMasters,
  requirementSettings,
  shoppingListItems,
  stockEvents,
  stocks,
  users,
} from "./schema"

// uuid 列を branded uuid に置換するヘルパ。`s` を chain することで
// drizzle-zod が列属性 (optional / nullable) を outer 側で再適用する性質を保つ。
const brandUuid =
  <const TName extends string>(_name: TName) =>
  (s: z.ZodString) =>
    s.uuid().brand<TName>()

// users
export const UserSchema = createSelectSchema(users, {
  id: brandUuid("UserId"),
  email: (s) => s.email(),
})
export const UserInsertSchema = createInsertSchema(users, {
  id: brandUuid("UserId"),
  email: (s) => s.email(),
})
export const UserUpdateSchema = createUpdateSchema(users, {
  id: brandUuid("UserId"),
  email: (s) => s.email(),
})
export type User = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert

// groups
const groupBrands = {
  id: brandUuid("GroupId"),
  createdBy: brandUuid("UserId"),
}
export const GroupSchema = createSelectSchema(groups, groupBrands)
export const GroupInsertSchema = createInsertSchema(groups, groupBrands)
export const GroupUpdateSchema = createUpdateSchema(groups, groupBrands)
export type Group = typeof groups.$inferSelect
export type GroupInsert = typeof groups.$inferInsert

// memberships
const membershipBrands = {
  id: brandUuid("MembershipId"),
  userId: brandUuid("UserId"),
  groupId: brandUuid("GroupId"),
}
export const MembershipSchema = createSelectSchema(memberships, membershipBrands)
export const MembershipInsertSchema = createInsertSchema(memberships, membershipBrands)
export const MembershipUpdateSchema = createUpdateSchema(memberships, membershipBrands)
export type Membership = typeof memberships.$inferSelect
export type MembershipInsert = typeof memberships.$inferInsert

// invitations
const invitationBrands = {
  id: brandUuid("InvitationId"),
  groupId: brandUuid("GroupId"),
  inviterId: brandUuid("UserId"),
  usedBy: brandUuid("UserId"),
}
export const InvitationSchema = createSelectSchema(invitations, invitationBrands)
export const InvitationInsertSchema = createInsertSchema(invitations, invitationBrands)
export const InvitationUpdateSchema = createUpdateSchema(invitations, invitationBrands)
export type Invitation = typeof invitations.$inferSelect
export type InvitationInsert = typeof invitations.$inferInsert

// locations
const locationBrands = {
  id: brandUuid("LocationId"),
  groupId: brandUuid("GroupId"),
}
export const LocationSchema = createSelectSchema(locations, locationBrands)
export const LocationInsertSchema = createInsertSchema(locations, locationBrands)
export const LocationUpdateSchema = createUpdateSchema(locations, locationBrands)
export type Location = typeof locations.$inferSelect
export type LocationInsert = typeof locations.$inferInsert

// categories
const categoryBrands = {
  id: brandUuid("CategoryId"),
  groupId: brandUuid("GroupId"),
}
export const CategorySchema = createSelectSchema(categories, categoryBrands)
export const CategoryInsertSchema = createInsertSchema(categories, categoryBrands)
export const CategoryUpdateSchema = createUpdateSchema(categories, categoryBrands)
export type Category = typeof categories.$inferSelect
export type CategoryInsert = typeof categories.$inferInsert

// productMasters
const productMasterBrands = {
  id: brandUuid("ProductMasterId"),
}
export const ProductMasterSchema = createSelectSchema(productMasters, productMasterBrands)
export const ProductMasterInsertSchema = createInsertSchema(productMasters, productMasterBrands)
export const ProductMasterUpdateSchema = createUpdateSchema(productMasters, productMasterBrands)
export type ProductMaster = typeof productMasters.$inferSelect
export type ProductMasterInsert = typeof productMasters.$inferInsert

// items
const itemBrands = {
  id: brandUuid("ItemId"),
  groupId: brandUuid("GroupId"),
  productMasterId: brandUuid("ProductMasterId"),
  categoryId: brandUuid("CategoryId"),
}
export const ItemSchema = createSelectSchema(items, itemBrands)
export const ItemInsertSchema = createInsertSchema(items, itemBrands)
export const ItemUpdateSchema = createUpdateSchema(items, itemBrands)
export type Item = typeof items.$inferSelect
export type ItemInsert = typeof items.$inferInsert

// stocks
const stockBrands = {
  id: brandUuid("StockId"),
  groupId: brandUuid("GroupId"),
  itemId: brandUuid("ItemId"),
  locationId: brandUuid("LocationId"),
}
export const StockSchema = createSelectSchema(stocks, stockBrands)
export const StockInsertSchema = createInsertSchema(stocks, stockBrands)
export const StockUpdateSchema = createUpdateSchema(stocks, stockBrands)
export type Stock = typeof stocks.$inferSelect
export type StockInsert = typeof stocks.$inferInsert

// stockEvents
const stockEventBrands = {
  id: brandUuid("StockEventId"),
  groupId: brandUuid("GroupId"),
  stockId: brandUuid("StockId"),
  fromLocationId: brandUuid("LocationId"),
  toLocationId: brandUuid("LocationId"),
  actorUserId: brandUuid("UserId"),
}
export const StockEventSchema = createSelectSchema(stockEvents, stockEventBrands)
export const StockEventInsertSchema = createInsertSchema(stockEvents, stockEventBrands)
export const StockEventUpdateSchema = createUpdateSchema(stockEvents, stockEventBrands)
export type StockEvent = typeof stockEvents.$inferSelect
export type StockEventInsert = typeof stockEvents.$inferInsert

// requirementSettings
const requirementSettingBrands = {
  id: brandUuid("RequirementSettingId"),
  groupId: brandUuid("GroupId"),
}
export const RequirementSettingSchema = createSelectSchema(
  requirementSettings,
  requirementSettingBrands,
)
export const RequirementSettingInsertSchema = createInsertSchema(
  requirementSettings,
  requirementSettingBrands,
)
export const RequirementSettingUpdateSchema = createUpdateSchema(
  requirementSettings,
  requirementSettingBrands,
)
export type RequirementSetting = typeof requirementSettings.$inferSelect
export type RequirementSettingInsert = typeof requirementSettings.$inferInsert

// shoppingListItems
const shoppingListItemBrands = {
  id: brandUuid("ShoppingListItemId"),
  groupId: brandUuid("GroupId"),
  itemId: brandUuid("ItemId"),
  addedBy: brandUuid("UserId"),
}
export const ShoppingListItemSchema = createSelectSchema(shoppingListItems, shoppingListItemBrands)
export const ShoppingListItemInsertSchema = createInsertSchema(
  shoppingListItems,
  shoppingListItemBrands,
)
export const ShoppingListItemUpdateSchema = createUpdateSchema(
  shoppingListItems,
  shoppingListItemBrands,
)
export type ShoppingListItem = typeof shoppingListItems.$inferSelect
export type ShoppingListItemInsert = typeof shoppingListItems.$inferInsert

// notificationSettings
const notificationSettingBrands = {
  id: brandUuid("NotificationSettingId"),
  userId: brandUuid("UserId"),
}
export const NotificationSettingSchema = createSelectSchema(
  notificationSettings,
  notificationSettingBrands,
)
export const NotificationSettingInsertSchema = createInsertSchema(
  notificationSettings,
  notificationSettingBrands,
)
export const NotificationSettingUpdateSchema = createUpdateSchema(
  notificationSettings,
  notificationSettingBrands,
)
export type NotificationSetting = typeof notificationSettings.$inferSelect
export type NotificationSettingInsert = typeof notificationSettings.$inferInsert
