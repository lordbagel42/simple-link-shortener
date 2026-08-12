import { and, desc, eq, getTableColumns, gte, lte, sql, type SQL } from 'drizzle-orm';
import { SQLiteAsyncDialect } from 'drizzle-orm/sqlite-core';
import { getDb, type Db } from './db';
import { click, conversion, link as linkTable } from './db/schema';
import type { Env } from './env';
import {
	RANGES,
	isRangeKey,
	type AnalyticsSummary,
	type AnalyticsWindow,
	type Breakdown,
	type BreakdownKey,
	type HeatCell,
	type Interval,
	type RangeKey,
	type RecentClick,
	type TimePoint,
	type Totals
} from '$lib/types';

/**
 * Analytics over the click table.
 *
 * Everything here is plain SQLite aggregation against `click`, which carries
 * one row per redirect and every column the edge could tell us about it. D1 is
 * the source of truth and keeps history forever, so a dimension added to the
 * schema today can be charted over data recorded months ago.
 */

/* -------------------------------------------------------------------------- */
/*  Windows                                                                    */
/* -------------------------------------------------------------------------- */

const INTERVALS: Interval[] = ['hour', 'day', 'week', 'month'];

const DAY = 86_400_000;

/**
 * Resolve the query string into a window.
 *
 * `range=<preset>` is the common path; `from`/`to` accept anything
 * `Date.parse` understands and take precedence, which is what makes arbitrary
 * ranges work without a second code path.
 */
export function resolveWindow(params: URLSearchParams): AnalyticsWindow {
	const to = parseDate(params.get('to')) ?? Date.now();
	const explicitFrom = parseDate(params.get('from'));

	if (explicitFrom !== null && explicitFrom < to) {
		return {
			from: explicitFrom,
			to,
			interval: chooseInterval(params.get('interval'), to - explicitFrom),
			label: `${formatDay(explicitFrom)} – ${formatDay(to)}`,
			range: 'custom'
		};
	}

	const range: RangeKey = isRangeKey(params.get('range')) ? (params.get('range') as RangeKey) : '7d';
	const preset = RANGES[range];

	const from =
		range === 'today' ? startOfUtcDay(to) : preset.hours === null ? null : to - preset.hours * 3_600_000;

	return {
		from,
		to,
		interval: chooseInterval(params.get('interval'), from === null ? null : to - from, preset.interval),
		label: preset.label,
		range
	};
}

function chooseInterval(
	requested: string | null,
	span: number | null,
	fallback?: Interval
): Interval {
	if (requested && (INTERVALS as string[]).includes(requested)) return requested as Interval;
	if (fallback && span === null) return fallback;
	if (span === null) return 'day';

	if (span <= 2 * DAY) return 'hour';
	if (span <= 92 * DAY) return 'day';
	if (span <= 550 * DAY) return 'week';
	return 'month';
}

/** The equally long window ending where this one starts. */
function previousWindow(window: AnalyticsWindow): { from: number; to: number } | null {
	if (window.from === null) return null;
	const span = window.to - window.from;
	return { from: window.from - span, to: window.from };
}

function parseDate(value: string | null): number | null {
	if (!value) return null;
	const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function startOfUtcDay(at: number): number {
	const date = new Date(at);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatDay(at: number): string {
	return new Date(at).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/*  Scope and filters                                                          */
/* -------------------------------------------------------------------------- */

export type Scope = {
	userId: string;
	linkId?: string;
	domainId?: string;
	folderId?: string;
	/** Bots are noisy but real traffic; this is how the UI hides or isolates them. */
	bots?: 'all' | 'exclude' | 'only';
};

export function parseScope(params: URLSearchParams, userId: string, linkId?: string): Scope {
	const bots = params.get('bots');
	return {
		userId,
		linkId,
		domainId: params.get('domain') ?? undefined,
		folderId: params.get('folder') ?? undefined,
		bots: bots === 'exclude' || bots === 'only' ? bots : 'all'
	};
}

/**
 * The `WHERE` shared by every query below, as a raw fragment so it can be
 * spliced into hand-written `UNION ALL` statements as well as builder queries.
 */
function whereFor(scope: Scope, from: number | null, to: number): SQL {
	const parts: SQL[] = [sql`user_id = ${scope.userId}`, sql`timestamp <= ${to}`];
	if (from !== null) parts.push(sql`timestamp >= ${from}`);
	if (scope.linkId) parts.push(sql`link_id = ${scope.linkId}`);
	if (scope.domainId) parts.push(sql`domain_id = ${scope.domainId}`);
	if (scope.folderId) {
		parts.push(sql`link_id in (select id from link where folder_id = ${scope.folderId})`);
	}
	if (scope.bots === 'exclude') parts.push(sql`is_bot = 0`);
	if (scope.bots === 'only') parts.push(sql`is_bot = 1`);
	return sql.join(parts, sql` and `);
}

/** The same window applied to the conversion table, which has no `cf` columns. */
function conversionWhere(scope: Scope, from: number | null, to: number): SQL {
	const parts: SQL[] = [sql`user_id = ${scope.userId}`, sql`timestamp <= ${to}`];
	if (from !== null) parts.push(sql`timestamp >= ${from}`);
	if (scope.linkId) parts.push(sql`link_id = ${scope.linkId}`);
	if (scope.domainId) {
		parts.push(sql`link_id in (select id from link where domain_id = ${scope.domainId})`);
	}
	if (scope.folderId) {
		parts.push(sql`link_id in (select id from link where folder_id = ${scope.folderId})`);
	}
	return sql.join(parts, sql` and `);
}

/* -------------------------------------------------------------------------- */
/*  Dimensions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every way the click table can be sliced.
 *
 * `expr` is raw SQL over `click`, never user input — adding a dimension means
 * adding a row here and rendering it; the query builder does the rest.
 */
const DIMENSIONS: { key: BreakdownKey; expr: string }[] = [
	{ key: 'countries', expr: 'country' },
	{ key: 'regions', expr: 'region' },
	{ key: 'cities', expr: 'city' },
	{ key: 'continents', expr: 'continent' },
	{ key: 'timezones', expr: 'timezone' },
	{ key: 'languages', expr: 'language' },
	{ key: 'referrers', expr: 'referer_domain' },
	{ key: 'refererPaths', expr: 'referer_path' },
	{ key: 'devices', expr: 'device_type' },
	{ key: 'deviceVendors', expr: 'device_vendor' },
	{ key: 'deviceModels', expr: 'device_model' },
	{ key: 'browsers', expr: 'browser' },
	{ key: 'browserVersions', expr: "browser || ' ' || browser_version" },
	{ key: 'engines', expr: 'engine' },
	{ key: 'operatingSystems', expr: 'os' },
	{ key: 'osVersions', expr: "os || ' ' || os_version" },
	{ key: 'platforms', expr: 'ch_platform' },
	{ key: 'colos', expr: 'colo' },
	{ key: 'networks', expr: 'as_organization' },
	{ key: 'asns', expr: 'asn' },
	{ key: 'tlsVersions', expr: 'tls_version' },
	{ key: 'httpProtocols', expr: 'http_protocol' },
	{
		key: 'ipVersions',
		expr: "case ip_version when 6 then 'IPv6' when 4 then 'IPv4' else null end"
	},
	{ key: 'botCategories', expr: 'verified_bot_category' },
	// Grouped without the query string: conversion tracking appends a unique
	// `clid` to every click, which would otherwise make each one its own row.
	{
		key: 'destinations',
		expr: `substr(destination, 1, case when instr(destination, '?') > 0
			then instr(destination, '?') - 1 else length(destination) end)`
	},
	{ key: 'variants', expr: 'variant' },
	{ key: 'rules', expr: 'rule_matched' },
	{ key: 'slugs', expr: 'slug' },
	{ key: 'hostnames', expr: 'hostname' },
	{ key: 'utmSources', expr: 'utm_source' },
	{ key: 'utmMediums', expr: 'utm_medium' },
	{ key: 'utmCampaigns', expr: 'utm_campaign' },
	{ key: 'utmTerms', expr: 'utm_term' },
	{ key: 'utmContents', expr: 'utm_content' },
	{ key: 'adNetworks', expr: 'ad_network' },
	{ key: 'secFetchSites', expr: 'sec_fetch_site' },
	{ key: 'statuses', expr: 'response_status' }
];

const NONE = '(none)';
const TOP_N = 15;

/**
 * Renders a `sql` fragment down to text and bound parameters. The same casing
 * the Drizzle client is built with, so raw column names line up.
 */
const DIALECT = new SQLiteAsyncDialect({ casing: 'snake_case' });

/**
 * One statement per dimension, sent to D1 as a single batch.
 *
 * The obvious alternative — one `UNION ALL` over every dimension — is not
 * available: workerd's SQLite is built with a small
 * `SQLITE_MAX_COMPOUND_SELECT`, and a union of even eight branches is rejected
 * with "too many terms in compound SELECT". A batch is one round trip either
 * way, and it sidesteps D1's 100-bound-parameter ceiling as well.
 *
 * It goes through the D1 binding rather than `db.batch`, because Drizzle's
 * batch only accepts its own query builders — a raw `sql` fragment has no
 * prepared statement for it to bind.
 */
async function readBreakdowns(
	env: Env,
	where: SQL
): Promise<Record<BreakdownKey, Breakdown[]>> {
	const statements = DIMENSIONS.map((dimension) => {
		const query = DIALECT.sqlToQuery(sql`
			select coalesce(nullif(cast(${sql.raw(dimension.expr)} as text), ''), ${NONE}) as k,
			       count(*) as n
			from click where ${where}
			group by k order by n desc limit ${TOP_N}`);
		return env.DB.prepare(query.sql).bind(...query.params);
	});

	const results = await env.DB.batch<{ k: string; n: number }>(statements);
	const breakdowns = emptyBreakdowns();

	DIMENSIONS.forEach((dimension, index) => {
		breakdowns[dimension.key] = (results[index]?.results ?? []).map((row) => ({
			key: row.k,
			label: label(dimension.key, row.k),
			count: row.n
		}));
	});

	return breakdowns;
}

/* -------------------------------------------------------------------------- */
/*  The summary                                                                */
/* -------------------------------------------------------------------------- */

export async function getAnalytics(
	env: Env,
	scope: Scope,
	window: AnalyticsWindow
): Promise<AnalyticsSummary> {
	const db = getDb(env);
	const where = whereFor(scope, window.from, window.to);
	const previous = previousWindow(window);

	const [totals, previousTotals, timeseries, conversionSeries, heatmap, conversionRows, breakdowns] =
		await Promise.all([
			readTotals(db, scope, window.from, window.to),
			previous
				? readTotals(db, scope, previous.from, previous.to)
				: Promise.resolve(emptyTotals()),
			readTimeseries(db, where, window),
			readConversionSeries(db, scope, window),
			db.all<{ weekday: number; hour: number; clicks: number }>(sql`
				select cast(strftime('%w', timestamp / 1000, 'unixepoch') as integer) as weekday,
				       cast(strftime('%H', timestamp / 1000, 'unixepoch') as integer) as hour,
				       count(*) as clicks
				from click where ${where}
				group by weekday, hour`),
			db.all<{ event: string; n: number }>(sql`
				select event, count(*) as n from conversion
				where ${conversionWhere(scope, window.from, window.to)}
				group by event order by n desc limit ${TOP_N}`),
			readBreakdowns(env, where)
		]);

	return {
		window,
		totals,
		previous: previousTotals,
		timeseries: mergeSeries(timeseries, conversionSeries, window),
		heatmap: heatmap as HeatCell[],
		breakdowns,
		conversionEvents: conversionRows.map((row) => ({
			key: row.event,
			label: row.event,
			count: row.n
		}))
	};
}

async function readTotals(
	db: Db,
	scope: Scope,
	from: number | null,
	to: number
): Promise<Totals> {
	const where = whereFor(scope, from, to);

	const [clicks, conversions] = await Promise.all([
		db.get<{
			clicks: number;
			uniques: number | null;
			bots: number | null;
			qr: number | null;
			avg_processing: number | null;
			active_links: number;
		}>(sql`
			select count(*) as clicks,
			       sum(case when is_new_visitor then 1 else 0 end) as uniques,
			       sum(case when is_bot then 1 else 0 end) as bots,
			       sum(case when is_qr then 1 else 0 end) as qr,
			       avg(processing_ms) as avg_processing,
			       count(distinct link_id) as active_links
			from click where ${where}`),
		db.get<{ n: number; v: number | null }>(sql`
			select count(*) as n, coalesce(sum(value), 0) as v
			from conversion where ${conversionWhere(scope, from, to)}`)
	]);

	return {
		clicks: clicks?.clicks ?? 0,
		uniques: clicks?.uniques ?? 0,
		bots: clicks?.bots ?? 0,
		qrScans: clicks?.qr ?? 0,
		conversions: conversions?.n ?? 0,
		conversionValue: conversions?.v ?? 0,
		avgProcessingMs: Math.round(clicks?.avg_processing ?? 0),
		activeLinks: clicks?.active_links ?? 0
	};
}

function emptyTotals(): Totals {
	return {
		clicks: 0,
		uniques: 0,
		bots: 0,
		qrScans: 0,
		conversions: 0,
		conversionValue: 0,
		avgProcessingMs: 0,
		activeLinks: 0
	};
}

function emptyBreakdowns(): Record<BreakdownKey, Breakdown[]> {
	return Object.fromEntries(
		DIMENSIONS.map((dimension) => [dimension.key, [] as Breakdown[]])
	) as unknown as Record<BreakdownKey, Breakdown[]>;
}

/* -------------------------------------------------------------------------- */
/*  Time series                                                                */
/* -------------------------------------------------------------------------- */

/** SQLite expression that truncates a click's timestamp to the bucket start. */
function bucketExpr(interval: Interval, column = 'timestamp'): string {
	const seconds = `${column} / 1000, 'unixepoch'`;
	switch (interval) {
		case 'hour':
			return `strftime('%Y-%m-%dT%H:00', ${seconds})`;
		case 'day':
			return `strftime('%Y-%m-%d', ${seconds})`;
		case 'week':
			// Monday-start weeks: step back by however many days past Monday we are.
			return `date(${seconds}, '-' || ((cast(strftime('%w', ${seconds}) as integer) + 6) % 7) || ' days')`;
		case 'month':
			return `strftime('%Y-%m', ${seconds})`;
	}
}

async function readTimeseries(
	db: Db,
	where: SQL,
	window: AnalyticsWindow
): Promise<{ bucket: string; clicks: number; uniques: number }[]> {
	const bucket = sql.raw(bucketExpr(window.interval));
	return db.all<{ bucket: string; clicks: number; uniques: number }>(sql`
		select ${bucket} as bucket,
		       count(*) as clicks,
		       sum(case when is_new_visitor then 1 else 0 end) as uniques
		from click where ${where}
		group by bucket order by bucket`);
}

async function readConversionSeries(
	db: Db,
	scope: Scope,
	window: AnalyticsWindow
): Promise<Map<string, number>> {
	const bucket = sql.raw(bucketExpr(window.interval));
	const rows = await db.all<{ bucket: string; n: number }>(sql`
		select ${bucket} as bucket, count(*) as n
		from conversion where ${conversionWhere(scope, window.from, window.to)}
		group by bucket`);
	return new Map(rows.map((row) => [row.bucket, row.n]));
}

/**
 * Join the two series and fill the gaps.
 *
 * A chart with holes in it reads as "no data here", which is true, but a line
 * that skips from Tuesday to Friday reads as "Wednesday was busy" — so every
 * bucket in the window is emitted, zero or not.
 */
function mergeSeries(
	clicks: { bucket: string; clicks: number; uniques: number }[],
	conversions: Map<string, number>,
	window: AnalyticsWindow
): TimePoint[] {
	const byBucket = new Map(clicks.map((row) => [row.bucket, row]));
	const first = clicks[0]?.bucket;

	const start = window.from ?? (first ? Date.parse(bucketToIso(first)) : window.to);
	const points: TimePoint[] = [];

	for (const bucket of bucketRange(start, window.to, window.interval)) {
		const row = byBucket.get(bucket);
		points.push({
			bucket,
			clicks: row?.clicks ?? 0,
			uniques: row?.uniques ?? 0,
			conversions: conversions.get(bucket) ?? 0
		});
	}

	// Anything the stepper missed (a clock skew, a bucket before the window)
	// still deserves to appear rather than silently vanish.
	for (const row of clicks) {
		if (!points.some((point) => point.bucket === row.bucket)) {
			points.push({
				bucket: row.bucket,
				clicks: row.clicks,
				uniques: row.uniques,
				conversions: conversions.get(row.bucket) ?? 0
			});
		}
	}

	points.sort((a, b) => a.bucket.localeCompare(b.bucket));
	return points;
}

/** Bucket labels produced by `bucketExpr`, generated in JS for gap filling. */
function* bucketRange(from: number, to: number, interval: Interval): Generator<string> {
	const cursor = new Date(from);
	// Align to the bucket boundary so labels match what SQLite produced.
	if (interval === 'hour') cursor.setUTCMinutes(0, 0, 0);
	else cursor.setUTCHours(0, 0, 0, 0);
	if (interval === 'week') cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
	if (interval === 'month') cursor.setUTCDate(1);

	let guard = 0;
	while (cursor.getTime() <= to && guard++ < 2000) {
		yield formatBucketKey(cursor, interval);
		if (interval === 'hour') cursor.setUTCHours(cursor.getUTCHours() + 1);
		else if (interval === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
		else if (interval === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
		else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
	}
}

function formatBucketKey(date: Date, interval: Interval): string {
	const iso = date.toISOString();
	if (interval === 'hour') return `${iso.slice(0, 13)}:00`;
	if (interval === 'month') return iso.slice(0, 7);
	return iso.slice(0, 10);
}

function bucketToIso(bucket: string): string {
	if (bucket.length === 7) return `${bucket}-01T00:00:00Z`;
	if (bucket.length === 10) return `${bucket}T00:00:00Z`;
	return `${bucket}:00Z`;
}

/* -------------------------------------------------------------------------- */
/*  Labels                                                                     */
/* -------------------------------------------------------------------------- */

function label(dimension: BreakdownKey, key: string): string {
	if (key === NONE) return NONE_LABELS[dimension] ?? 'Unknown';
	switch (dimension) {
		case 'countries':
			return countryName(key);
		case 'languages':
			return languageName(key);
		case 'colos':
			return COLOS[key] ? `${key} · ${COLOS[key]}` : key;
		case 'asns':
			return `AS${key}`;
		case 'devices':
		case 'continents':
			return capitalize(key);
		default:
			return key;
	}
}

const NONE_LABELS: Partial<Record<BreakdownKey, string>> = {
	referrers: 'Direct',
	refererPaths: 'Direct',
	variants: 'No split test',
	rules: 'Default destination',
	utmSources: 'Untagged',
	utmMediums: 'Untagged',
	utmCampaigns: 'Untagged',
	utmTerms: 'Untagged',
	utmContents: 'Untagged',
	adNetworks: 'Organic',
	botCategories: 'Not a verified bot'
};

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function countryName(code: string): string {
	try {
		return code.length === 2 ? (regionNames.of(code.toUpperCase()) ?? code) : code;
	} catch {
		return code;
	}
}

function languageName(tag: string): string {
	try {
		return languageNames.of(tag) ?? tag;
	} catch {
		return tag;
	}
}

/** The busiest Cloudflare colos, named so the network tab reads as places. */
const COLOS: Record<string, string> = {
	AMS: 'Amsterdam',
	ATL: 'Atlanta',
	CDG: 'Paris',
	DFW: 'Dallas',
	DUB: 'Dublin',
	EWR: 'Newark',
	FRA: 'Frankfurt',
	HKG: 'Hong Kong',
	IAD: 'Ashburn',
	ICN: 'Seoul',
	JFK: 'New York',
	LAX: 'Los Angeles',
	LHR: 'London',
	MAD: 'Madrid',
	MIA: 'Miami',
	NRT: 'Tokyo',
	ORD: 'Chicago',
	SEA: 'Seattle',
	SIN: 'Singapore',
	SJC: 'San Jose',
	SYD: 'Sydney',
	YYZ: 'Toronto'
};

/* -------------------------------------------------------------------------- */
/*  Recent clicks                                                              */
/* -------------------------------------------------------------------------- */

export async function recentClicks(
	env: Env,
	scope: Scope,
	limit = 50
): Promise<RecentClick[]> {
	const db = getDb(env);
	const filters = [eq(click.userId, scope.userId)];
	if (scope.linkId) filters.push(eq(click.linkId, scope.linkId));
	if (scope.domainId) filters.push(eq(click.domainId, scope.domainId));
	if (scope.bots === 'exclude') filters.push(eq(click.isBot, false));
	if (scope.bots === 'only') filters.push(eq(click.isBot, true));

	return db
		.select({
			id: click.id,
			timestamp: click.timestamp,
			slug: click.slug,
			linkId: click.linkId,
			country: click.country,
			city: click.city,
			region: click.region,
			ip: click.ip,
			userAgent: click.userAgent,
			deviceType: click.deviceType,
			browser: click.browser,
			os: click.os,
			referer: click.referer,
			refererDomain: click.refererDomain,
			colo: click.colo,
			asOrganization: click.asOrganization,
			isBot: click.isBot,
			isNewVisitor: click.isNewVisitor,
			isQr: click.isQr,
			variant: click.variant,
			ruleMatched: click.ruleMatched,
			responseStatus: click.responseStatus,
			processingMs: click.processingMs,
			destination: click.destination
		})
		.from(click)
		.where(and(...filters))
		.orderBy(desc(click.timestamp))
		.limit(limit);
}

/* -------------------------------------------------------------------------- */
/*  CSV export                                                                 */
/* -------------------------------------------------------------------------- */

/** Every click column, in schema order. The export withholds nothing. */
const EXPORT_COLUMNS = Object.keys(getTableColumns(click)) as (keyof typeof click.$inferSelect)[];

export function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return '';
	const text = value instanceof Date ? value.toISOString() : String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: unknown[]): string {
	return `${values.map(csvEscape).join(',')}\r\n`;
}

/**
 * Stream the raw clicks for a window as CSV.
 *
 * Paged with a keyset cursor rather than `OFFSET`, so an export of a large
 * history costs the same per page at the end as at the start, and enqueued as
 * it goes so the Worker never holds the whole file in memory.
 */
export function exportClicksCsv(env: Env, scope: Scope, window: AnalyticsWindow): Response {
	const db = getDb(env);
	const encoder = new TextEncoder();
	const PAGE = 500;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(encoder.encode(csvRow(EXPORT_COLUMNS)));

			let cursor = window.to;
			let lastId: string | null = null;

			try {
				for (let page = 0; page < 400; page++) {
					const filters: SQL[] = [
						eq(click.userId, scope.userId),
						lte(click.timestamp, new Date(cursor))
					];
					if (window.from !== null) filters.push(gte(click.timestamp, new Date(window.from)));
					if (scope.linkId) filters.push(eq(click.linkId, scope.linkId));
					if (scope.domainId) filters.push(eq(click.domainId, scope.domainId));
					if (scope.bots === 'exclude') filters.push(eq(click.isBot, false));
					if (scope.bots === 'only') filters.push(eq(click.isBot, true));

					const rows: (typeof click.$inferSelect)[] = await db
						.select()
						.from(click)
						.where(and(...filters))
						.orderBy(desc(click.timestamp), desc(click.id))
						.limit(PAGE);

					// Ties on the cursor timestamp would repeat forever otherwise.
					const fresh: (typeof click.$inferSelect)[] = lastId
						? dropThrough(rows, lastId)
						: rows;
					if (fresh.length === 0) break;

					for (const row of fresh) {
						controller.enqueue(
							encoder.encode(csvRow(EXPORT_COLUMNS.map((column) => row[column])))
						);
					}

					if (rows.length < PAGE) break;
					const last = fresh[fresh.length - 1]!;
					cursor = last.timestamp.getTime();
					lastId = last.id;
				}
			} catch (error) {
				console.error('csv export failed', error);
			}

			controller.close();
		}
	});

	const name = `clicks-${formatDay(window.from ?? 0)}-to-${formatDay(window.to)}.csv`;
	return new Response(stream, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${name}"`,
			'cache-control': 'no-store'
		}
	});
}

function dropThrough<T extends { id: string }>(rows: T[], id: string): T[] {
	const index = rows.findIndex((row) => row.id === id);
	return index === -1 ? rows : rows.slice(index + 1);
}

/* -------------------------------------------------------------------------- */
/*  Link-level rollups                                                         */
/* -------------------------------------------------------------------------- */

/** Clicks per link inside a window — what "top links" means on the overview. */
export async function topLinks(
	env: Env,
	scope: Scope,
	window: AnalyticsWindow,
	limit = 10
): Promise<{ linkId: string; slug: string | null; clicks: number; uniques: number }[]> {
	const db = getDb(env);
	return db.all(sql`
		select link_id as linkId, slug,
		       count(*) as clicks,
		       sum(case when is_new_visitor then 1 else 0 end) as uniques
		from click where ${whereFor(scope, window.from, window.to)}
		group by link_id order by clicks desc limit ${limit}`);
}

/** Links with an expiry or a click cap that is close to being reached. */
export async function expiringSoon(env: Env, userId: string, limit = 5) {
	const db = getDb(env);
	const horizon = new Date(Date.now() + 7 * DAY);
	return db
		.select({
			id: linkTable.id,
			slug: linkTable.slug,
			expiresAt: linkTable.expiresAt,
			maxClicks: linkTable.maxClicks,
			clickCount: linkTable.clickCount
		})
		.from(linkTable)
		.where(
			and(
				eq(linkTable.userId, userId),
				eq(linkTable.archived, false),
				eq(linkTable.enabled, true),
				sql`(${linkTable.expiresAt} is not null and ${linkTable.expiresAt} <= ${horizon.getTime()})
				    or (${linkTable.maxClicks} is not null and ${linkTable.clickCount} >= ${linkTable.maxClicks} * 0.8)`
			)
		)
		.orderBy(linkTable.expiresAt)
		.limit(limit);
}

export type { AnalyticsWindow };
