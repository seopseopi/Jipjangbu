CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`due_date` text,
	`customer_id` text,
	`listing_key` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "follow_ups_title_length" CHECK(length(trim("follow_ups"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "follow_ups_notes_length" CHECK(length("follow_ups"."notes") <= 5000)
);
--> statement-breakpoint
CREATE INDEX `idx_follow_ups_completed_due` ON `follow_ups` (`completed_at`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_follow_ups_customer` ON `follow_ups` (`customer_id`);