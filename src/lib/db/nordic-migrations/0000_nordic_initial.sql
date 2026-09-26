CREATE TABLE `nordic_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`url_to_image` text,
	`published_at` text NOT NULL,
	`summary` text,
	`nordic_relevance` real,
	`recency` real,
	`score` real,
	`reason` text,
	`scored_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `nordic_sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nordic_articles_url_unique` ON `nordic_articles` (`url`);--> statement-breakpoint
CREATE INDEX `nordic_articles_source_score_published_idx` ON `nordic_articles` (`source_id`,`score`,`published_at`);--> statement-breakpoint
CREATE INDEX `nordic_articles_published_idx` ON `nordic_articles` (`published_at`);--> statement-breakpoint
CREATE TABLE `nordic_job_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nordic_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`site_url` text NOT NULL,
	`feed_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `nordic_sources` (`id`, `name`, `site_url`, `feed_url`, `created_at`) VALUES
	('finnish-design-shop', 'Finnish Design Shop · Design Stories', 'https://www.finnishdesignshop.com/en/design-stories', 'https://www.design-stories.com/feed/', CURRENT_TIMESTAMP),
	('lumene', 'Lumene', 'https://www.lumene.com/blogs/news', 'https://www.lumene.com/blogs/news.atom', CURRENT_TIMESTAMP);
