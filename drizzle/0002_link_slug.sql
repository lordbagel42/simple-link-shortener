CREATE TABLE `link_slug` (
	`slug` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_pattern` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `link`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `link_slug_link_id_idx` ON `link_slug` (`link_id`);--> statement-breakpoint
CREATE INDEX `link_slug_pattern_idx` ON `link_slug` (`is_pattern`);--> statement-breakpoint
ALTER TABLE `link` ADD `preview_mode` text DEFAULT 'target' NOT NULL;--> statement-breakpoint
ALTER TABLE `link` ADD `preview_image` text;--> statement-breakpoint
--> Hand-written: `link_slug` is what makes a slug unique from here on, so every
--> existing link needs its primary slug in it. Nothing was a pattern before
--> this migration, so `is_pattern` stays 0 for all of them.
INSERT INTO `link_slug` (`slug`, `link_id`, `is_primary`, `is_pattern`, `created_at`)
SELECT `slug`, `id`, 1, 0, `created_at` FROM `link`;