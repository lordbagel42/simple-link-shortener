import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { LinkRule } from '$lib/types';

/* -------------------------------------------------------------------------- */
/*  better-auth core schema                                                    */
/* -------------------------------------------------------------------------- */

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('session_user_id_idx').on(t.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text('scope'),
		idToken: text('id_token'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('account_user_id_idx').on(t.userId)]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

/* -------------------------------------------------------------------------- */
/*  Links                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Targeting rules are stored as JSON on the link and mirrored into KV so the
 * redirect hot path can evaluate them without touching D1.
 */
export type { LinkRule };

export const link = sqliteTable(
	'link',
	{
		id: text('id').primaryKey(),
		/** The path segment after the short prefix, e.g. `gh` in `raygen.dev/l/gh`. */
		slug: text('slug').notNull(),
		destination: text('destination').notNull(),

		title: text('title'),
		description: text('description'),
		/** JSON string array. */
		tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),

		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		/** When set, visitors must enter this password (PBKDF2, see server/crypto.ts). */
		passwordHash: text('password_hash'),

		/** Epoch ms after which the link stops resolving. */
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		/** Hard cap on clicks; the link disables itself once reached. */
		maxClicks: integer('max_clicks'),
		/** Where expired / exhausted / disabled visitors go. Falls back to a 410 page. */
		fallbackUrl: text('fallback_url'),

		/** Forward the incoming query string onto the destination. */
		forwardQuery: integer('forward_query', { mode: 'boolean' }).notNull().default(false),
		/** UTM parameters appended to the destination on every redirect. */
		utmSource: text('utm_source'),
		utmMedium: text('utm_medium'),
		utmCampaign: text('utm_campaign'),
		utmTerm: text('utm_term'),
		utmContent: text('utm_content'),

		/** 301 | 302 | 307 | 308. */
		redirectStatus: integer('redirect_status').notNull().default(302),
		/** Geo/device targeting rules, evaluated in order before the default destination. */
		rules: text('rules', { mode: 'json' }).$type<LinkRule[]>().notNull().default([]),

		/** Denormalised counters so the list view never scans the clicks table. */
		clickCount: integer('click_count').notNull().default(0),
		uniqueCount: integer('unique_count').notNull().default(0),
		lastClickedAt: integer('last_clicked_at', { mode: 'timestamp_ms' }),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		uniqueIndex('link_slug_idx').on(t.slug),
		index('link_user_id_idx').on(t.userId),
		index('link_created_at_idx').on(t.createdAt)
	]
);

export type Link = typeof link.$inferSelect;
export type NewLink = typeof link.$inferInsert;

/* -------------------------------------------------------------------------- */
/*  Clicks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One row per resolved redirect. Everything Cloudflare hands us about the
 * request is persisted here — the dashboard reads from this table.
 */
export const click = sqliteTable(
	'click',
	{
		id: text('id').primaryKey(),
		linkId: text('link_id')
			.notNull()
			.references(() => link.id, { onDelete: 'cascade' }),
		/** Denormalised so per-user analytics never needs a join. */
		userId: text('user_id').notNull(),
		timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),

		/** Where this particular visitor was actually sent (rules can override). */
		destination: text('destination').notNull(),

		/* --- visitor identity (no raw IPs are ever stored) --- */
		/** SHA-256 of `salt:ip:user-agent`, truncated. Used for unique-visitor counts. */
		visitorHash: text('visitor_hash'),
		isNewVisitor: integer('is_new_visitor', { mode: 'boolean' }).notNull().default(true),

		/* --- geo (request.cf) --- */
		country: text('country'),
		region: text('region'),
		regionCode: text('region_code'),
		city: text('city'),
		postalCode: text('postal_code'),
		continent: text('continent'),
		latitude: text('latitude'),
		longitude: text('longitude'),
		timezone: text('timezone'),
		isEuCountry: integer('is_eu_country', { mode: 'boolean' }),

		/* --- network (request.cf) --- */
		colo: text('colo'),
		asn: integer('asn'),
		asOrganization: text('as_organization'),
		httpProtocol: text('http_protocol'),
		tlsVersion: text('tls_version'),
		tlsCipher: text('tls_cipher'),
		clientTcpRtt: integer('client_tcp_rtt'),
		verifiedBotCategory: text('verified_bot_category'),
		botScore: integer('bot_score'),

		/* --- client (headers / UA) --- */
		userAgent: text('user_agent'),
		browser: text('browser'),
		browserVersion: text('browser_version'),
		os: text('os'),
		osVersion: text('os_version'),
		deviceType: text('device_type'),
		deviceVendor: text('device_vendor'),
		isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
		language: text('language'),

		/* --- attribution --- */
		referer: text('referer'),
		refererDomain: text('referer_domain'),
		utmSource: text('utm_source'),
		utmMedium: text('utm_medium'),
		utmCampaign: text('utm_campaign'),
		utmTerm: text('utm_term'),
		utmContent: text('utm_content'),
		/** Raw query string the short link was hit with. */
		queryString: text('query_string')
	},
	(t) => [
		index('click_link_id_timestamp_idx').on(t.linkId, t.timestamp),
		index('click_user_id_timestamp_idx').on(t.userId, t.timestamp),
		index('click_visitor_hash_idx').on(t.linkId, t.visitorHash)
	]
);

export type Click = typeof click.$inferSelect;
export type NewClick = typeof click.$inferInsert;

/* -------------------------------------------------------------------------- */
/*  API keys                                                                   */
/* -------------------------------------------------------------------------- */

export const apiKey = sqliteTable(
	'api_key',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** SHA-256 of the token. The plaintext is shown exactly once, at creation. */
		keyHash: text('key_hash').notNull(),
		/** First few characters, so keys are recognisable in the UI. */
		prefix: text('prefix').notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [uniqueIndex('api_key_hash_idx').on(t.keyHash), index('api_key_user_id_idx').on(t.userId)]
);

export type ApiKey = typeof apiKey.$inferSelect;

export const schema = {
	user,
	session,
	account,
	verification,
	link,
	click,
	apiKey
};
