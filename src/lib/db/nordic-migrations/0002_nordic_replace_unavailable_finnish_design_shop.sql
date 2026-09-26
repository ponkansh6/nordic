-- Custom SQL migration file, put your code below! --
DELETE FROM `nordic_sources`
WHERE `id` = 'finnish-design-shop'
	AND NOT EXISTS (
		SELECT 1
		FROM `nordic_articles`
		WHERE `source_id` = 'finnish-design-shop'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO `nordic_sources` (`id`, `name`, `site_url`, `feed_url`, `created_at`) VALUES
	('dezeen-finland', 'Dezeen · Finland', 'https://www.dezeen.com/tag/finland/', 'https://www.dezeen.com/tag/finland/feed/', CURRENT_TIMESTAMP);
