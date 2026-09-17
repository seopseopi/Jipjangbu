CREATE TABLE `structure_assignments` (
	`unit_id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`mirror` integer,
	`rotation` real,
	`actual_condition` text NOT NULL,
	`evidence` text NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `structure_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `structure_plan_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "structure_mirror" CHECK("structure_assignments"."mirror" IN (0,1)),
	CONSTRAINT "structure_condition" CHECK("structure_assignments"."actual_condition" IN ('unknown','base','expanded','remodeled'))
);
--> statement-breakpoint
CREATE TABLE `structure_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_structure_audit_entity` ON `structure_audit` (`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `structure_buildings` (
	`id` text PRIMARY KEY NOT NULL,
	`complex_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`complex_id`) REFERENCES `structure_complexes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `structure_building_name` ON `structure_buildings` (`complex_id`,`name`);--> statement-breakpoint
CREATE TABLE `structure_complexes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `structure_listing_links` (
	`identity_key` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `structure_units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_structure_links_unit` ON `structure_listing_links` (`unit_id`);--> statement-breakpoint
CREATE TABLE `structure_plan_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`version` integer NOT NULL,
	`geometry_json` text NOT NULL,
	`source` text NOT NULL,
	`permission_evidence` text NOT NULL,
	`variant` text NOT NULL,
	`verified_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `structure_plan_types`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "structure_version_positive" CHECK("structure_plan_revisions"."version">0),
	CONSTRAINT "structure_geometry_json" CHECK(json_valid("structure_plan_revisions"."geometry_json")),
	CONSTRAINT "structure_variant" CHECK("structure_plan_revisions"."variant" IN ('base','expanded','remodeled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `structure_revision_version` ON `structure_plan_revisions` (`type_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_structure_revision_type` ON `structure_plan_revisions` (`type_id`,`version`);--> statement-breakpoint
CREATE TABLE `structure_plan_types` (
	`id` text PRIMARY KEY NOT NULL,
	`complex_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`complex_id`) REFERENCES `structure_complexes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `structure_type_name` ON `structure_plan_types` (`complex_id`,`name`);--> statement-breakpoint
CREATE TABLE `structure_units` (
	`id` text PRIMARY KEY NOT NULL,
	`building_id` text NOT NULL,
	`number` text NOT NULL,
	`floor` integer,
	`evidence` text NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `structure_buildings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `structure_unit_number` ON `structure_units` (`building_id`,`number`);