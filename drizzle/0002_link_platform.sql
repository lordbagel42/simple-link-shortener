CREATE TABLE `conversion` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`link_id` text NOT NULL,
	`click_id` text,
	`slug` text,
	`event` text DEFAULT 'conversion' NOT NULL,
	`value` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`metadata` text,
	`latency_ms` integer,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `link`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversion_user_timestamp_idx` ON `conversion` (`user_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `conversion_link_timestamp_idx` ON `conversion` (`link_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `conversion_click_idx` ON `conversion` (`click_id`);--> statement-breakpoint
CREATE TABLE `domain` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hostname` text NOT NULL,
	`label` text,
	`prefix` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`slug_length` integer DEFAULT 6 NOT NULL,
	`redirect_status` integer DEFAULT 302 NOT NULL,
	`main_redirect` text,
	`not_found_redirect` text,
	`expired_redirect` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_hostname_idx` ON `domain` (`hostname`);--> statement-breakpoint
CREATE INDEX `domain_user_id_idx` ON `domain` (`user_id`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'slate' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_user_name_idx` ON `folder` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `webhook` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`secret` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_status` integer,
	`last_fired_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_user_id_idx` ON `webhook` (`user_id`);--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event` text NOT NULL,
	`status` integer,
	`error` text,
	`duration_ms` integer,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhook`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_delivery_hook_timestamp_idx` ON `webhook_delivery` (`webhook_id`,`timestamp`);--> statement-breakpoint
DROP INDEX `link_slug_idx`;--> statement-breakpoint
-- Every existing user gets a default domain to hold the links they already
-- have. The hostname is a placeholder: `ensureDefaultDomain` rewrites it to the
-- host derived from SHORT_URL / SHORT_HOSTS the first time the dashboard loads,
-- and until then the redirect path still finds these links through the
-- `is_default = 1` fallback in `findLinkBySlug`.
INSERT INTO `domain`
	(`id`, `user_id`, `hostname`, `label`, `prefix`, `is_default`, `slug_length`,
	 `redirect_status`, `created_at`, `updated_at`)
SELECT
	'dom-' || `id`, `id`, 'default-' || `id`, 'Default', '', true, 6, 302,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000,
	CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM `user`;--> statement-breakpoint
-- Added nullable because SQLite refuses `ADD COLUMN … NOT NULL REFERENCES`
-- outright. The backfill below fills it, and every write path sets it, which is
-- why the Drizzle definition still declares it `notNull()`.
ALTER TABLE `link` ADD `domain_id` text;--> statement-breakpoint
ALTER TABLE `link` ADD `folder_id` text REFERENCES folder(id);--> statement-breakpoint
ALTER TABLE `link` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `link` ADD `variants` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `link` ADD `deep_link` text;--> statement-breakpoint
ALTER TABLE `link` ADD `cloak` text;--> statement-breakpoint
ALTER TABLE `link` ADD `hide_referrer` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `link` ADD `track_conversions` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `link` ADD `qr_options` text;--> statement-breakpoint
ALTER TABLE `link` ADD `conversion_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `link` ADD `conversion_value` real DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `link` SET `domain_id` = 'dom-' || `user_id` WHERE `domain_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `link_domain_slug_idx` ON `link` (`domain_id`,`slug`);--> statement-breakpoint
CREATE INDEX `link_folder_id_idx` ON `link` (`folder_id`);--> statement-breakpoint
ALTER TABLE `click` ADD `domain_id` text;--> statement-breakpoint
ALTER TABLE `click` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `click` ADD `variant` text;--> statement-breakpoint
ALTER TABLE `click` ADD `rule_matched` text;--> statement-breakpoint
ALTER TABLE `click` ADD `response_status` integer;--> statement-breakpoint
ALTER TABLE `click` ADD `processing_ms` integer;--> statement-breakpoint
ALTER TABLE `click` ADD `ip_version` integer;--> statement-breakpoint
ALTER TABLE `click` ADD `metro_code` text;--> statement-breakpoint
ALTER TABLE `click` ADD `client_accept_encoding` text;--> statement-breakpoint
ALTER TABLE `click` ADD `request_priority` text;--> statement-breakpoint
ALTER TABLE `click` ADD `edge_keep_alive` text;--> statement-breakpoint
ALTER TABLE `click` ADD `cf_ray` text;--> statement-breakpoint
ALTER TABLE `click` ADD `is_verified_bot` integer;--> statement-breakpoint
ALTER TABLE `click` ADD `is_corporate_proxy` integer;--> statement-breakpoint
ALTER TABLE `click` ADD `is_static_resource` integer;--> statement-breakpoint
ALTER TABLE `click` ADD `ja3_hash` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ja4` text;--> statement-breakpoint
ALTER TABLE `click` ADD `engine` text;--> statement-breakpoint
ALTER TABLE `click` ADD `engine_version` text;--> statement-breakpoint
ALTER TABLE `click` ADD `device_model` text;--> statement-breakpoint
ALTER TABLE `click` ADD `accept_language` text;--> statement-breakpoint
ALTER TABLE `click` ADD `accept` text;--> statement-breakpoint
ALTER TABLE `click` ADD `accept_encoding` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_ua` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_platform` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_platform_version` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_mobile` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_model` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_arch` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_bitness` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ch_full_version_list` text;--> statement-breakpoint
ALTER TABLE `click` ADD `sec_fetch_site` text;--> statement-breakpoint
ALTER TABLE `click` ADD `sec_fetch_mode` text;--> statement-breakpoint
ALTER TABLE `click` ADD `sec_fetch_dest` text;--> statement-breakpoint
ALTER TABLE `click` ADD `sec_fetch_user` text;--> statement-breakpoint
ALTER TABLE `click` ADD `dnt` text;--> statement-breakpoint
ALTER TABLE `click` ADD `gpc` text;--> statement-breakpoint
ALTER TABLE `click` ADD `method` text;--> statement-breakpoint
ALTER TABLE `click` ADD `hostname` text;--> statement-breakpoint
ALTER TABLE `click` ADD `path` text;--> statement-breakpoint
ALTER TABLE `click` ADD `is_qr` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `click` ADD `referer_path` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ad_click_id` text;--> statement-breakpoint
ALTER TABLE `click` ADD `ad_network` text;--> statement-breakpoint
-- Denormalise the link's domain and slug onto history, so domain-scoped
-- analytics never has to join and a deleted link's clicks keep their label.
UPDATE `click` SET
	`domain_id` = (SELECT `l`.`domain_id` FROM `link` `l` WHERE `l`.`id` = `click`.`link_id`),
	`slug` = (SELECT `l`.`slug` FROM `link` `l` WHERE `l`.`id` = `click`.`link_id`),
	`response_status` = (SELECT `l`.`redirect_status` FROM `link` `l` WHERE `l`.`id` = `click`.`link_id`)
WHERE `domain_id` IS NULL;--> statement-breakpoint
CREATE INDEX `click_domain_id_timestamp_idx` ON `click` (`domain_id`,`timestamp`);