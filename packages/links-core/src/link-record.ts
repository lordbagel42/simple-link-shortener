import type { Env } from './env.js';
import type { Link, LinkRule } from './db/schema.js';

/**
 * The subset of a link that the redirect hot path needs, stored in KV so a
 * redirect costs one KV read instead of a D1 query.
 */
export type LinkRecord = {
	id: string;
	userId: string;
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
	utm: {
		source: string | null;
		medium: string | null;
		campaign: string | null;
		term: string | null;
		content: string | null;
	};
};

/** KV keys are namespaced so future per-domain records can live alongside. */
export function linkKey(slug: string): string {
	return `l:${slug.toLowerCase()}`;
}

export function toLinkRecord(link: Link): LinkRecord {
	return {
		id: link.id,
		userId: link.userId,
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
		utm: {
			source: link.utmSource,
			medium: link.utmMedium,
			campaign: link.utmCampaign,
			term: link.utmTerm,
			content: link.utmContent
		}
	};
}

export async function readLinkRecord(env: Env, slug: string): Promise<LinkRecord | null> {
	// 60s is KV's own edge TTL floor; anything higher would delay edits reaching
	// colos that have already cached the key.
	return env.LINKS.get<LinkRecord>(linkKey(slug), { type: 'json', cacheTtl: 60 });
}

export async function writeLinkRecord(env: Env, link: Link): Promise<void> {
	await putLinkRecord(env, toLinkRecord(link));
}

/** Publish a record straight to KV, without needing a database row to build it. */
export async function putLinkRecord(env: Env, record: LinkRecord): Promise<void> {
	// Let KV expire the key on its own once the link does; a stale record can
	// then never outlive the link it describes.
	const expirationTtl = record.expiresAt
		? Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1000) + 60)
		: undefined;

	await env.LINKS.put(linkKey(record.slug), JSON.stringify(record), { expirationTtl });
}

export async function deleteLinkRecord(env: Env, slug: string): Promise<void> {
	await env.LINKS.delete(linkKey(slug));
}

export type LinkState = 'ok' | 'disabled' | 'expired';

export function linkState(record: LinkRecord, now = Date.now()): LinkState {
	if (!record.enabled) return 'disabled';
	if (record.expiresAt !== null && record.expiresAt <= now) return 'expired';
	return 'ok';
}

export type VisitorContext = {
	country: string | null;
	continent: string | null;
	deviceType: string | null;
	os: string | null;
	language: string | null;
	referer: string | null;
};

/** First matching rule wins; otherwise the link's default destination. */
export function selectDestination(record: LinkRecord, visitor: VisitorContext): string {
	for (const rule of record.rules) {
		const actual = ruleSubject(rule.type, visitor);
		if (actual && actual.toLowerCase().includes(rule.value.trim().toLowerCase())) {
			return rule.destination;
		}
	}
	return record.destination;
}

function ruleSubject(type: LinkRule['type'], visitor: VisitorContext): string | null {
	switch (type) {
		case 'country':
			return visitor.country;
		case 'continent':
			return visitor.continent;
		case 'device':
			return visitor.deviceType;
		case 'os':
			return visitor.os;
		case 'language':
			return visitor.language;
		case 'referer':
			return visitor.referer;
	}
}

/**
 * Apply UTM tags and (optionally) forward the incoming query string onto the
 * destination. Existing destination parameters always win over forwarded ones.
 */
export function buildTargetUrl(
	record: LinkRecord,
	destination: string,
	incoming: URL
): string {
	const utmEntries = Object.entries({
		utm_source: record.utm.source,
		utm_medium: record.utm.medium,
		utm_campaign: record.utm.campaign,
		utm_term: record.utm.term,
		utm_content: record.utm.content
	}).filter(([, value]) => value) as [string, string][];

	const forwarding = record.forwardQuery && incoming.search.length > 1;
	if (!forwarding && utmEntries.length === 0) return destination;

	let target: URL;
	try {
		target = new URL(destination);
	} catch {
		return destination;
	}

	if (forwarding) {
		for (const [key, value] of incoming.searchParams) {
			if (!target.searchParams.has(key)) target.searchParams.append(key, value);
		}
	}
	for (const [key, value] of utmEntries) target.searchParams.set(key, value);

	return target.toString();
}
