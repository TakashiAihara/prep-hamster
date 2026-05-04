// drizzle-zod による Select / Insert / Update スキーマの自動生成。
// アプリ側 (apps / packages) はこのモジュール経由で zod を取得する。
//
// - selectSchemas: 行を「読み出した形」 (timestamps・default 値が確定した形)
// - insertSchemas: 行を「書き込む形」 (default あり col は optional)
// - updateSchemas: 部分更新 (全 col optional)

import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod"
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

// users
export const UserSchema = createSelectSchema(users, {
  email: (s) => s.email(),
})
export const UserInsertSchema = createInsertSchema(users, {
  email: (s) => s.email(),
})
export const UserUpdateSchema = createUpdateSchema(users, {
  email: (s) => s.email(),
})
export type User = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert

// groups
export const GroupSchema = createSelectSchema(groups)
export const GroupInsertSchema = createInsertSchema(groups)
export const GroupUpdateSchema = createUpdateSchema(groups)
export type Group = typeof groups.$inferSelect
export type GroupInsert = typeof groups.$inferInsert

// memberships
export const MembershipSchema = createSelectSchema(memberships)
export const MembershipInsertSchema = createInsertSchema(memberships)
export const MembershipUpdateSchema = createUpdateSchema(memberships)
export type Membership = typeof memberships.$inferSelect
export type MembershipInsert = typeof memberships.$inferInsert

// invitations
export const InvitationSchema = createSelectSchema(invitations)
export const InvitationInsertSchema = createInsertSchema(invitations)
export const InvitationUpdateSchema = createUpdateSchema(invitations)
export type Invitation = typeof invitations.$inferSelect
export type InvitationInsert = typeof invitations.$inferInsert

// locations
export const LocationSchema = createSelectSchema(locations)
export const LocationInsertSchema = createInsertSchema(locations)
export const LocationUpdateSchema = createUpdateSchema(locations)
export type Location = typeof locations.$inferSelect
export type LocationInsert = typeof locations.$inferInsert

// categories
export const CategorySchema = createSelectSchema(categories)
export const CategoryInsertSchema = createInsertSchema(categories)
export const CategoryUpdateSchema = createUpdateSchema(categories)
export type Category = typeof categories.$inferSelect
export type CategoryInsert = typeof categories.$inferInsert

// productMasters
export const ProductMasterSchema = createSelectSchema(productMasters)
export const ProductMasterInsertSchema = createInsertSchema(productMasters)
export const ProductMasterUpdateSchema = createUpdateSchema(productMasters)
export type ProductMaster = typeof productMasters.$inferSelect
export type ProductMasterInsert = typeof productMasters.$inferInsert

// items
export const ItemSchema = createSelectSchema(items)
export const ItemInsertSchema = createInsertSchema(items)
export const ItemUpdateSchema = createUpdateSchema(items)
export type Item = typeof items.$inferSelect
export type ItemInsert = typeof items.$inferInsert

// stocks
export const StockSchema = createSelectSchema(stocks)
export const StockInsertSchema = createInsertSchema(stocks)
export const StockUpdateSchema = createUpdateSchema(stocks)
export type Stock = typeof stocks.$inferSelect
export type StockInsert = typeof stocks.$inferInsert

// stockEvents
export const StockEventSchema = createSelectSchema(stockEvents)
export const StockEventInsertSchema = createInsertSchema(stockEvents)
export const StockEventUpdateSchema = createUpdateSchema(stockEvents)
export type StockEvent = typeof stockEvents.$inferSelect
export type StockEventInsert = typeof stockEvents.$inferInsert

// requirementSettings
export const RequirementSettingSchema = createSelectSchema(requirementSettings)
export const RequirementSettingInsertSchema = createInsertSchema(requirementSettings)
export const RequirementSettingUpdateSchema = createUpdateSchema(requirementSettings)
export type RequirementSetting = typeof requirementSettings.$inferSelect
export type RequirementSettingInsert = typeof requirementSettings.$inferInsert

// shoppingListItems
export const ShoppingListItemSchema = createSelectSchema(shoppingListItems)
export const ShoppingListItemInsertSchema = createInsertSchema(shoppingListItems)
export const ShoppingListItemUpdateSchema = createUpdateSchema(shoppingListItems)
export type ShoppingListItem = typeof shoppingListItems.$inferSelect
export type ShoppingListItemInsert = typeof shoppingListItems.$inferInsert

// notificationSettings
export const NotificationSettingSchema = createSelectSchema(notificationSettings)
export const NotificationSettingInsertSchema = createInsertSchema(notificationSettings)
export const NotificationSettingUpdateSchema = createUpdateSchema(notificationSettings)
export type NotificationSetting = typeof notificationSettings.$inferSelect
export type NotificationSettingInsert = typeof notificationSettings.$inferInsert
