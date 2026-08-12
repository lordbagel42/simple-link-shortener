/**
 * Types and constants shared by the server and the browser.
 *
 * Anything a Svelte component imports has to live outside `$lib/server`, which
 * SvelteKit refuses to bundle into client code.
 */

// The targeting-rule vocabulary is evaluated on the redirect path, so it is
// defined in the shared core and re-exported here for the components that
// render the rule editor.
export type {
	LinkRule,
	LinkVariant,
	RuleType,
	RuleOperator,
	DeepLinkConfig,
	CloakConfig,
	QrOptions,
	WebhookEvent
} from '@lordbagel42/links-core';
export {
	RULE_TYPES,
	RULE_OPERATORS,
	WEBHOOK_EVENTS,
	REDIRECT_STATUSES,
	DEFAULT_QR_OPTIONS
} from '@lordbagel42/links-core';

import type {
	CloakConfig,
	DeepLinkConfig,
	LinkRule,
	LinkVariant,
	QrOptions
} from '@lordbagel42/links-core';

/** A link as sent to the browser: dates flattened to epoch ms, no password hash. */
export type SerializedLink = {
	id: string;
	slug: string;
	destination: string;
	domainId: string;
	folderId: string | null;
	title: string | null;
	description: string | null;
	tags: string[];
	userId: string;
	enabled: boolean;
	archived: boolean;
	hasPassword: boolean;
	expiresAt: number | null;
	maxClicks: number | null;
	fallbackUrl: string | null;
	forwardQuery: boolean;
	utmSource: string | null;
	utmMedium: string | null;
	utmCampaign: string | null;
	utmTerm: string | null;
	utmContent: string | null;
	redirectStatus: number;
	rules: LinkRule[];
	variants: LinkVariant[];
	deepLink: DeepLinkConfig | null;
	cloak: CloakConfig | null;
	hideReferrer: boolean;
	trackConversions: boolean;
	qrOptions: Partial<QrOptions> | null;
	clickCount: number;
	uniqueCount: number;
	conversionCount: number;
	conversionValue: number;
	lastClickedAt: number | null;
	createdAt: number;
	updatedAt: number;
	/** Built from the link's domain, so the UI never has to join. */
	shortUrl: string;
};

export type SerializedDomain = {
	id: string;
	hostname: string;
	label: string | null;
	prefix: string;
	isDefault: boolean;
	slugLength: number;
	redirectStatus: number;
	mainRedirect: string | null;
	notFoundRedirect: string | null;
	expiredRedirect: string | null;
	linkCount: number;
	createdAt: number;
};

export type SerializedFolder = {
	id: string;
	name: string;
	color: string;
	linkCount: number;
};

/* -------------------------------------------------------------------------- */
/*  Analytics windows                                                          */
/* -------------------------------------------------------------------------- */

/** Bucket width for the time series. Chosen from the window unless overridden. */
export type Interval = 'hour' | 'day' | 'week' | 'month';

export const RANGES = {
	today: { label: 'Today', hours: null, interval: 'hour' },
	'24h': { label: 'Last 24 hours', hours: 24, interval: 'hour' },
	'7d': { label: 'Last 7 days', hours: 24 * 7, interval: 'day' },
	'30d': { label: 'Last 30 days', hours: 24 * 30, interval: 'day' },
	'90d': { label: 'Last 90 days', hours: 24 * 90, interval: 'day' },
	'12m': { label: 'Last 12 months', hours: 24 * 365, interval: 'month' },
	all: { label: 'All time', hours: null, interval: 'day' }
} as const satisfies Record<string, { label: string; hours: number | null; interval: Interval }>;

export type RangeKey = keyof typeof RANGES;

export function isRangeKey(value: string | null): value is RangeKey {
	return Boolean(value) && value! in RANGES;
}

/** The resolved window, as the server computed it and the UI displays it. */
export type AnalyticsWindow = {
	/** Null only for "all time". */
	from: number | null;
	to: number;
	interval: Interval;
	label: string;
	/** The preset this came from, or `custom`. */
	range: RangeKey | 'custom';
};

/* -------------------------------------------------------------------------- */
/*  Analytics results                                                          */
/* -------------------------------------------------------------------------- */

export type Breakdown = { key: string; label: string; count: number };
export type TimePoint = { bucket: string; clicks: number; uniques: number; conversions: number };
export type HeatCell = { weekday: number; hour: number; clicks: number };

export type Totals = {
	clicks: number;
	uniques: number;
	bots: number;
	qrScans: number;
	conversions: number;
	conversionValue: number;
	/** Mean edge resolution time in ms, across the window. */
	avgProcessingMs: number;
	/** Distinct links that took at least one click. */
	activeLinks: number;
};

/**
 * Every dimension the click table can be grouped by.
 *
 * Adding one is a single entry in `DIMENSIONS` on the server plus a `BarList`
 * in the view — the query builder picks the rest up automatically.
 */
export type BreakdownKey =
	| 'countries'
	| 'regions'
	| 'cities'
	| 'continents'
	| 'timezones'
	| 'languages'
	| 'referrers'
	| 'refererPaths'
	| 'devices'
	| 'deviceVendors'
	| 'deviceModels'
	| 'browsers'
	| 'browserVersions'
	| 'engines'
	| 'operatingSystems'
	| 'osVersions'
	| 'platforms'
	| 'colos'
	| 'networks'
	| 'asns'
	| 'tlsVersions'
	| 'httpProtocols'
	| 'ipVersions'
	| 'botCategories'
	| 'destinations'
	| 'variants'
	| 'rules'
	| 'slugs'
	| 'hostnames'
	| 'utmSources'
	| 'utmMediums'
	| 'utmCampaigns'
	| 'utmTerms'
	| 'utmContents'
	| 'adNetworks'
	| 'secFetchSites'
	| 'statuses';

export type AnalyticsSummary = {
	window: AnalyticsWindow;
	totals: Totals;
	/** The equally long window immediately before this one, for deltas. */
	previous: Totals;
	timeseries: TimePoint[];
	heatmap: HeatCell[];
	breakdowns: Record<BreakdownKey, Breakdown[]>;
	/** Conversions grouped by their event name. */
	conversionEvents: Breakdown[];
};

/** One row of the recent-clicks feed. */
export type RecentClick = {
	id: string;
	timestamp: Date;
	slug: string | null;
	linkId: string;
	country: string | null;
	city: string | null;
	region: string | null;
	ip: string | null;
	userAgent: string | null;
	deviceType: string | null;
	browser: string | null;
	os: string | null;
	referer: string | null;
	refererDomain: string | null;
	colo: string | null;
	asOrganization: string | null;
	isBot: boolean;
	isNewVisitor: boolean;
	isQr: boolean;
	variant: string | null;
	ruleMatched: string | null;
	responseStatus: number | null;
	processingMs: number | null;
	destination: string;
};

export type SerializedConversion = {
	id: string;
	linkId: string;
	clickId: string | null;
	slug: string | null;
	event: string;
	value: number;
	currency: string;
	latencyMs: number | null;
	timestamp: number;
};
