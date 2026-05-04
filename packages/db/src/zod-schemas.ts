// drizzle-zod による Select / Insert / Update スキーマの自動生成。
// アプリ側 (apps / packages) はこのモジュール経由で zod を取得する。
//
// - selectSchemas: 行を「読み出した形」 (timestamps・default 値が確定した形)
// - insertSchemas: 行を「書き込む形」 (default あり col は optional)
// - updateSchemas: 部分更新 (全 col optional)
//
// ID 列は branded UUID で nominal type 化する。`UserId` と `StockId` は実体は
// string だが型では区別され、誤った id を渡すと compile error になる。

import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod"
import { z } from "zod"
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

const brandedId = <const TName extends string>(_name: TName) => z.string().uuid().brand<TName>()

// users
export const UserSchema = createSelectSchema(users, {
  id: () => brandedId("UserId"),
  email: (s) => s.email(),
})
export const UserInsertSchema = createInsertSchema(users, {
  id: () => brandedId("UserId"),
  email: (s) => s.email(),
})
export const UserUpdateSchema = createUpdateSchema(users, {
  id: () => brandedId("UserId"),
  email: (s) => s.email(),
})
export type User = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert

// groups
const groupBrands = {
  id: () => brandedId("GroupId"),
  createdBy: () => brandedId("UserId"),
}
export const GroupSchema = createSelectSchema(groups, groupBrands)
export const GroupInsertSchema = createInsertSchema(groups, groupBrands)
export const GroupUpdateSchema = createUpdateSchema(groups, groupBrands)
export type Group = typeof groups.$inferSelect
export type GroupInsert = typeof groups.$inferInsert

// memberships
const membershipBrands = {
  id: () => brandedId("MembershipId"),
  userId: () => brandedId("UserId"),
  groupId: () => brandedId("GroupId"),
}
export const MembershipSchema = createSelectSchema(memberships, membershipBrands)
export const MembershipInsertSchema = createInsertSchema(memberships, membershipBrands)
export const MembershipUpdateSchema = createUpdateSchema(memberships, membershipBrands)
export type Membership = typeof memberships.$inferSelect
export type MembershipInsert = typeof memberships.$inferInsert

// invitations
const invitationBrands = {
  id: () => brandedId("InvitationId"),
  groupId: () => brandedId("GroupId"),
  inviterId: () => brandedId("UserId"),
  usedBy: () => brandedId("UserId").nullable(),
}
export const InvitationSchema = createSelectSchema(invitations, invitationBrands)
export const InvitationInsertSchema = createInsertSchema(invitations, invitationBrands)
export const InvitationUpdateSchema = createUpdateSchema(invitations, invitationBrands)
export type Invitation = typeof invitations.$inferSelect
export type InvitationInsert = typeof invitations.$inferInsert

// locations
const locationBrands = {
  id: () => brandedId("LocationId"),
  groupId: () => brandedId("GroupId"),
}
export const LocationSchema = createSelectSchema(locations, locationBrands)
export const LocationInsertSchema = createInsertSchema(locations, locationBrands)
export const LocationUpdateSchema = createUpdateSchema(locations, locationBrands)
export type Location = typeof locations.$inferSelect
export type LocationInsert = typeof locations.$inferInsert

// categories
const categoryBrands = {
  id: () => brandedId("CategoryId"),
  groupId: () => brandedId("GroupId"),
}
export const CategorySchema = createSelectSchema(categories, categoryBrands)
export const CategoryInsertSchema = createInsertSchema(categories, categoryBrands)
export const CategoryUpdateSchema = createUpdateSchema(categories, categoryBrands)
export type Category = typeof categories.$inferSelect
export type CategoryInsert = typeof categories.$inferInsert

// productMasters
const productMasterBrands = {
  id: () => brandedId("ProductMasterId"),
}
export const ProductMasterSchema = createSelectSchema(productMasters, productMasterBrands)
export const ProductMasterInsertSchema = createInsertSchema(productMasters, productMasterBrands)
export const ProductMasterUpdateSchema = createUpdateSchema(productMasters, productMasterBrands)
export type ProductMaster = typeof productMasters.$inferSelect
export type ProductMasterInsert = typeof productMasters.$inferInsert

// items
const itemBrands = {
  id: () => brandedId("ItemId"),
  groupId: () => brandedId("GroupId"),
  productMasterId: () => brandedId("ProductMasterId").nullable(),
  categoryId: () => brandedId("CategoryId").nullable(),
}
export const ItemSchema = createSelectSchema(items, itemBrands)
export const ItemInsertSchema = createInsertSchema(items, itemBrands)
export const ItemUpdateSchema = createUpdateSchema(items, itemBrands)
export type Item = typeof items.$inferSelect
export type ItemInsert = typeof items.$inferInsert

// stocks
const stockBrands = {
  id: () => brandedId("StockId"),
  groupId: () => brandedId("GroupId"),
  itemId: () => brandedId("ItemId"),
  locationId: () => brandedId("LocationId"),
}
export const StockSchema = createSelectSchema(stocks, stockBrands)
export const StockInsertSchema = createInsertSchema(stocks, stockBrands)
export const StockUpdateSchema = createUpdateSchema(stocks, stockBrands)
export type Stock = typeof stocks.$inferSelect
export type StockInsert = typeof stocks.$inferInsert

// stockEvents
const stockEventBrands = {
  id: () => brandedId("StockEventId"),
  groupId: () => brandedId("GroupId"),
  stockId: () => brandedId("StockId"),
  fromLocationId: () => brandedId("LocationId").nullable(),
  toLocationId: () => brandedId("LocationId").nullable(),
  actorUserId: () => brandedId("UserId").nullable(),
}
export const StockEventSchema = createSelectSchema(stockEvents, stockEventBrands)
export const StockEventInsertSchema = createInsertSchema(stockEvents, stockEventBrands)
export const StockEventUpdateSchema = createUpdateSchema(stockEvents, stockEventBrands)
export type StockEvent = typeof stockEvents.$inferSelect
export type StockEventInsert = typeof stockEvents.$inferInsert

// requirementSettings
const requirementSettingBrands = {
  id: () => brandedId("RequirementSettingId"),
  groupId: () => brandedId("GroupId"),
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
  id: () => brandedId("ShoppingListItemId"),
  groupId: () => brandedId("GroupId"),
  itemId: () => brandedId("ItemId").nullable(),
  addedBy: () => brandedId("UserId"),
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
  id: () => brandedId("NotificationSettingId"),
  userId: () => brandedId("UserId"),
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
