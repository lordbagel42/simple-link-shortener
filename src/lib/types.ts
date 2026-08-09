/**
 * Types and constants shared by the server and the browser.
 *
 * Anything a Svelte component imports has to live outside `$lib/server`, which
 * SvelteKit refuses to bundle into client code.
 */

/** A targeting rule evaluated on the redirect path before the default destination. */
export type LinkRule = {
	/** What to match on. */
	type: 'country' | 'continent' | 'device' | 'os' | 'language' | 'referer';
	/** Case-insensitive value to compare against, e.g. `US`, `mobile`, `ios`, `de`. */
	value: string;
	/** Where matching visitors go instead of the default destination. */
	destination: string;
};

export const RULE_TYPES: LinkRule['type'][] = [
	'country',
	'continent',
	'device',
	'os',
	'language',
	'referer'
];

/** A link as sent to the browser: dates flattened to epoch ms, no password hash. */
export type SerializedLink = {
	id: string;
	slug: string;
	destination: string;
	title: string | null;
	description: string | null;
	tags: string[];
	userId: string;
	enabled: boolean;
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
	clickCount: number;
	uniqueCount: number;
	lastClickedAt: number | null;
	createdAt: number;
	updatedAt: number;
};

/* --- analytics ------------------------------------------------------------ */

export const RANGES = {
	'24h': { label: 'Last 24 hours', hours: 24, bucket: 'hour' },
	'7d': { label: 'Last 7 days', hours: 24 * 7, bucket: 'day' },
	'30d': { label: 'Last 30 days', hours: 24 * 30, bucket: 'day' },
	'90d': { label: 'Last 90 days', hours: 24 * 90, bucket: 'day' },
	all: { label: 'All time', hours: null, bucket: 'day' }
} as const;

export type RangeKey = keyof typeof RANGES;

export function parseRange(value: string | null): RangeKey {
	return value && value in RANGES ? (value as RangeKey) : '7d';
}

export type Breakdown = { key: string; label: string; count: number };
export type TimePoint = { bucket: string; clicks: number; uniques: number };

export type AnalyticsSummary = {
	totalClicks: number;
	uniqueVisitors: number;
	botClicks: number;
	timeseries: TimePoint[];
	countries: Breakdown[];
	cities: Breakdown[];
	referrers: Breakdown[];
	devices: Breakdown[];
	browsers: Breakdown[];
	operatingSystems: Breakdown[];
	languages: Breakdown[];
	colos: Breakdown[];
	networks: Breakdown[];
	destinations: Breakdown[];
};

/** One row of the recent-clicks feed. */
export type RecentClick = {
	id: string;
	timestamp: Date;
	slug: string;
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
	destination: string;
};
