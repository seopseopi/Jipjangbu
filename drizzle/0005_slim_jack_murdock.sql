CREATE TABLE `trash_records` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`snapshot` text NOT NULL,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "trash_records_entity_type" CHECK("trash_records"."entity_type" IN ('work', 'customer', 'followup'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trash_records_entity` ON `trash_records` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_trash_records_deleted` ON `trash_records` (`deleted_at`,`id`);