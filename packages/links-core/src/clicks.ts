import type { Env } from './env.js';
import { newId, sha256Hex } from './crypto.js';
import { parseUserAgent, refererDomain, type ParsedUserAgent } from './user-agent.js';
import { putLinkRecord, type LinkRecord } from './link-record.js';
import { disableLink, hasSeenVisitor, writeClick } from './d1.js';
import { dispatchWebhooks } from './webhooks.js';

/**
 * Everything we can learn about a visitor before the redirect is issued.
 *
 * The rule is that anything the edge hands us for free gets captured: if it is
 * on `request.cf` or in a header, it belongs here. Reconstructing a click after
 * the fact is impossible, and a null column costs nothing.
 */
export type VisitorSnapshot = {
	ua: ParsedUserAgent;
	userAgent: string | null;
	ip: string | null;
	ipVersion: number | null;

	/* request */
	method: string | null;
	hostname: string | null;
	path: string | null;
	queryString: string | null;
	isQr: boolean;

	/* attribution */
	referer: string | null;
	refererDomain: string | null;
	refererPath: string | null;
	utmSource: string | null;
	utmMedium: string | null;
	utmCampaign: string | null;
	utmTerm: string | null;
	utmContent: string | null;
	adClickId: string | null;
	adNetwork: string | null;

	/* language and negotiation */
	language: string | null;
	acceptLanguage: string | null;
	accept: string | null;
	acceptEncoding: string | null;

	/* geo */
	country: string | null;
	region: string | null;
	regionCode: string | null;
	city: string | null;
	postalCode: string | null;
	continent: string | null;
	latitude: string | null;
	longitude: string | null;
	timezone: string | null;
	metroCode: string | null;
	isEuCountry: boolean | null;

	/* network */
	colo: string | null;
	asn: number | null;
	asOrganization: string | null;
	httpProtocol: string | null;
	tlsVersion: string | null;
	tlsCipher: string | null;
	clientTcpRtt: number | null;
	clientAcceptEncoding: string | null;
	requestPriority: string | null;
	edgeKeepAlive: string | null;
	cfRay: string | null;

	/* bot management */
	verifiedBotCategory: string | null;
	botScore: number | null;
	isVerifiedBot: boolean | null;
	isCorporateProxy: boolean | null;
	isStaticResource: boolean | null;
	ja3Hash: string | null;
	ja4: string | null;

	/* client hints */
	chUa: string | null;
	chPlatform: string | null;
	chPlatformVersion: string | null;
	chMobile: string | null;
	chModel: string | null;
	chArch: string | null;
	chBitness: string | null;
	chFullVersionList: string | null;

	/* fetch metadata and privacy signals */
	secFetchSite: string | null;
	secFetchMode: string | null;
	secFetchDest: string | null;
	secFetchUser: string | null;
	dnt: string | null;
	gpc: string | null;
};

type BotManagement = {
	score?: number;
	verifiedBotCategory?: string;
	verifiedBot?: boolean;
	corporateProxy?: boolean;
	staticResource?: boolean;
	ja3Hash?: string;
	ja4?: string;
};

type CfProperties = Record<string, unknown> & { botManagement?: BotManagement };

/** Ad platform click identifiers, in the order we prefer to attribute them. */
const AD_CLICK_PARAMS: [param: string, network: string][] = [
	['gclid', 'google'],
	['wbraid', 'google'],
	['gbraid', 'google'],
	['dclid', 'google'],
	['fbclid', 'meta'],
	['igshid', 'instagram'],
	['msclkid', 'microsoft'],
	['ttclid', 'tiktok'],
	['twclid', 'x'],
	['li_fat_id', 'linkedin'],
	['epik', 'pinterest'],
	['irclickid', 'impact'],
	['yclid', 'yandex']
];

/**
 * Reads request metadata only — no awaits, no I/O — so it can run before the
 * redirect response is returned and the expensive work can be deferred.
 */
export function snapshotVisitor(request: Request, url: URL, cf?: CfProperties): VisitorSnapshot {
	const headers = request.headers;
	const header = (name: string) => str(headers.get(name));

	const userAgent = headers.get('user-agent');
	const referer = headers.get('referer');
	const geo = (cf ?? {}) as CfProperties;
	const bot = geo.botManagement ?? {};
	const params = url.searchParams;
	const ip = headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for');
	const ad = AD_CLICK_PARAMS.find(([param]) => params.has(param));

	return {
		ua: parseUserAgent(userAgent),
		userAgent,
		ip,
		ipVersion: ip ? (ip.includes(':') ? 6 : 4) : null,

		method: request.method,
		hostname: url.hostname.toLowerCase(),
		path: url.pathname,
		queryString: url.search ? url.search.slice(1) : null,
		isQr: params.get('qr') === '1',

		referer,
		refererDomain: refererDomain(referer),
		refererPath: refererPath(referer),
		utmSource: str(params.get('utm_source')),
		utmMedium: str(params.get('utm_medium')),
		utmCampaign: str(params.get('utm_campaign')),
		utmTerm: str(params.get('utm_term')),
		utmContent: str(params.get('utm_content')),
		adClickId: ad ? str(params.get(ad[0])) : null,
		adNetwork: ad ? ad[1] : null,

		language: headers.get('accept-language')?.split(',')[0]?.trim() || null,
		acceptLanguage: header('accept-language'),
		accept: header('accept'),
		acceptEncoding: header('accept-encoding'),

		country: str(geo.country),
		region: str(geo.region),
		regionCode: str(geo.regionCode),
		city: str(geo.city),
		postalCode: str(geo.postalCode),
		continent: str(geo.continent),
		latitude: str(geo.latitude),
		longitude: str(geo.longitude),
		timezone: str(geo.timezone),
		metroCode: str(geo.metroCode),
		isEuCountry: geo.isEUCountry === undefined ? null : geo.isEUCountry === '1',

		colo: str(geo.colo),
		asn: num(geo.asn),
		asOrganization: str(geo.asOrganization),
		httpProtocol: str(geo.httpProtocol),
		tlsVersion: str(geo.tlsVersion),
		tlsCipher: str(geo.tlsCipher),
		clientTcpRtt: num(geo.clientTcpRtt),
		clientAcceptEncoding: str(geo.clientAcceptEncoding),
		requestPriority: str(geo.requestPriority),
		edgeKeepAlive: str(geo.edgeRequestKeepAliveStatus) ?? numAsString(geo.edgeRequestKeepAliveStatus),
		cfRay: header('cf-ray'),

		verifiedBotCategory: str(bot.verifiedBotCategory),
		botScore: num(bot.score),
		isVerifiedBot: flag(bot.verifiedBot),
		isCorporateProxy: flag(bot.corporateProxy),
		isStaticResource: flag(bot.staticResource),
		ja3Hash: str(bot.ja3Hash),
		ja4: str(bot.ja4),

		chUa: header('sec-ch-ua'),
		chPlatform: unquote(header('sec-ch-ua-platform')),
		chPlatformVersion: unquote(header('sec-ch-ua-platform-version')),
		chMobile: header('sec-ch-ua-mobile'),
		chModel: unquote(header('sec-ch-ua-model')),
		chArch: unquote(header('sec-ch-ua-arch')),
		chBitness: unquote(header('sec-ch-ua-bitness')),
		chFullVersionList: header('sec-ch-ua-full-version-list'),

		secFetchSite: header('sec-fetch-site'),
		secFetchMode: header('sec-fetch-mode'),
		secFetchDest: header('sec-fetch-dest'),
		secFetchUser: header('sec-fetch-user'),
		dnt: header('dnt'),
		gpc: header('sec-gpc')
	};
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numAsString(value: unknown): string | null {
	return typeof value === 'number' ? String(value) : null;
}

function flag(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

/** Client-hint values arrive quoted: `"macOS"` → `macOS`. */
function unquote(value: string | null): string | null {
	if (!value) return null;
	return value.replace(/^"(.*)"$/, '$1') || null;
}

function refererPath(referer: string | null): string | null {
	if (!referer) return null;
	try {
		const url = new URL(referer);
		return url.pathname + url.search || null;
	} catch {
		return null;
	}
}

/* -------------------------------------------------------------------------- */
/*  Writing the click                                                          */
/* -------------------------------------------------------------------------- */

/** What the redirect path decided, recorded alongside the visitor. */
export type ClickOutcome = {
	/** Allocated before the response so it can be handed to the destination as `clid`. */
	id: string;
	destination: string;
	variant: string | null;
	rule: string | null;
	responseStatus: number;
	processingMs: number;
};

/**
 * Persist a click. Always called from `ctx.waitUntil()` — the visitor is
 * already on their way to the destination by the time this runs.
 */
export async function recordClick(
	env: Env,
	record: LinkRecord,
	visitor: VisitorSnapshot,
	outcome: ClickOutcome
): Promise<void> {
	const now = Date.now();

	const visitorHash = await hashVisitor(env, record.id, visitor);
	const isNewVisitor = visitorHash ? !(await hasSeenVisitor(env, record.id, visitorHash)) : true;

	const clickCount = await writeClick(env, record, visitor, outcome, visitorHash, isNewVisitor, now);

	writeAnalyticsEngine(env, record, visitor, outcome);

	// Click caps are enforced against the authoritative counter, then pushed back
	// into KV. A handful of clicks can slip through while KV catches up.
	const capped =
		clickCount !== null && record.maxClicks !== null && clickCount >= record.maxClicks;
	if (capped) {
		await disableLink(env, record.id, now);
		await putLinkRecord(env, { ...record, enabled: false }, [record.host]);
	}

	await dispatchWebhooks(env, record.userId, [
		{
			event: 'link.clicked',
			data: {
				link: { id: record.id, slug: record.slug, domainId: record.domainId },
				click: {
					id: outcome.id,
					timestamp: new Date(now).toISOString(),
					destination: outcome.destination,
					variant: outcome.variant,
					rule: outcome.rule,
					isNewVisitor,
					isBot: visitor.ua.isBot,
					isQr: visitor.isQr,
					country: visitor.country,
					city: visitor.city,
					referer: visitor.referer,
					device: visitor.ua.deviceType,
					browser: visitor.ua.browser,
					os: visitor.ua.os
				}
			}
		},
		...(capped
			? ([{ event: 'link.limit_reached', data: { link: { id: record.id, slug: record.slug } } }] as const)
			: [])
	]);
}

async function hashVisitor(
	env: Env,
	linkId: string,
	visitor: VisitorSnapshot
): Promise<string | null> {
	if (!visitor.ip) return null;
	// Salted and scoped per link, so unique-visitor counts stay meaningful even
	// though the raw address is stored alongside in `click.ip`.
	const salt = env.VISITOR_HASH_SALT ?? env.BETTER_AUTH_SECRET ?? 'link-shortener';
	const hash = await sha256Hex(`${salt}:${linkId}:${visitor.ip}:${visitor.userAgent ?? ''}`);
	return hash.slice(0, 32);
}

/**
 * Mirror the click into Analytics Engine when the binding exists. D1 stays the
 * source of truth for the dashboard; this is for cheap ad-hoc SQL over
 * high-cardinality columns.
 */
function writeAnalyticsEngine(
	env: Env,
	record: LinkRecord,
	visitor: VisitorSnapshot,
	outcome: ClickOutcome
): void {
	if (!env.CLICKS_AE) return;
	env.CLICKS_AE.writeDataPoint({
		indexes: [record.id],
		// A data point allows 20 blobs; these are the twenty worth grouping by.
		blobs: [
			record.slug,
			record.userId,
			record.domainId,
			visitor.country ?? '',
			visitor.region ?? '',
			visitor.city ?? '',
			visitor.continent ?? '',
			visitor.ua.deviceType,
			visitor.ua.os ?? '',
			visitor.ua.browser ?? '',
			visitor.ua.engine ?? '',
			visitor.refererDomain ?? '',
			visitor.colo ?? '',
			visitor.asOrganization ?? '',
			visitor.language ?? '',
			visitor.tlsVersion ?? '',
			visitor.utmSource ?? '',
			visitor.utmCampaign ?? '',
			outcome.variant ?? '',
			outcome.destination.slice(0, 200)
		],
		doubles: [
			1,
			visitor.ua.isBot ? 1 : 0,
			visitor.asn ?? 0,
			visitor.isQr ? 1 : 0,
			visitor.botScore ?? -1,
			outcome.responseStatus,
			outcome.processingMs
		]
	});
}
