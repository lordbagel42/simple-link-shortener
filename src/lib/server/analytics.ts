import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { click, link as linkTable } from './db/schema';
import type { Env } from './env';
import {
	RANGES,
	type AnalyticsSummary,
	type Breakdown,
	type RangeKey,
	type RecentClick,
	type TimePoint
} from '$lib/types';

function since(range: RangeKey): Date | null {
	const { hours } = RANGES[range];
	return hours === null ? null : new Date(Date.now() - hours * 3600_000);
}

/**
 * Aggregate analytics for one link, or for every link a user owns.
 *
 * All of this is one round of SQLite aggregates against the `click` table,
 * which is indexed on `(link_id, timestamp)` and `(user_id, timestamp)`.
 */
export async function getAnalytics(
	env: Env,
	scope: { userId: string; linkId?: string },
	range: RangeKey
): Promise<AnalyticsSummary> {
	const db = getDb(env);
	const start = since(range);

	const filters: SQL[] = [eq(click.userId, scope.userId)];
	if (scope.linkId) filters.push(eq(click.linkId, scope.linkId));
	if (start) filters.push(gte(click.timestamp, start));
	const where = and(...filters)!;

	const bucketExpr =
		RANGES[range].bucket === 'hour'
			? sql<string>`strftime('%Y-%m-%dT%H:00', ${click.timestamp} / 1000, 'unixepoch')`
			: sql<string>`strftime('%Y-%m-%d', ${click.timestamp} / 1000, 'unixepoch')`;

	const [totals, timeseries, ...breakdowns] = await Promise.all([
		db
			.select({
				clicks: sql<number>`count(*)`,
				uniques: sql<number>`sum(case when ${click.isNewVisitor} then 1 else 0 end)`,
				bots: sql<number>`sum(case when ${click.isBot} then 1 else 0 end)`
			})
			.from(click)
			.where(where),
		db
			.select({
				bucket: bucketExpr,
				clicks: sql<number>`count(*)`,
				uniques: sql<number>`sum(case when ${click.isNewVisitor} then 1 else 0 end)`
			})
			.from(click)
			.where(where)
			.groupBy(bucketExpr)
			.orderBy(bucketExpr),
		topValues(db, where, click.country),
		topValues(db, where, click.city),
		topValues(db, where, click.refererDomain),
		topValues(db, where, click.deviceType),
		topValues(db, where, click.browser),
		topValues(db, where, click.os),
		topValues(db, where, click.language),
		topValues(db, where, click.colo),
		topValues(db, where, click.asOrganization),
		topValues(db, where, click.destination)
	]);

	const total = totals[0];
	const [countries, cities, referrers, devices, browsers, oses, languages, colos, networks, destinations] =
		breakdowns;

	return {
		totalClicks: total?.clicks ?? 0,
		uniqueVisitors: total?.uniques ?? 0,
		botClicks: total?.bots ?? 0,
		timeseries: fillGaps(
			timeseries.map((row) => ({
				bucket: row.bucket,
				clicks: row.clicks,
				uniques: row.uniques ?? 0
			})),
			range
		),
		countries: label(countries, countryName),
		cities: label(cities),
		referrers: label(referrers, (value) => (value === '(direct)' ? 'Direct' : value)),
		devices: label(devices, capitalize),
		browsers: label(browsers),
		operatingSystems: label(oses),
		languages: label(languages, languageName),
		colos: label(colos, (value) => `${value}${COLOS[value] ? ` · ${COLOS[value]}` : ''}`),
		networks: label(networks),
		destinations: label(destinations)
	};
}

type Column = Parameters<typeof eq>[0];

async function topValues(
	db: ReturnType<typeof getDb>,
	where: SQL,
	column: Column,
	limit = 12
): Promise<{ key: string; count: number }[]> {
	const key = sql<string>`coalesce(nullif(${column}, ''), '(direct)')`;
	return db
		.select({ key, count: sql<number>`count(*)` })
		.from(click)
		.where(where)
		.groupBy(key)
		.orderBy(desc(sql`count(*)`))
		.limit(limit);
}

function label(
	rows: { key: string; count: number }[],
	map?: (value: string) => string
): Breakdown[] {
	return rows.map((row) => ({
		key: row.key,
		label: map ? map(row.key) : row.key,
		count: row.count
	}));
}

/**
 * SQLite only returns buckets that have clicks. The chart needs a continuous
 * axis, so empty buckets are filled in here.
 */
function fillGaps(points: TimePoint[], range: RangeKey): TimePoint[] {
	const { hours, bucket } = RANGES[range];
	if (hours === null) return points;

	const byBucket = new Map(points.map((point) => [point.bucket, point]));
	const step = bucket === 'hour' ? 3600_000 : 86_400_000;
	const count = bucket === 'hour' ? hours : hours / 24;
	const now = Date.now();
	const filled: TimePoint[] = [];

	for (let i = count - 1; i >= 0; i--) {
		const at = new Date(now - i * step);
		const key =
			bucket === 'hour'
				? at.toISOString().slice(0, 13) + ':00'
				: at.toISOString().slice(0, 10);
		filled.push(byBucket.get(key) ?? { bucket: key, clicks: 0, uniques: 0 });
	}
	return filled;
}

/** The most recent raw click rows, for the live event feed. */
export async function recentClicks(
	env: Env,
	scope: { userId: string; linkId?: string },
	limit = 50
): Promise<RecentClick[]> {
	const db = getDb(env);
	const filters: SQL[] = [eq(click.userId, scope.userId)];
	if (scope.linkId) filters.push(eq(click.linkId, scope.linkId));

	return db
		.select({
			id: click.id,
			timestamp: click.timestamp,
			slug: linkTable.slug,
			linkId: click.linkId,
			country: click.country,
			city: click.city,
			region: click.region,
			deviceType: click.deviceType,
			browser: click.browser,
			os: click.os,
			referer: click.referer,
			refererDomain: click.refererDomain,
			colo: click.colo,
			asOrganization: click.asOrganization,
			isBot: click.isBot,
			isNewVisitor: click.isNewVisitor,
			destination: click.destination
		})
		.from(click)
		.innerJoin(linkTable, eq(linkTable.id, click.linkId))
		.where(and(...filters))
		.orderBy(desc(click.timestamp))
		.limit(limit);
}

export type { AnalyticsSummary, Breakdown, RangeKey, RecentClick, TimePoint };

/* --- display helpers ------------------------------------------------------ */

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

let regionNames: Intl.DisplayNames | null = null;
let languageNames: Intl.DisplayNames | null = null;

function countryName(code: string): string {
	if (code === '(direct)' || code.length !== 2) return code;
	regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
	try {
		return regionNames.of(code.toUpperCase()) ?? code;
	} catch {
		return code;
	}
}

function languageName(tag: string): string {
	if (tag === '(direct)') return tag;
	languageNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
	try {
		return languageNames.of(tag) ?? tag;
	} catch {
		return tag;
	}
}

/** A few of the busiest Cloudflare edge locations, for readable colo labels. */
const COLOS: Record<string, string> = {
	IAD: 'Ashburn',
	EWR: 'Newark',
	LAX: 'Los Angeles',
	SJC: 'San Jose',
	ORD: 'Chicago',
	DFW: 'Dallas',
	ATL: 'Atlanta',
	SEA: 'Seattle',
	YYZ: 'Toronto',
	LHR: 'London',
	CDG: 'Paris',
	AMS: 'Amsterdam',
	FRA: 'Frankfurt',
	MAD: 'Madrid',
	MXP: 'Milan',
	ARN: 'Stockholm',
	WAW: 'Warsaw',
	SIN: 'Singapore',
	NRT: 'Tokyo',
	KIX: 'Osaka',
	HKG: 'Hong Kong',
	ICN: 'Seoul',
	SYD: 'Sydney',
	BOM: 'Mumbai',
	DEL: 'Delhi',
	GRU: 'São Paulo',
	SCL: 'Santiago',
	JNB: 'Johannesburg',
	DXB: 'Dubai'
};
