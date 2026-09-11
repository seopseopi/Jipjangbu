CREATE TABLE `app_runtime_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
DROP INDEX `idx_work_logs_date`;--> statement-breakpoint
DROP INDEX `idx_work_logs_customer`;--> statement-breakpoint
DROP INDEX `idx_work_logs_type_date`;--> statement-breakpoint
CREATE INDEX `idx_work_logs_date_updated_id` ON `work_logs` (`work_date`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_work_logs_customer_date_updated_id` ON `work_logs` (`customer_id`,`work_date`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_work_logs_type_date_updated_id` ON `work_logs` (`work_type`,`work_date`,`updated_at`,`id`);--> statement-breakpoint
PRAGMA optimize;
