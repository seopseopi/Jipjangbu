import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  notes: text("notes").notNull().default(""),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workLogs = sqliteTable("work_logs", {
  id: text("id").primaryKey(),
  legacyId: integer("legacy_id"),
  workDate: text("work_date").notNull(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  workType: text("work_type").notNull(),
  content: text("content").notNull().default(""),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_work_logs_date").on(table.workDate),
  index("idx_work_logs_customer").on(table.customerId),
  index("idx_work_logs_type_date").on(table.workType, table.workDate),
]);

export const workLogProperties = sqliteTable("work_log_properties", {
  id: text("id").primaryKey(),
  workLogId: text("work_log_id").notNull().references(() => workLogs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  propertyType: text("property_type").notNull().default(""),
  buildingName: text("building_name").notNull().default(""),
  buildingDong: text("building_dong").notNull().default(""),
  unitNumber: text("unit_number").notNull().default(""),
  sizeType: text("size_type").notNull().default(""),
  salePrice: text("sale_price").notNull().default(""),
  jeonsePrice: text("jeonse_price").notNull().default(""),
  monthlyRent: text("monthly_rent").notNull().default(""),
  source: text("source").notNull().default(""),
}, (table) => [
  index("idx_work_log_properties_log").on(table.workLogId, table.sequence),
  index("idx_work_log_properties_address").on(table.buildingName, table.buildingDong, table.unitNumber),
]);

export const listings = sqliteTable("listings", {
  id: text("id").primaryKey(),
  identityKey: text("identity_key").notNull(),
  registeredAt: text("registered_at"),
  closedAt: text("closed_at"),
  status: text("status").notNull(),
  propertyType: text("property_type").notNull(),
  buildingName: text("building_name").notNull(),
  buildingDong: text("building_dong").notNull().default(""),
  unitNumber: text("unit_number").notNull().default(""),
  sizeType: text("size_type").notNull().default(""),
  salePrice: text("sale_price").notNull().default(""),
  jeonsePrice: text("jeonse_price").notNull().default(""),
  monthlyRent: text("monthly_rent").notNull().default(""),
  notes: text("notes").notNull().default(""),
  sourceNotes: text("source_notes").notNull().default(""),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_listings_identity").on(table.identityKey),
  index("idx_listings_status").on(table.closedAt, table.status),
  index("idx_listings_building").on(table.propertyType, table.buildingName),
]);

export const listingEvents = sqliteTable("listing_events", {
  id: text("id").primaryKey(),
  listingKey: text("listing_key").notNull(),
  workLogId: text("work_log_id").notNull().references(() => workLogs.id, { onDelete: "cascade" }),
  detailId: text("detail_id").notNull(),
  eventDate: text("event_date").notNull(),
  eventOrder: integer("event_order").notNull().default(0),
  status: text("status").notNull(),
  propertyType: text("property_type").notNull(),
  buildingName: text("building_name").notNull(),
  buildingDong: text("building_dong").notNull().default(""),
  unitNumber: text("unit_number").notNull().default(""),
  sizeType: text("size_type").notNull().default(""),
  salePrice: text("sale_price").notNull().default(""),
  jeonsePrice: text("jeonse_price").notNull().default(""),
  monthlyRent: text("monthly_rent").notNull().default(""),
  source: text("source").notNull().default(""),
  notes: text("notes").notNull().default(""),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_listing_events_detail").on(table.detailId),
  index("idx_listing_events_key_date").on(table.listingKey, table.eventDate),
  index("idx_listing_events_key_date_order").on(table.listingKey, table.eventDate, table.eventOrder),
  index("idx_listing_events_work_log").on(table.workLogId),
]);

export const workTypes = sqliteTable("work_types", {
  name: text("name").primaryKey(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const propertyBuildings = sqliteTable("property_buildings", {
  id: text("id").primaryKey(),
  propertyType: text("property_type").notNull(),
  buildingName: text("building_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  uniqueIndex("idx_property_buildings_unique").on(table.propertyType, table.buildingName),
]);

export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  blockedUntil: integer("blocked_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});
