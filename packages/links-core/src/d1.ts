import type { Env } from './env.js';
import type { LinkRecord } from './link-record.js';
import type { LinkRule } from './types.js';
import type { VisitorSnapshot } from './clicks.js';

/**
 * Raw D1 statements for the redirect hot path.
 *
 * The dashboard uses Drizzle, which is the right tool for its ad-hoc queries.
 * The redirect Worker deliberately does not: pulling Drizzle in cost ~180 KiB
 * of bundle for three fixed statements, and bundle size is isolate start-up
 * time on a path whose entire job is to be fast.
 *
 * These statements mirror `db/schema.ts`. Any migration that touches `link` or
 * `click` needs a matching edit here — that is the price of the split, and it
 * is why everything raw lives in this one file.
 */

/** Columns of `link` that `LinkRecord` is built from. */
const LINK_COLUMNS = `id, slug, destination, user_id, enabled, password_hash, expires_at,
	max_clicks, fallback_url, forward_query, redirect_status, rules,
	utm_source, utm_medium, utm_campaign, utm_term, utm_content`;

type LinkRow = {
	id: string;
	slug: string;
	destination: string;
	user_id: string;
	enabled: number;
	password_hash: string | null;
	expires_at: number | null;
	max_clicks: number | null;
	fallback_url: string | null;
	forward_query: number;
	redirect_status: number;
	rules: string | null;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	utm_term: string | null;
	utm_content: string | null;
};

function toRecord(row: LinkRow): LinkRecord {
	let rules: LinkRule[] = [];
	try {
		rules = row.rules ? (JSON.parse(row.rules) as LinkRule[]) : [];
	} catch {
		rules = [];
	}

	return {
		id: row.id,
		userId: row.user_id,
		slug: row.slug,
		destination: row.destination,
		enabled: row.enabled === 1,
		expiresAt: row.expires_at,
		maxClicks: row.max_clicks,
		fallbackUrl: row.fallback_url,
		forwardQuery: row.forward_query === 1,
		redirectStatus: row.redirect_status,
		passwordHash: row.password_hash,
		rules,
		utm: {
			source: row.utm_source,
			medium: row.utm_medium,
			campaign: row.utm_campaign,
			term: row.utm_term,
			content: row.utm_content
		}
	};
}

/** Used only when KV misses, to repopulate the cache from the source of truth. */
export async function findLinkBySlug(env: Env, slug: string): Promise<LinkRecord | null> {
	const row = await env.DB.prepare(`SELECT ${LINK_COLUMNS} FROM link WHERE slug = ? LIMIT 1`)
		.bind(slug)
		.first<LinkRow>();
	return row ? toRecord(row) : null;
}

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
	'timestamp',
	'destination',
	'ip',
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
	'is_eu_country',
	'colo',
	'asn',
	'as_organization',
	'http_protocol',
	'tls_version',
	'tls_cipher',
	'client_tcp_rtt',
	'verified_bot_category',
	'bot_score',
	'user_agent',
	'browser',
	'browser_version',
	'os',
	'os_version',
	'device_type',
	'device_vendor',
	'is_bot',
	'language',
	'referer',
	'referer_domain',
	'utm_source',
	'utm_medium',
	'utm_campaign',
	'utm_term',
	'utm_content',
	'query_string'
] as const;

const INSERT_CLICK = `INSERT INTO click (${CLICK_COLUMNS.join(', ')}) VALUES (${CLICK_COLUMNS.map(
	() => '?'
).join(', ')})`;

const bit = (value: boolean | null) => (value === null ? null : value ? 1 : 0);

/**
 * Insert the click and bump the link's counters in one D1 batch — one network
 * round trip instead of two. Returns the link's new click count so the caller
 * can enforce a click cap.
 */
export async function writeClick(
	env: Env,
	record: LinkRecord,
	visitor: VisitorSnapshot,
	destination: string,
	id: string,
	visitorHash: string | null,
	isNewVisitor: boolean,
	now: number
): Promise<number | null> {
	const [, counters] = await env.DB.batch<{ click_count: number }>([
		env.DB.prepare(INSERT_CLICK).bind(
			id,
			record.id,
			record.userId,
			now,
			destination,
			visitor.ip,
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
			bit(visitor.isEuCountry),
			visitor.colo,
			visitor.asn,
			visitor.asOrganization,
			visitor.httpProtocol,
			visitor.tlsVersion,
			visitor.tlsCipher,
			visitor.clientTcpRtt,
			visitor.verifiedBotCategory,
			visitor.botScore,
			visitor.userAgent,
			visitor.ua.browser,
			visitor.ua.browserVersion,
			visitor.ua.os,
			visitor.ua.osVersion,
			visitor.ua.deviceType,
			visitor.ua.deviceVendor,
			bit(visitor.ua.isBot),
			visitor.language,
			visitor.referer,
			visitor.refererDomain,
			record.utm.source,
			record.utm.medium,
			record.utm.campaign,
			record.utm.term,
			record.utm.content,
			visitor.queryString
		),
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
