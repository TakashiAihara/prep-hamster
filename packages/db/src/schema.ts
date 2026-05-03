import { sql } from "drizzle-orm"
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

export const shoppingListSourceEnum = pgEnum("shopping_list_source", [
  "AUTO",
  "MANUAL",
])

export const shoppingListStatusEnum = pgEnum("shopping_list_status", [
  "OPEN",
  "BOUGHT",
  "CANCELLED",
])

// ============================================================================
// Tables
// ============================================================================

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  locale: text("locale").notNull().default("ja-JP"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
})

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: uuid("used_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
})

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
})

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => groups.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    confidence: productMasterConfidenceEnum("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
})
