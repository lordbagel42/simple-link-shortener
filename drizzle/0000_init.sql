CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_hash_idx` ON `api_key` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_key_user_id_idx` ON `api_key` (`user_id`);--> statement-breakpoint
CREATE TABLE `click` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`user_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`destination` text NOT NULL,
	`visitor_hash` text,
	`is_new_visitor` integer DEFAULT true NOT NULL,
	`country` text,
	`region` text,
	`region_code` text,
	`city` text,
	`postal_code` text,
	`continent` text,
	`latitude` text,
	`longitude` text,
	`timezone` text,
	`is_eu_country` integer,
	`colo` text,
	`asn` integer,
	`as_organization` text,
	`http_protocol` text,
	`tls_version` text,
	`tls_cipher` text,
	`client_tcp_rtt` integer,
	`verified_bot_category` text,
	`bot_score` integer,
	`user_agent` text,
	`browser` text,
	`browser_version` text,
	`os` text,
	`os_version` text,
	`device_type` text,
	`device_vendor` text,
	`is_bot` integer DEFAULT false NOT NULL,
	`language` text,
	`referer` text,
	`referer_domain` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_term` text,
	`utm_content` text,
	`query_string` text,
	FOREIGN KEY (`link_id`) REFERENCES `link`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `click_link_id_timestamp_idx` ON `click` (`link_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `click_user_id_timestamp_idx` ON `click` (`user_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `click_visitor_hash_idx` ON `click` (`link_id`,`visitor_hash`);--> statement-breakpoint
CREATE TABLE `link` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`destination` text NOT NULL,
	`title` text,
	`description` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`user_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`password_hash` text,
	`expires_at` integer,
	`max_clicks` integer,
	`fallback_url` text,
	`forward_query` integer DEFAULT false NOT NULL,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_term` text,
	`utm_content` text,
	`redirect_status` integer DEFAULT 302 NOT NULL,
	`rules` text DEFAULT '[]' NOT NULL,
	`click_count` integer DEFAULT 0 NOT NULL,
	`unique_count` integer DEFAULT 0 NOT NULL,
	`last_clicked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `link_slug_idx` ON `link` (`slug`);--> statement-breakpoint
CREATE INDEX `link_user_id_idx` ON `link` (`user_id`);--> statement-breakpoint
CREATE INDEX `link_created_at_idx` ON `link` (`created_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);