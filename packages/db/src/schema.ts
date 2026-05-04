import { relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

// ============================================================================
// Enums
// ============================================================================

export const roleEnum = pgEnum("role", ["OWNER", "EDITOR", "VIEWER"])

export const productMasterSourceEnum = pgEnum("product_master_source", [
  "YAHOO_SHOPPING",
  "RAKUTEN_ICHIBA",
  "JANCODE_LOOKUP",
  "GS1_JICFS",
  "OTHER",
])

export const productMasterConfidenceEnum = pgEnum("product_master_confidence", [
  "HIGH",
  "MEDIUM",
  "LOW",
])

export const stockEventTypeEnum = pgEnum("stock_event_type", [
  "ADD",
  "CONSUME",
  "DISCARD",
  "MOVE",
  "EDIT",
])

export const shoppingListSourceEnum = pgEnum("shopping_list_source", ["AUTO", "MANUAL"])

export const shoppingListStatusEnum = pgEnum("shopping_list_status", [
  "OPEN",
  "BOUGHT",
  "CANCELLED",
])

// ============================================================================
// Helpers
// ============================================================================

const tsCol = (name: string) => timestamp(name, { withTimezone: true })

// 全テーブル共通の created_at / updated_at / deleted_at。
// drizzle 0.36 系は spread 経由の column reuse をサポートしている。
const timestamps = {
  createdAt: tsCol("created_at").notNull().defaultNow(),
  updatedAt: tsCol("updated_at").notNull().defaultNow(),
  deletedAt: tsCol("deleted_at"),
}

// ============================================================================
// Tables
// ============================================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  locale: text("locale").notNull().default("ja-JP"),
  ...timestamps,
})

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  ...timestamps,
})

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    role: roleEnum("role").notNull(),
    joinedAt: tsCol("joined_at").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("memberships_user_group_unique").on(t.userId, t.groupId),
    index("memberships_user_idx").on(t.userId),
    index("memberships_group_idx").on(t.groupId),
  ],
)

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  inviterId: uuid("inviter_id")
    .notNull()
    .references(() => users.id),
  role: roleEnum("role").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: tsCol("expires_at").notNull(),
  usedAt: tsCol("used_at"),
  usedBy: uuid("used_by").references(() => users.id),
  ...timestamps,
})

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order"),
  ...timestamps,
})

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order"),
  ...timestamps,
})

export const productMasters = pgTable(
  "product_masters",
  {
    id: uuid("id").primaryKey(),
    jan: text("jan").notNull().unique(),
    name: text("name").notNull(),
    manufacturer: text("manufacturer"),
    brand: text("brand"),
    contentAmount: real("content_amount"),
    contentUnit: text("content_unit"),
    categoryHint: text("category_hint"),
    imageUrl: text("image_url"),
    source: productMasterSourceEnum("source").notNull(),
    sourceRaw: jsonb("source_raw"),
    fetchedAt: tsCol("fetched_at").notNull(),
    confidence: productMasterConfidenceEnum("confidence"),
    ...timestamps,
  },
  (t) => [index("product_masters_fetched_at_idx").on(t.fetchedAt)],
)

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    productMasterId: uuid("product_master_id").references(() => productMasters.id),
    name: text("name").notNull(),
    barcode: text("barcode"),
    categoryId: uuid("category_id").references(() => categories.id),
    defaultUnit: text("default_unit"),
    manufacturer: text("manufacturer"),
    memo: text("memo"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("items_group_product_master_idx")
      .on(t.groupId, t.productMasterId)
      .where(sql`${t.productMasterId} IS NOT NULL`),
    uniqueIndex("items_group_barcode_idx")
      .on(t.groupId, t.barcode)
      .where(sql`${t.productMasterId} IS NULL AND ${t.barcode} IS NOT NULL`),
  ],
)

export const stocks = pgTable(
  "stocks",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    quantity: real("quantity").notNull(),
    unit: text("unit").notNull(),
    useByDate: date("use_by_date"),
    bestBeforeDate: date("best_before_date"),
    openedAt: date("opened_at"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    check("stocks_quantity_nonneg", sql`${t.quantity} >= 0`),
    index("stocks_group_use_by_idx").on(t.groupId, t.useByDate),
    index("stocks_group_best_before_idx").on(t.groupId, t.bestBeforeDate),
    index("stocks_group_location_idx").on(t.groupId, t.locationId),
    index("stocks_group_item_idx").on(t.groupId, t.itemId),
  ],
)

export const stockEvents = pgTable(
  "stock_events",
  {
    id: uuid("id").primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    stockId: uuid("stock_id")
      .notNull()
      .references(() => stocks.id),
    eventType: stockEventTypeEnum("event_type").notNull(),
    quantityDelta: real("quantity_delta").notNull(),
    fromLocationId: uuid("from_location_id").references(() => locations.id),
    toLocationId: uuid("to_location_id").references(() => locations.id),
    occurredAt: tsCol("occurred_at").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason"),
    createdAt: tsCol("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_events_group_occurred_idx").on(t.groupId, t.occurredAt.desc()),
    index("stock_events_stock_occurred_idx").on(t.stockId, t.occurredAt.desc()),
  ],
)

export const requirementSettings = pgTable("requirement_settings", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .unique()
    .references(() => groups.id),
  peopleCount: integer("people_count").notNull(),
  days: integer("days").notNull(),
  perCategorySettings: jsonb("per_category_settings"),
  ...timestamps,
})

export const shoppingListItems = pgTable("shopping_list_items", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  itemId: uuid("item_id").references(() => items.id),
  name: text("name").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit"),
  source: shoppingListSourceEnum("source").notNull(),
  status: shoppingListStatusEnum("status").notNull(),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => users.id),
  ...timestamps,
})

export const notificationSettings = pgTable("notification_settings", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  expiringNotifyEnabled: boolean("expiring_notify_enabled").notNull().default(true),
  expiringDaysBefore: integer("expiring_days_before").notNull().default(7),
  expiredNotifyEnabled: boolean("expired_notify_enabled").notNull().default(true),
  shortageNotifyEnabled: boolean("shortage_notify_enabled").notNull().default(true),
  invitationNotifyEnabled: boolean("invitation_notify_enabled").notNull().default(true),
  pushToken: text("push_token"),
  ...timestamps,
})

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  memberships: many(memberships),
  groupsCreated: many(groups, { relationName: "groupCreator" }),
  notificationSetting: one(notificationSettings),
}))

export const groupsRelations = relations(groups, ({ one, many }) => ({
  creator: one(users, {
    fields: [groups.createdBy],
    references: [users.id],
    relationName: "groupCreator",
  }),
  memberships: many(memberships),
  invitations: many(invitations),
  locations: many(locations),
  categories: many(categories),
  items: many(items),
  stocks: many(stocks),
  stockEvents: many(stockEvents),
  requirementSetting: one(requirementSettings),
  shoppingListItems: many(shoppingListItems),
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  group: one(groups, { fields: [memberships.groupId], references: [groups.id] }),
}))

export const invitationsRelations = relations(invitations, ({ one }) => ({
  group: one(groups, { fields: [invitations.groupId], references: [groups.id] }),
  inviter: one(users, {
    fields: [invitations.inviterId],
    references: [users.id],
    relationName: "invitationInviter",
  }),
  usedByUser: one(users, {
    fields: [invitations.usedBy],
    references: [users.id],
    relationName: "invitationUsedBy",
  }),
}))

export const locationsRelations = relations(locations, ({ one, many }) => ({
  group: one(groups, { fields: [locations.groupId], references: [groups.id] }),
  stocks: many(stocks),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  group: one(groups, { fields: [categories.groupId], references: [groups.id] }),
  items: many(items),
}))

export const productMastersRelations = relations(productMasters, ({ many }) => ({
  items: many(items),
}))

export const itemsRelations = relations(items, ({ one, many }) => ({
  group: one(groups, { fields: [items.groupId], references: [groups.id] }),
  productMaster: one(productMasters, {
    fields: [items.productMasterId],
    references: [productMasters.id],
  }),
  category: one(categories, { fields: [items.categoryId], references: [categories.id] }),
  stocks: many(stocks),
  shoppingListItems: many(shoppingListItems),
}))

export const stocksRelations = relations(stocks, ({ one, many }) => ({
  group: one(groups, { fields: [stocks.groupId], references: [groups.id] }),
  item: one(items, { fields: [stocks.itemId], references: [items.id] }),
  location: one(locations, { fields: [stocks.locationId], references: [locations.id] }),
  events: many(stockEvents),
}))

export const stockEventsRelations = relations(stockEvents, ({ one }) => ({
  group: one(groups, { fields: [stockEvents.groupId], references: [groups.id] }),
  stock: one(stocks, { fields: [stockEvents.stockId], references: [stocks.id] }),
  fromLocation: one(locations, {
    fields: [stockEvents.fromLocationId],
    references: [locations.id],
    relationName: "stockEventFrom",
  }),
  toLocation: one(locations, {
    fields: [stockEvents.toLocationId],
    references: [locations.id],
    relationName: "stockEventTo",
  }),
  actor: one(users, { fields: [stockEvents.actorUserId], references: [users.id] }),
}))

export const requirementSettingsRelations = relations(requirementSettings, ({ one }) => ({
  group: one(groups, { fields: [requirementSettings.groupId], references: [groups.id] }),
}))

export const shoppingListItemsRelations = relations(shoppingListItems, ({ one }) => ({
  group: one(groups, { fields: [shoppingListItems.groupId], references: [groups.id] }),
  item: one(items, { fields: [shoppingListItems.itemId], references: [items.id] }),
  addedByUser: one(users, { fields: [shoppingListItems.addedBy], references: [users.id] }),
}))

export const notificationSettingsRelations = relations(notificationSettings, ({ one }) => ({
  user: one(users, { fields: [notificationSettings.userId], references: [users.id] }),
}))
