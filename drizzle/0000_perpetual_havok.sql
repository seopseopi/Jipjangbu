CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_key` text NOT NULL,
	`work_log_id` text NOT NULL,
	`detail_id` text NOT NULL,
	`event_date` text NOT NULL,
	`status` text NOT NULL,
	`property_type` text NOT NULL,
	`building_name` text NOT NULL,
	`building_dong` text DEFAULT '' NOT NULL,
	`unit_number` text DEFAULT '' NOT NULL,
	`size_type` text DEFAULT '' NOT NULL,
	`sale_price` text DEFAULT '' NOT NULL,
	`jeonse_price` text DEFAULT '' NOT NULL,
	`monthly_rent` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`work_log_id`) REFERENCES `work_logs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_listing_events_detail` ON `listing_events` (`detail_id`);--> statement-breakpoint
CREATE INDEX `idx_listing_events_key_date` ON `listing_events` (`listing_key`,`event_date`);--> statement-breakpoint
CREATE INDEX `idx_listing_events_work_log` ON `listing_events` (`work_log_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`registered_at` text,
	`closed_at` text,
	`status` text NOT NULL,
	`property_type` text NOT NULL,
	`building_name` text NOT NULL,
	`building_dong` text DEFAULT '' NOT NULL,
	`unit_number` text DEFAULT '' NOT NULL,
	`size_type` text DEFAULT '' NOT NULL,
	`sale_price` text DEFAULT '' NOT NULL,
	`jeonse_price` text DEFAULT '' NOT NULL,
	`monthly_rent` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_listings_identity` ON `listings` (`identity_key`);--> statement-breakpoint
CREATE INDEX `idx_listings_status` ON `listings` (`closed_at`,`status`);--> statement-breakpoint
CREATE INDEX `idx_listings_building` ON `listings` (`property_type`,`building_name`);--> statement-breakpoint
CREATE TABLE `property_buildings` (
	`id` text PRIMARY KEY NOT NULL,
	`property_type` text NOT NULL,
	`building_name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_property_buildings_unique` ON `property_buildings` (`property_type`,`building_name`);--> statement-breakpoint
CREATE TABLE `work_log_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`work_log_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`property_type` text DEFAULT '' NOT NULL,
	`building_name` text DEFAULT '' NOT NULL,
	`building_dong` text DEFAULT '' NOT NULL,
	`unit_number` text DEFAULT '' NOT NULL,
	`size_type` text DEFAULT '' NOT NULL,
	`sale_price` text DEFAULT '' NOT NULL,
	`jeonse_price` text DEFAULT '' NOT NULL,
	`monthly_rent` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`work_log_id`) REFERENCES `work_logs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_work_log_properties_log` ON `work_log_properties` (`work_log_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_work_log_properties_address` ON `work_log_properties` (`building_name`,`building_dong`,`unit_number`);--> statement-breakpoint
CREATE TABLE `work_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_id` integer,
	`work_date` text NOT NULL,
	`customer_id` text NOT NULL,
	`work_type` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_work_logs_date` ON `work_logs` (`work_date`);--> statement-breakpoint
CREATE INDEX `idx_work_logs_customer` ON `work_logs` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_work_logs_type_date` ON `work_logs` (`work_type`,`work_date`);--> statement-breakpoint
CREATE TABLE `work_types` (
	`name` text PRIMARY KEY NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
