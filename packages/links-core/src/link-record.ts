import type { Env } from './env.js';
import type { Domain, Link } from './db/schema.js';
import type { CloakConfig, DeepLinkConfig, LinkRule, LinkVariant, RuleOperator } from './types.js';

/**
 * The subset of a link that the redirect hot path needs, stored in KV so a
 * redirect costs one KV read instead of a D1 query.
 */
export type LinkRecord = {
	id: string;
	userId: string;
	domainId: string;
	/** The hostname this record was published under, for logging the click. */
	host: string;
	slug: string;
	destination: string;
	enabled: boolean;
	/** Epoch ms. */
	expiresAt: number | null;
	maxClicks: number | null;
	fallbackUrl: string | null;
	forwardQuery: boolean;
	redirectStatus: number;
	passwordHash: string | null;
	rules: LinkRule[];
	variants: LinkVariant[];
	deepLink: DeepLinkConfig | null;
	cloak: CloakConfig | null;
	hideReferrer: boolean;
	trackConversions: boolean;
	utm: {
		source: string | null;
		medium: string | null;
		campaign: string | null;
		term: string | null;
		content: string | null;
	};
};

/** The per-domain settings the redirect path needs when no link matches. */
export type DomainRecord = {
	id: string;
	userId: string;
	hostname: string;
	prefix: string;
	mainRedirect: string | null;
	notFoundRedirect: string | null;
	expiredRedirect: string | null;
};

/**
 * Namespace used when a request arrives on a host that is not itself a
 * registered domain — `localhost:5173/l/<slug>` in development, or the
 * dashboard host's own `/l/*` fallback. The user's default domain publishes a
 * second copy of every record here.
 */
export const DEFAULT_HOST_KEY = '*';

/**
 * `www.` is folded away, so a domain registered as `link.example.com` also
 * answers on `www.link.example.com`. The two can therefore never be separate
 * domains — which is the right trade for short links.
 */
export function normalizeHost(host: string): string {
	return host.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

export function linkKey(host: string, slug: string): string {
	return `l:${host === DEFAULT_HOST_KEY ? host : normalizeHost(host)}:${slug.toLowerCase()}`;
}

export function domainKey(host: string): string {
	return `d:${normalizeHost(host)}`;
}

export function toLinkRecord(link: Link, host: string): LinkRecord {
	return {
		id: link.id,
		userId: link.userId,
		domainId: link.domainId,
		host,
		slug: link.slug,
		destination: link.destination,
		enabled: link.enabled,
		expiresAt: link.expiresAt ? link.expiresAt.getTime() : null,
		maxClicks: link.maxClicks,
		fallbackUrl: link.fallbackUrl,
		forwardQuery: link.forwardQuery,
		redirectStatus: link.redirectStatus,
		passwordHash: link.passwordHash,
		rules: link.rules ?? [],
		variants: link.variants ?? [],
		deepLink: link.deepLink ?? null,
		cloak: link.cloak ?? null,
		hideReferrer: link.hideReferrer,
		trackConversions: link.trackConversions,
		utm: {
			source: link.utmSource,
			medium: link.utmMedium,
			campaign: link.utmCampaign,
			term: link.utmTerm,
			content: link.utmContent
		}
	};
}

export function toDomainRecord(row: Domain): DomainRecord {
	return {
		id: row.id,
		userId: row.userId,
		hostname: row.hostname,
		prefix: row.prefix,
		mainRedirect: row.mainRedirect,
		notFoundRedirect: row.notFoundRedirect,
		expiredRedirect: row.expiredRedirect
	};
}

/* -------------------------------------------------------------------------- */
/*  KV access                                                                  */
/* -------------------------------------------------------------------------- */

// 60s is KV's own edge TTL floor; anything higher would delay edits reaching
// colos that have already cached the key.
const CACHE_TTL = 60;

/**
 * Look a slug up for the host it arrived on, then fall back to the default
 * namespace. The second read only happens on hosts that own no links of their
 * own, so a dedicated short domain still costs exactly one KV read.
 */
export async function readLinkRecord(
	env: Env,
	host: string,
	slug: string
): Promise<LinkRecord | null> {
	const scoped = await env.LINKS.get<LinkRecord>(linkKey(host, slug), {
		type: 'json',
		cacheTtl: CACHE_TTL
	});
	if (scoped) return scoped;

	return env.LINKS.get<LinkRecord>(linkKey(DEFAULT_HOST_KEY, slug), {
		type: 'json',
		cacheTtl: CACHE_TTL
	});
}

export async function readDomainRecord(env: Env, host: string): Promise<DomainRecord | null> {
	return env.LINKS.get<DomainRecord>(domainKey(host), { type: 'json', cacheTtl: CACHE_TTL });
}

export async function putDomainRecord(env: Env, record: DomainRecord): Promise<void> {
	await env.LINKS.put(domainKey(record.hostname), JSON.stringify(record));
}

export async function deleteDomainRecord(env: Env, host: string): Promise<void> {
	await env.LINKS.delete(domainKey(host));
}

/**
 * Publish a link. `hosts` is the domain's hostname plus, for the default
 * domain, the wildcard namespace — writing both is what lets one link answer on
 * its own domain and under `<SHORT_PREFIX>/<slug>` anywhere else.
 */
export async function putLinkRecord(
	env: Env,
	record: LinkRecord,
	hosts: string[] = [record.host]
): Promise<void> {
	// Let KV expire the key on its own once the link does; a stale record can
	// then never outlive the link it describes.
	const expirationTtl = record.expiresAt
		? Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000) + 60)
		: undefined;

	const body = JSON.stringify(record);
	await Promise.all(
		hosts.map((host) => env.LINKS.put(linkKey(host, record.slug), body, { expirationTtl }))
	);
}

export async function writeLinkRecord(env: Env, link: Link, hosts: string[]): Promise<void> {
	const [primary] = hosts;
	await putLinkRecord(env, toLinkRecord(link, primary ?? DEFAULT_HOST_KEY), hosts);
}

export async function deleteLinkRecord(env: Env, hosts: string[], slug: string): Promise<void> {
	await Promise.all(hosts.map((host) => env.LINKS.delete(linkKey(host, slug))));
}

/* -------------------------------------------------------------------------- */
/*  Link state                                                                 */
/* -------------------------------------------------------------------------- */

export type LinkState = 'ok' | 'disabled' | 'expired';

export function linkState(record: LinkRecord, now = Date.now()): LinkState {
	if (!record.enabled) return 'disabled';
	if (record.expiresAt !== null && record.expiresAt <= now) return 'expired';
	return 'ok';
}

/* -------------------------------------------------------------------------- */
/*  Targeting                                                                  */
/* -------------------------------------------------------------------------- */

export type VisitorContext = {
	country: string | null;
	region: string | null;
	city: string | null;
	continent: string | null;
	deviceType: string | null;
	os: string | null;
	browser: string | null;
	language: string | null;
	referer: string | null;
	asn: number | null;
	timezone: string | null;
	query: string | null;
};

/** What the redirect path chose, and why — both end up on the click row. */
export type Selection = {
	destination: string;
	/** `country:US`, or null when the default destination was used. */
	rule: string | null;
	/** Label of the A/B arm, or null when the link is not split. */
	variant: string | null;
};

/**
 * Rules first, in order — the first match wins and short-circuits the split
 * test, so a targeted destination is never overridden by a variant. Then the
 * weighted variants, then the plain destination.
 */
export function selectDestination(
	record: LinkRecord,
	visitor: VisitorContext,
	/** A number in [0, 1). Pass a pinned value to keep a visitor on one arm. */
	roll = Math.random()
): Selection {
	for (const rule of record.rules) {
		if (matchRule(rule, visitor)) {
			return { destination: rule.destination, rule: `${rule.type}:${rule.value}`, variant: null };
		}
	}

	const variant = pickVariant(record.variants, roll);
	if (variant) {
		return { destination: variant.destination, rule: null, variant: variant.label };
	}

	return { destination: record.destination, rule: null, variant: null };
}

/** Weighted pick over the variants. Returns null when there is no split test. */
export function pickVariant(
	variants: LinkVariant[],
	roll: number
): { destination: string; label: string } | null {
	const usable = variants
		.map((variant, index) => ({
			destination: variant.destination,
			label: variant.label?.trim() || String.fromCharCode(65 + index),
			weight: Math.max(0, Number(variant.weight) || 0)
		}))
		.filter((variant) => variant.destination && variant.weight > 0);

	const total = usable.reduce((sum, variant) => sum + variant.weight, 0);
	if (total <= 0) return null;

	let cursor = roll * total;
	for (const variant of usable) {
		cursor -= variant.weight;
		if (cursor < 0) return { destination: variant.destination, label: variant.label };
	}
	return { destination: usable[usable.length - 1]!.destination, label: usable[usable.length - 1]!.label };
}

/**
 * A rule matches when any comma-separated alternative matches. Comparison is
 * case-insensitive throughout; `not` inverts the whole thing.
 */
export function matchRule(rule: LinkRule, visitor: VisitorContext): boolean {
	const subject = ruleSubject(rule.type, visitor);
	if (subject === null) return false;

	const haystack = subject.toLowerCase();
	const alternatives = rule.value
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);
	if (alternatives.length === 0) return false;

	const op: RuleOperator = rule.op ?? 'contains';
	const hit = alternatives.some((needle) => compare(op === 'not' ? 'is' : op, haystack, needle));
	return op === 'not' ? !hit : hit;
}

function compare(op: Exclude<RuleOperator, 'not'>, haystack: string, needle: string): boolean {
	switch (op) {
		case 'is':
			return haystack === needle;
		case 'starts_with':
			return haystack.startsWith(needle);
		case 'ends_with':
			return haystack.endsWith(needle);
		case 'contains':
			return haystack.includes(needle);
	}
}

function ruleSubject(type: LinkRule['type'], visitor: VisitorContext): string | null {
	switch (type) {
		case 'country':
			return visitor.country;
		case 'region':
			return visitor.region;
		case 'city':
			return visitor.city;
		case 'continent':
			return visitor.continent;
		case 'device':
			return visitor.deviceType;
		case 'os':
			return visitor.os;
		case 'browser':
			return visitor.browser;
		case 'language':
			return visitor.language;
		case 'referer':
			return visitor.referer;
		case 'asn':
			return visitor.asn === null ? null : String(visitor.asn);
		case 'timezone':
			return visitor.timezone;
		case 'query':
			return visitor.query;
	}
}

/* -------------------------------------------------------------------------- */
/*  Target URL                                                                 */
/* -------------------------------------------------------------------------- */

/** Query parameters this app uses for itself and never forwards on. */
const CONTROL_PARAMS = new Set(['qr']);

/**
 * Apply UTM tags, optionally forward the incoming query string, and attach the
 * conversion id. Existing destination parameters always win over forwarded
 * ones; the link's own UTM tags always win over both.
 */
export function buildTargetUrl(
	record: LinkRecord,
	destination: string,
	incoming: URL,
	/** The click's id, appended as `clid` when conversion tracking is on. */
	clickId?: string | null
): string {
	const utmEntries = Object.entries({
		utm_source: record.utm.source,
		utm_medium: record.utm.medium,
		utm_campaign: record.utm.campaign,
		utm_term: record.utm.term,
		utm_content: record.utm.content
	}).filter(([, value]) => value) as [string, string][];

	const forwarding = record.forwardQuery && incoming.search.length > 1;
	const tagging = record.trackConversions && Boolean(clickId);
	if (!forwarding && utmEntries.length === 0 && !tagging) return destination;

	let target: URL;
	try {
		target = new URL(destination);
	} catch {
		// Custom schemes (app deep links) are left exactly as written.
		return destination;
	}

	if (forwarding) {
		for (const [key, value] of incoming.searchParams) {
			if (CONTROL_PARAMS.has(key)) continue;
			if (!target.searchParams.has(key)) target.searchParams.append(key, value);
		}
	}
	for (const [key, value] of utmEntries) target.searchParams.set(key, value);
	if (tagging) target.searchParams.set('clid', clickId!);

	return target.toString();
}
