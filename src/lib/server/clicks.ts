import { eq, sql, and } from 'drizzle-orm';
import { getDb } from './db';
import { click, link as linkTable } from './db/schema';
import type { Env } from './env';
import { newId, sha256Hex } from './crypto';
import { parseUserAgent, refererDomain, type ParsedUserAgent } from './user-agent';
import { writeLinkRecord, type LinkRecord } from './link-record';

/** Everything we can learn about a visitor before the redirect is issued. */
export type VisitorSnapshot = {
	ua: ParsedUserAgent;
	userAgent: string | null;
	ip: string | null;
	referer: string | null;
	refererDomain: string | null;
	language: string | null;
	queryString: string | null;

	country: string | null;
	region: string | null;
	regionCode: string | null;
	city: string | null;
	postalCode: string | null;
	continent: string | null;
	latitude: string | null;
	longitude: string | null;
	timezone: string | null;
	isEuCountry: boolean | null;

	colo: string | null;
	asn: number | null;
	asOrganization: string | null;
	httpProtocol: string | null;
	tlsVersion: string | null;
	tlsCipher: string | null;
	clientTcpRtt: number | null;
	verifiedBotCategory: string | null;
	botScore: number | null;
};

type CfProperties = Record<string, unknown> & {
	botManagement?: { score?: number; verifiedBotCategory?: string; verifiedBot?: boolean };
};

/**
 * Reads request metadata only — no awaits, no I/O — so it can run before the
 * redirect response is returned and the expensive work can be deferred.
 */
export function snapshotVisitor(request: Request, url: URL, cf?: CfProperties): VisitorSnapshot {
	const headers = request.headers;
	const userAgent = headers.get('user-agent');
	const referer = headers.get('referer');
	const geo = (cf ?? {}) as CfProperties;

	return {
		ua: parseUserAgent(userAgent),
		userAgent,
		ip: headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for'),
		referer,
		refererDomain: refererDomain(referer),
		language: headers.get('accept-language')?.split(',')[0]?.trim() ?? null,
		queryString: url.search ? url.search.slice(1) : null,

		country: str(geo.country),
		region: str(geo.region),
		regionCode: str(geo.regionCode),
		city: str(geo.city),
		postalCode: str(geo.postalCode),
		continent: str(geo.continent),
		latitude: str(geo.latitude),
		longitude: str(geo.longitude),
		timezone: str(geo.timezone),
		isEuCountry: geo.isEUCountry === undefined ? null : geo.isEUCountry === '1',

		colo: str(geo.colo),
		asn: num(geo.asn),
		asOrganization: str(geo.asOrganization),
		httpProtocol: str(geo.httpProtocol),
		tlsVersion: str(geo.tlsVersion),
		tlsCipher: str(geo.tlsCipher),
		clientTcpRtt: num(geo.clientTcpRtt),
		verifiedBotCategory: str(geo.botManagement?.verifiedBotCategory),
		botScore: num(geo.botManagement?.score)
	};
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Persist a click. Always called from `ctx.waitUntil()` — the visitor is
 * already on their way to the destination by the time this runs.
 */
export async function recordClick(
	env: Env,
	record: LinkRecord,
	visitor: VisitorSnapshot,
	destination: string
): Promise<void> {
	const db = getDb(env);
	const now = new Date();

	const visitorHash = await hashVisitor(env, record.id, visitor);
	const isNewVisitor = visitorHash ? !(await hasSeenVisitor(env, record.id, visitorHash)) : true;

	await db.insert(click).values({
		id: newId(),
		linkId: record.id,
		userId: record.userId,
		timestamp: now,
		destination,
		visitorHash,
		isNewVisitor,

		country: visitor.country,
		region: visitor.region,
		regionCode: visitor.regionCode,
		city: visitor.city,
		postalCode: visitor.postalCode,
		continent: visitor.continent,
		latitude: visitor.latitude,
		longitude: visitor.longitude,
		timezone: visitor.timezone,
		isEuCountry: visitor.isEuCountry,

		colo: visitor.colo,
		asn: visitor.asn,
		asOrganization: visitor.asOrganization,
		httpProtocol: visitor.httpProtocol,
		tlsVersion: visitor.tlsVersion,
		tlsCipher: visitor.tlsCipher,
		clientTcpRtt: visitor.clientTcpRtt,
		verifiedBotCategory: visitor.verifiedBotCategory,
		botScore: visitor.botScore,

		userAgent: visitor.userAgent,
		browser: visitor.ua.browser,
		browserVersion: visitor.ua.browserVersion,
		os: visitor.ua.os,
		osVersion: visitor.ua.osVersion,
		deviceType: visitor.ua.deviceType,
		deviceVendor: visitor.ua.deviceVendor,
		isBot: visitor.ua.isBot,
		language: visitor.language,

		referer: visitor.referer,
		refererDomain: visitor.refererDomain,
		utmSource: record.utm.source,
		utmMedium: record.utm.medium,
		utmCampaign: record.utm.campaign,
		utmTerm: record.utm.term,
		utmContent: record.utm.content,
		queryString: visitor.queryString
	});

	const [updated] = await db
		.update(linkTable)
		.set({
			clickCount: sql`${linkTable.clickCount} + 1`,
			uniqueCount: isNewVisitor ? sql`${linkTable.uniqueCount} + 1` : sql`${linkTable.uniqueCount}`,
			lastClickedAt: now
		})
		.where(eq(linkTable.id, record.id))
		.returning();

	writeAnalyticsEngine(env, record, visitor, destination);

	// Click caps are enforced against the authoritative counter, then pushed back
	// into KV. A handful of clicks can slip through while KV catches up.
	if (updated && record.maxClicks !== null && updated.clickCount >= record.maxClicks) {
		const [disabled] = await db
			.update(linkTable)
			.set({ enabled: false, updatedAt: new Date() })
			.where(eq(linkTable.id, record.id))
			.returning();
		if (disabled) await writeLinkRecord(env, disabled);
	}
}

async function hashVisitor(
	env: Env,
	linkId: string,
	visitor: VisitorSnapshot
): Promise<string | null> {
	if (!visitor.ip) return null;
	// Salted and scoped per link: the stored value can't be correlated across
	// links or reversed back to an IP address.
	const salt = env.VISITOR_HASH_SALT ?? env.BETTER_AUTH_SECRET ?? 'link-shortener';
	const hash = await sha256Hex(`${salt}:${linkId}:${visitor.ip}:${visitor.userAgent ?? ''}`);
	return hash.slice(0, 32);
}

async function hasSeenVisitor(env: Env, linkId: string, visitorHash: string): Promise<boolean> {
	const db = getDb(env);
	const rows = await db
		.select({ id: click.id })
		.from(click)
		.where(and(eq(click.linkId, linkId), eq(click.visitorHash, visitorHash)))
		.limit(1);
	return rows.length > 0;
}

/**
 * Mirror the click into Analytics Engine when the binding exists. D1 stays the
 * source of truth for the dashboard; this is for cheap long-term retention.
 */
function writeAnalyticsEngine(
	env: Env,
	record: LinkRecord,
	visitor: VisitorSnapshot,
	destination: string
): void {
	if (!env.CLICKS_AE) return;
	env.CLICKS_AE.writeDataPoint({
		indexes: [record.id],
		blobs: [
			record.slug,
			record.userId,
			visitor.country ?? '',
			visitor.city ?? '',
			visitor.ua.deviceType,
			visitor.ua.os ?? '',
			visitor.ua.browser ?? '',
			visitor.refererDomain ?? '',
			visitor.colo ?? '',
			destination.slice(0, 200)
		],
		doubles: [1, visitor.ua.isBot ? 1 : 0, visitor.asn ?? 0]
	});
}
