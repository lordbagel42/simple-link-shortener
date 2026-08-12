/**
 * Types and constants shared by the server and the browser.
 *
 * Anything a Svelte component imports has to live outside `$lib/server`, which
 * SvelteKit refuses to bundle into client code.
 */

// The targeting-rule vocabulary is evaluated on the redirect path, so it is
// defined in the shared core and re-exported here for the components that
// render the rule editor.
export type { LinkRule, PreviewMode } from '@lordbagel42/links-core';
export { RULE_TYPES, PREVIEW_MODES } from '@lordbagel42/links-core';

import type { LinkRule, PreviewMode } from '@lordbagel42/links-core';

/** A link as sent to the browser: dates flattened to epoch ms, no password hash. */
export type SerializedLink = {
	id: string;
	slug: string;
	/** Extra slugs that resolve to this same link. */
	aliases: string[];
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
	previewMode: PreviewMode;
	previewImage: string | null;
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
