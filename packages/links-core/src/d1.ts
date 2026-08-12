import type { Env } from './env.js';
import type { DomainRecord, LinkRecord } from './link-record.js';
import type { CloakConfig, DeepLinkConfig, LinkRule, LinkVariant } from './types.js';
import type { ClickOutcome, VisitorSnapshot } from './clicks.js';

/**
 * Raw D1 statements for the redirect hot path.
 *
 * The dashboard uses Drizzle, which is the right tool for its ad-hoc queries.
 * The redirect Worker deliberately does not: pulling Drizzle in cost ~180 KiB
 * of bundle for a handful of fixed statements, and bundle size is isolate
 * start-up time on a path whose entire job is to be fast.
 *
 * These statements mirror `db/schema.ts`. Any migration that touches `link`,
 * `click`, `domain` or `webhook_delivery` needs a matching edit here — that is
 * the price of the split, and it is why everything raw lives in this one file.
 */

/* -------------------------------------------------------------------------- */
/*  Links                                                                      */
/* -------------------------------------------------------------------------- */

const LINK_COLUMNS = `l.id, l.slug, l.destination, l.user_id, l.domain_id, l.enabled,
	l.password_hash, l.expires_at, l.max_clicks, l.fallback_url, l.forward_query,
	l.redirect_status, l.rules, l.variants, l.deep_link, l.cloak, l.hide_referrer,
	l.track_conversions, l.utm_source, l.utm_medium, l.utm_campaign, l.utm_term, l.utm_content`;

type LinkRow = {
	id: string;
	slug: string;
	destination: string;
	user_id: string;
	domain_id: string;
	enabled: number;
	password_hash: string | null;
	expires_at: number | null;
	max_clicks: number | null;
	fallback_url: string | null;
	forward_query: number;
	redirect_status: number;
	rules: string | null;
	variants: string | null;
	deep_link: string | null;
	cloak: string | null;
	hide_referrer: number;
	track_conversions: number;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	utm_term: string | null;
	utm_content: string | null;
	host: string;
};

function parse<T>(raw: string | null, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/**
 * Built by hand rather than through `toLinkRecord`, because that takes a full
 * Drizzle row and this query deliberately selects only the redirect columns.
 */
function toRecord(row: LinkRow): LinkRecord {
	return {
		id: row.id,
		userId: row.user_id,
		domainId: row.domain_id,
		host: row.host,
		slug: row.slug,
		destination: row.destination,
		enabled: row.enabled === 1,
		expiresAt: row.expires_at,
		maxClicks: row.max_clicks,
		fallbackUrl: row.fallback_url,
		forwardQuery: row.forward_query === 1,
		redirectStatus: row.redirect_status,
		passwordHash: row.password_hash,
		rules: parse<LinkRule[]>(row.rules, []),
		variants: parse<LinkVariant[]>(row.variants, []),
		deepLink: parse<DeepLinkConfig | null>(row.deep_link, null),
		cloak: parse<CloakConfig | null>(row.cloak, null),
		hideReferrer: row.hide_referrer === 1,
		trackConversions: row.track_conversions === 1,
		utm: {
			source: row.utm_source,
			medium: row.utm_medium,
			campaign: row.utm_campaign,
			term: row.utm_term,
			content: row.utm_content
		}
	};
}

/**
 * Used only when KV misses, to repopulate the cache from the source of truth.
 *
 * An exact hostname match wins; otherwise the request falls through to whatever
 * default domain claims the slug, which is what makes `<prefix>/<slug>` resolve
 * on hosts that are not registered domains of their own.
 */
export async function findLinkBySlug(
	env: Env,
	host: string,
	slug: string
): Promise<LinkRecord | null> {
	const row = await env.DB.prepare(
		`SELECT ${LINK_COLUMNS}, d.hostname AS host
		 FROM link l
		 JOIN domain d ON d.id = l.domain_id
		 WHERE l.slug = ? AND (d.hostname = ? OR d.is_default = 1)
		 ORDER BY (d.hostname = ?) DESC
		 LIMIT 1`
	)
		.bind(slug, host, host)
		.first<LinkRow>();
	return row ? toRecord(row) : null;
}

/* -------------------------------------------------------------------------- */
/*  Domains                                                                    */
/* -------------------------------------------------------------------------- */

type DomainRow = {
	id: string;
	user_id: string;
	hostname: string;
	prefix: string;
	main_redirect: string | null;
	not_found_redirect: string | null;
	expired_redirect: string | null;
};

export async function findDomainByHost(env: Env, host: string): Promise<DomainRecord | null> {
	const row = await env.DB.prepare(
		`SELECT id, user_id, hostname, prefix, main_redirect, not_found_redirect, expired_redirect
		 FROM domain WHERE hostname = ? LIMIT 1`
	)
		.bind(host)
		.first<DomainRow>();

	if (!row) return null;
	return {
		id: row.id,
		userId: row.user_id,
		hostname: row.hostname,
		prefix: row.prefix,
		mainRedirect: row.main_redirect,
		notFoundRedirect: row.not_found_redirect,
		expiredRedirect: row.expired_redirect
	};
}

/* -------------------------------------------------------------------------- */
/*  Clicks                                                                     */
/* -------------------------------------------------------------------------- */

/** Has this visitor hash been seen on this link before? Drives unique counts. */
export async function hasSeenVisitor(
	env: Env,
	linkId: string,
	visitorHash: string
): Promise<boolean> {
	const row = await env.DB.prepare(
		`SELECT 1 AS seen FROM click WHERE link_id = ? AND visitor_hash = ? LIMIT 1`
	)
		.bind(linkId, visitorHash)
		.first<{ seen: number }>();
	return row !== null;
}

const CLICK_COLUMNS = [
	'id',
	'link_id',
	'user_id',
	'domain_id',
	'slug',
	'timestamp',

	'destination',
	'variant',
	'rule_matched',
	'response_status',
	'processing_ms',

	'ip',
	'ip_version',
	'visitor_hash',
	'is_new_visitor',

	'country',
	'region',
	'region_code',
	'city',
	'postal_code',
	'continent',
	'latitude',
	'longitude',
	'timezone',
	'metro_code',
	'is_eu_country',

	'colo',
	'asn',
	'as_organization',
	'http_protocol',
	'tls_version',
	'tls_cipher',
	'client_tcp_rtt',
	'client_accept_encoding',
	'request_priority',
	'edge_keep_alive',
	'cf_ray',

	'verified_bot_category',
	'bot_score',
	'is_verified_bot',
	'is_corporate_proxy',
	'is_static_resource',
	'ja3_hash',
	'ja4',

	'user_agent',
	'browser',
	'browser_version',
	'engine',
	'engine_version',
	'os',
	'os_version',
	'device_type',
	'device_vendor',
	'device_model',
	'is_bot',
	'language',
	'accept_language',
	'accept',
	'accept_encoding',

	'ch_ua',
	'ch_platform',
	'ch_platform_version',
	'ch_mobile',
	'ch_model',
	'ch_arch',
	'ch_bitness',
	'ch_full_version_list',

	'sec_fetch_site',
	'sec_fetch_mode',
	'sec_fetch_dest',
	'sec_fetch_user',
	'dnt',
	'gpc',

	'method',
	'hostname',
	'path',
	'query_string',
	'is_qr',

	'referer',
	'referer_domain',
	'referer_path',

	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'ad_click_id',
	'ad_network'
] as const;

const INSERT_CLICK = `INSERT INTO click (${CLICK_COLUMNS.join(', ')}) VALUES (${CLICK_COLUMNS.map(
	() => '?'
).join(', ')})`;

const bit = (value: boolean | null | undefined) =>
	value === null || value === undefined ? null : value ? 1 : 0;

/**
 * Insert the click and bump the link's counters in one D1 batch — one network
 * round trip instead of two. Returns the link's new click count so the caller
 * can enforce a click cap.
 */
export async function writeClick(
	env: Env,
	record: LinkRecord,
	visitor: VisitorSnapshot,
	outcome: ClickOutcome,
	visitorHash: string | null,
	isNewVisitor: boolean,
	now: number
): Promise<number | null> {
	const values = [
		outcome.id,
		record.id,
		record.userId,
		record.domainId,
		record.slug,
		now,

		outcome.destination,
		outcome.variant,
		outcome.rule,
		outcome.responseStatus,
		outcome.processingMs,

		visitor.ip,
		visitor.ipVersion,
		visitorHash,
		bit(isNewVisitor),

		visitor.country,
		visitor.region,
		visitor.regionCode,
		visitor.city,
		visitor.postalCode,
		visitor.continent,
		visitor.latitude,
		visitor.longitude,
		visitor.timezone,
		visitor.metroCode,
		bit(visitor.isEuCountry),

		visitor.colo,
		visitor.asn,
		visitor.asOrganization,
		visitor.httpProtocol,
		visitor.tlsVersion,
		visitor.tlsCipher,
		visitor.clientTcpRtt,
		visitor.clientAcceptEncoding,
		visitor.requestPriority,
		visitor.edgeKeepAlive,
		visitor.cfRay,

		visitor.verifiedBotCategory,
		visitor.botScore,
		bit(visitor.isVerifiedBot),
		bit(visitor.isCorporateProxy),
		bit(visitor.isStaticResource),
		visitor.ja3Hash,
		visitor.ja4,

		visitor.userAgent,
		visitor.ua.browser,
		visitor.ua.browserVersion,
		visitor.ua.engine,
		visitor.ua.engineVersion,
		visitor.ua.os,
		visitor.ua.osVersion,
		visitor.ua.deviceType,
		visitor.ua.deviceVendor,
		visitor.ua.deviceModel ?? visitor.chModel,
		bit(visitor.ua.isBot),
		visitor.language,
		visitor.acceptLanguage,
		visitor.accept,
		visitor.acceptEncoding,

		visitor.chUa,
		visitor.chPlatform,
		visitor.chPlatformVersion,
		visitor.chMobile,
		visitor.chModel,
		visitor.chArch,
		visitor.chBitness,
		visitor.chFullVersionList,

		visitor.secFetchSite,
		visitor.secFetchMode,
		visitor.secFetchDest,
		visitor.secFetchUser,
		visitor.dnt,
		visitor.gpc,

		visitor.method,
		visitor.hostname,
		visitor.path,
		visitor.queryString,
		bit(visitor.isQr),

		visitor.referer,
		visitor.refererDomain,
		visitor.refererPath,

		// The incoming query wins: a UTM on the short link itself describes where
		// the click came from, which is more specific than the link's own tags.
		visitor.utmSource ?? record.utm.source,
		visitor.utmMedium ?? record.utm.medium,
		visitor.utmCampaign ?? record.utm.campaign,
		visitor.utmTerm ?? record.utm.term,
		visitor.utmContent ?? record.utm.content,
		visitor.adClickId,
		visitor.adNetwork
	];

	const [, counters] = await env.DB.batch<{ click_count: number }>([
		env.DB.prepare(INSERT_CLICK).bind(...values),
		env.DB.prepare(
			`UPDATE link
			 SET click_count = click_count + 1,
			     unique_count = unique_count + ?,
			     last_clicked_at = ?
			 WHERE id = ?
			 RETURNING click_count`
		).bind(isNewVisitor ? 1 : 0, now, record.id)
	]);

	return counters.results[0]?.click_count ?? null;
}

/** Trip the click cap. The caller republishes the KV record afterwards. */
export async function disableLink(env: Env, linkId: string, now: number): Promise<void> {
	await env.DB.prepare(`UPDATE link SET enabled = 0, updated_at = ? WHERE id = ?`)
		.bind(now, linkId)
		.run();
}

/* -------------------------------------------------------------------------- */
/*  Webhook deliveries                                                         */
/* -------------------------------------------------------------------------- */

export async function writeWebhookDelivery(
	env: Env,
	delivery: {
		id: string;
		webhookId: string;
		userId: string;
		event: string;
		status: number | null;
		error: string | null;
		durationMs: number;
		timestamp: number;
	}
): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO webhook_delivery
		 (id, webhook_id, user_id, event, status, error, duration_ms, timestamp)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	)
		.bind(
			delivery.id,
			delivery.webhookId,
			delivery.userId,
			delivery.event,
			delivery.status,
			delivery.error?.slice(0, 500) ?? null,
			delivery.durationMs,
			delivery.timestamp
		)
		.run();

	await env.DB.prepare(
		`UPDATE webhook
		 SET last_status = ?, last_fired_at = ?,
		     failure_count = CASE WHEN ? THEN 0 ELSE failure_count + 1 END
		 WHERE id = ?`
	)
		.bind(delivery.status, delivery.timestamp, delivery.error ? 0 : 1, delivery.webhookId)
		.run();
}
