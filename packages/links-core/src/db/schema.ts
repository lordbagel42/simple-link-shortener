import {
	sqliteTable,
	text,
	integer,
	real,
	index,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import type {
	CloakConfig,
	DeepLinkConfig,
	LinkRule,
	LinkVariant,
	QrOptions,
	WebhookEvent
} from '../types.js';

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
/*  Domains                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A hostname that serves short links. Slugs are unique per domain, so the same
 * slug can point somewhere different on each one.
 *
 * The default domain is also the fallback namespace: it answers for
 * `<SHORT_PREFIX>/<slug>` on any host that is not itself registered, which is
 * what keeps `localhost:5173/l/<slug>` working in development.
 */
export const domain = sqliteTable(
	'domain',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		/** Lowercased, no scheme, no trailing dot: `link.raygen.dev`. */
		hostname: text('hostname').notNull(),
		/** Human label for the picker. */
		label: text('label'),
		/**
		 * Path prefix this domain serves links under, e.g. `/l` for
		 * `raygen.dev/l/<slug>`. Empty means slugs sit at the root.
		 */
		prefix: text('prefix').notNull().default(''),

		/** Exactly one per user. Receives links created without an explicit domain. */
		isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),

		/** Length of generated slugs on this domain. */
		slugLength: integer('slug_length').notNull().default(6),
		/** Default status code for links created here. */
		redirectStatus: integer('redirect_status').notNull().default(302),

		/** Where `https://<hostname>/` goes. Falls through to the dashboard when null. */
		mainRedirect: text('main_redirect'),
		/** Where an unknown slug goes. Falls through to the 404 page when null. */
		notFoundRedirect: text('not_found_redirect'),
		/** Domain-wide fallback for expired or disabled links, unless the link overrides it. */
		expiredRedirect: text('expired_redirect'),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		uniqueIndex('domain_hostname_idx').on(t.hostname),
		index('domain_user_id_idx').on(t.userId)
	]
);

export type Domain = typeof domain.$inferSelect;
export type NewDomain = typeof domain.$inferInsert;

/* -------------------------------------------------------------------------- */
/*  Folders                                                                    */
/* -------------------------------------------------------------------------- */

export const folder = sqliteTable(
	'folder',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		/** Tailwind-ish accent used by the dashboard chip. */
		color: text('color').notNull().default('slate'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [uniqueIndex('folder_user_name_idx').on(t.userId, t.name)]
);

export type Folder = typeof folder.$inferSelect;

/* -------------------------------------------------------------------------- */
/*  Links                                                                      */
/* -------------------------------------------------------------------------- */

export type { LinkRule, LinkVariant, DeepLinkConfig, CloakConfig, QrOptions };

export const link = sqliteTable(
	'link',
	{
		id: text('id').primaryKey(),
		/** The path segment after the domain's prefix, e.g. `gh` in `raygen.dev/l/gh`. */
		slug: text('slug').notNull(),
		destination: text('destination').notNull(),

		domainId: text('domain_id')
			.notNull()
			.references(() => domain.id, { onDelete: 'cascade' }),
		folderId: text('folder_id').references(() => folder.id, { onDelete: 'set null' }),

		title: text('title'),
		description: text('description'),
		/** JSON string array. */
		tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),

		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		/** Hidden from the dashboard but still resolving — Short.io's archive semantics. */
		archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
		/** When set, visitors must enter this password (PBKDF2, see crypto.ts). */
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
		/** Weighted split test. Evaluated after rules, before the default destination. */
		variants: text('variants', { mode: 'json' }).$type<LinkVariant[]>().notNull().default([]),
		/** Mobile app targeting. */
		deepLink: text('deep_link', { mode: 'json' }).$type<DeepLinkConfig | null>(),
		/** Frame the destination instead of redirecting, keeping the short URL visible. */
		cloak: text('cloak', { mode: 'json' }).$type<CloakConfig | null>(),
		/** Strip the referrer so the destination cannot see where the click came from. */
		hideReferrer: integer('hide_referrer', { mode: 'boolean' }).notNull().default(false),
		/** Append `clid=<click id>` so conversions can be attributed back. */
		trackConversions: integer('track_conversions', { mode: 'boolean' }).notNull().default(false),
		/** Remembered QR styling for this link. */
		qrOptions: text('qr_options', { mode: 'json' }).$type<Partial<QrOptions> | null>(),

		/** Denormalised counters so the list view never scans the clicks table. */
		clickCount: integer('click_count').notNull().default(0),
		uniqueCount: integer('unique_count').notNull().default(0),
		conversionCount: integer('conversion_count').notNull().default(0),
		conversionValue: real('conversion_value').notNull().default(0),
		lastClickedAt: integer('last_clicked_at', { mode: 'timestamp_ms' }),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		uniqueIndex('link_domain_slug_idx').on(t.domainId, t.slug),
		index('link_user_id_idx').on(t.userId),
		index('link_folder_id_idx').on(t.folderId),
		index('link_created_at_idx').on(t.createdAt)
	]
);

export type Link = typeof link.$inferSelect;
export type NewLink = typeof link.$inferInsert;

/* -------------------------------------------------------------------------- */
/*  Clicks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One row per resolved redirect.
 *
 * The policy here is to keep everything the edge knows and never go back for
 * it later: every `request.cf` property, every client hint, every fetch
 * metadata header, and the decision the redirect path made. Columns are cheap;
 * a click that was never recorded is gone.
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
		domainId: text('domain_id'),
		slug: text('slug'),
		timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),

		/* --- what we decided --- */
		/** Where this particular visitor was actually sent. */
		destination: text('destination').notNull(),
		/** Label of the A/B arm that served them, when the link is split. */
		variant: text('variant'),
		/** `country:US` — which targeting rule fired, if any. */
		ruleMatched: text('rule_matched'),
		/** The status we returned: 301/302/307/308, or 200 for cloak and interstitials. */
		responseStatus: integer('response_status'),
		/** How long resolution took at the edge, in whole milliseconds. */
		processingMs: integer('processing_ms'),

		/* --- visitor identity --- */
		/** Raw client address from `cf-connecting-ip`. */
		ip: text('ip'),
		ipVersion: integer('ip_version'),
		/** SHA-256 of `salt:link:ip:user-agent`, truncated. Drives unique counts. */
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
		metroCode: text('metro_code'),
		isEuCountry: integer('is_eu_country', { mode: 'boolean' }),

		/* --- network (request.cf) --- */
		colo: text('colo'),
		asn: integer('asn'),
		asOrganization: text('as_organization'),
		httpProtocol: text('http_protocol'),
		tlsVersion: text('tls_version'),
		tlsCipher: text('tls_cipher'),
		clientTcpRtt: integer('client_tcp_rtt'),
		clientAcceptEncoding: text('client_accept_encoding'),
		requestPriority: text('request_priority'),
		edgeKeepAlive: text('edge_keep_alive'),
		cfRay: text('cf_ray'),

		/* --- bot management (request.cf.botManagement) --- */
		verifiedBotCategory: text('verified_bot_category'),
		botScore: integer('bot_score'),
		isVerifiedBot: integer('is_verified_bot', { mode: 'boolean' }),
		isCorporateProxy: integer('is_corporate_proxy', { mode: 'boolean' }),
		isStaticResource: integer('is_static_resource', { mode: 'boolean' }),
		ja3Hash: text('ja3_hash'),
		ja4: text('ja4'),

		/* --- client (headers / UA) --- */
		userAgent: text('user_agent'),
		browser: text('browser'),
		browserVersion: text('browser_version'),
		engine: text('engine'),
		engineVersion: text('engine_version'),
		os: text('os'),
		osVersion: text('os_version'),
		deviceType: text('device_type'),
		deviceVendor: text('device_vendor'),
		deviceModel: text('device_model'),
		isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
		/** First entry of `accept-language`. */
		language: text('language'),
		acceptLanguage: text('accept_language'),
		accept: text('accept'),
		acceptEncoding: text('accept_encoding'),

		/* --- user-agent client hints --- */
		chUa: text('ch_ua'),
		chPlatform: text('ch_platform'),
		chPlatformVersion: text('ch_platform_version'),
		chMobile: text('ch_mobile'),
		chModel: text('ch_model'),
		chArch: text('ch_arch'),
		chBitness: text('ch_bitness'),
		chFullVersionList: text('ch_full_version_list'),

		/* --- fetch metadata and privacy signals --- */
		secFetchSite: text('sec_fetch_site'),
		secFetchMode: text('sec_fetch_mode'),
		secFetchDest: text('sec_fetch_dest'),
		secFetchUser: text('sec_fetch_user'),
		dnt: text('dnt'),
		gpc: text('gpc'),

		/* --- the request itself --- */
		method: text('method'),
		hostname: text('hostname'),
		path: text('path'),
		/** Raw query string the short link was hit with. */
		queryString: text('query_string'),
		/** The QR codes this app generates carry `?qr=1`, so scans are separable. */
		isQr: integer('is_qr', { mode: 'boolean' }).notNull().default(false),

		/* --- attribution --- */
		referer: text('referer'),
		refererDomain: text('referer_domain'),
		refererPath: text('referer_path'),
		/** Effective UTMs: the incoming query wins, then the link's own tags. */
		utmSource: text('utm_source'),
		utmMedium: text('utm_medium'),
		utmCampaign: text('utm_campaign'),
		utmTerm: text('utm_term'),
		utmContent: text('utm_content'),
		/** `gclid` / `fbclid` / `msclkid` / `ttclid`, and which one it was. */
		adClickId: text('ad_click_id'),
		adNetwork: text('ad_network')
	},
	(t) => [
		index('click_link_id_timestamp_idx').on(t.linkId, t.timestamp),
		index('click_user_id_timestamp_idx').on(t.userId, t.timestamp),
		index('click_domain_id_timestamp_idx').on(t.domainId, t.timestamp),
		index('click_visitor_hash_idx').on(t.linkId, t.visitorHash),
		index('click_ip_idx').on(t.ip)
	]
);

export type Click = typeof click.$inferSelect;
export type NewClick = typeof click.$inferInsert;

/* -------------------------------------------------------------------------- */
/*  Conversions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * An action the visitor took after the click, reported back by the destination
 * site. Attribution runs through `clid` — the click's own id, appended to the
 * destination when the link has `trackConversions` on.
 */
export const conversion = sqliteTable(
	'conversion',
	{
		id: text('id').primaryKey(),
		userId: text('user_id').notNull(),
		linkId: text('link_id')
			.notNull()
			.references(() => link.id, { onDelete: 'cascade' }),
		/** The click this is attributed to. Null when reported without a `clid`. */
		clickId: text('click_id'),
		slug: text('slug'),

		/** Free-form name: `signup`, `purchase`, `trial_started`. */
		event: text('event').notNull().default('conversion'),
		value: real('value').notNull().default(0),
		currency: text('currency').notNull().default('USD'),
		/** Anything else the caller wants to keep. */
		metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),

		/** Milliseconds between the click and the conversion. */
		latencyMs: integer('latency_ms'),
		timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		index('conversion_user_timestamp_idx').on(t.userId, t.timestamp),
		index('conversion_link_timestamp_idx').on(t.linkId, t.timestamp),
		index('conversion_click_idx').on(t.clickId)
	]
);

export type Conversion = typeof conversion.$inferSelect;

/* -------------------------------------------------------------------------- */
/*  Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

export const webhook = sqliteTable(
	'webhook',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		description: text('description'),
		/** Shown once at creation, then used to sign every delivery. */
		secret: text('secret').notNull(),
		events: text('events', { mode: 'json' }).$type<WebhookEvent[]>().notNull().default([]),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

		lastStatus: integer('last_status'),
		lastFiredAt: integer('last_fired_at', { mode: 'timestamp_ms' }),
		failureCount: integer('failure_count').notNull().default(0),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('webhook_user_id_idx').on(t.userId)]
);

export type Webhook = typeof webhook.$inferSelect;

/** A rolling log so a failing endpoint is visible without leaving the dashboard. */
export const webhookDelivery = sqliteTable(
	'webhook_delivery',
	{
		id: text('id').primaryKey(),
		webhookId: text('webhook_id')
			.notNull()
			.references(() => webhook.id, { onDelete: 'cascade' }),
		userId: text('user_id').notNull(),
		event: text('event').notNull(),
		status: integer('status'),
		error: text('error'),
		durationMs: integer('duration_ms'),
		timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('webhook_delivery_hook_timestamp_idx').on(t.webhookId, t.timestamp)]
);

export type WebhookDelivery = typeof webhookDelivery.$inferSelect;

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
	domain,
	folder,
	link,
	click,
	conversion,
	webhook,
	webhookDelivery,
	apiKey
};
