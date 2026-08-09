ALTER TABLE `click` ADD `ip` text;--> statement-breakpoint
CREATE INDEX `click_ip_idx` ON `click` (`ip`);