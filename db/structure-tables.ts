import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
export const structureComplexes = sqliteTable("structure_complexes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  evidence: text("evidence").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
export const structureBuildings = sqliteTable(
  "structure_buildings",
  {
    id: text("id").primaryKey(),
    complexId: text("complex_id")
      .notNull()
      .references(() => structureComplexes.id),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("structure_building_name").on(t.complexId, t.name)],
);
export const structureUnits = sqliteTable(
  "structure_units",
  {
    id: text("id").primaryKey(),
    buildingId: text("building_id")
      .notNull()
      .references(() => structureBuildings.id),
    number: text("number").notNull(),
    floor: integer("floor"),
    evidence: text("evidence").notNull(),
  },
  (t) => [uniqueIndex("structure_unit_number").on(t.buildingId, t.number)],
);
export const structurePlanTypes = sqliteTable(
  "structure_plan_types",
  {
    id: text("id").primaryKey(),
    complexId: text("complex_id")
      .notNull()
      .references(() => structureComplexes.id),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("structure_type_name").on(t.complexId, t.name)],
);
export const structurePlanRevisions = sqliteTable(
  "structure_plan_revisions",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => structurePlanTypes.id),
    version: integer("version").notNull(),
    geometryJson: text("geometry_json").notNull(),
    source: text("source").notNull(),
    permissionEvidence: text("permission_evidence").notNull(),
    variant: text("variant").notNull(),
    verifiedAt: text("verified_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("structure_revision_version").on(t.typeId, t.version),
    index("idx_structure_revision_type").on(t.typeId, t.version),
    check("structure_version_positive", sql`${t.version}>0`),
    check("structure_geometry_json", sql`json_valid(${t.geometryJson})`),
    check(
      "structure_variant",
      sql`${t.variant} IN ('base','expanded','remodeled')`,
    ),
  ],
);
export const structureAssignments = sqliteTable(
  "structure_assignments",
  {
    unitId: text("unit_id")
      .primaryKey()
      .references(() => structureUnits.id),
    revisionId: text("revision_id")
      .notNull()
      .references(() => structurePlanRevisions.id),
    mirror: integer("mirror"),
    rotation: real("rotation"),
    actualCondition: text("actual_condition").notNull(),
    evidence: text("evidence").notNull(),
    rowVersion: integer("row_version").notNull().default(1),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    check("structure_mirror", sql`${t.mirror} IN (0,1)`),
    check(
      "structure_condition",
      sql`${t.actualCondition} IN ('unknown','base','expanded','remodeled')`,
    ),
  ],
);
export const structureListingLinks = sqliteTable(
  "structure_listing_links",
  {
    identityKey: text("identity_key").primaryKey(),
    unitId: text("unit_id")
      .notNull()
      .references(() => structureUnits.id),
    evidence: text("evidence").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_structure_links_unit").on(t.unitId)],
);
export const structureAudit = sqliteTable(
  "structure_audit",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    details: text("details").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_structure_audit_entity").on(t.entityId, t.createdAt)],
);
