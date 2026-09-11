ALTER TABLE `listing_events` ADD `event_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `listing_events`
SET `event_order` = COALESCE((
	SELECT CASE
		WHEN `work_logs`.`legacy_id` IS NOT NULL
			THEN (`work_logs`.`legacy_id` * 100) + COALESCE(`work_log_properties`.`sequence`, 0)
		ELSE (CAST(strftime('%s', COALESCE(`work_logs`.`created_at`, `listing_events`.`created_at`)) AS integer) * 100)
			+ COALESCE(`work_log_properties`.`sequence`, 0)
	END
	FROM `work_logs`
	LEFT JOIN `work_log_properties` ON `work_log_properties`.`id` = `listing_events`.`detail_id`
	WHERE `work_logs`.`id` = `listing_events`.`work_log_id`
), (CAST(strftime('%s', `created_at`) AS integer) * 100), 0)
WHERE `event_order` = 0;--> statement-breakpoint
CREATE INDEX `idx_listing_events_key_date_order` ON `listing_events` (`listing_key`,`event_date`,`event_order`);--> statement-breakpoint
ALTER TABLE `listings` ADD `source_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `listings`
SET `source_notes` = `notes`
WHERE `source_notes` = '' AND `id` LIKE 'excel-listing-%';
