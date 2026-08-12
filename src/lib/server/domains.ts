import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
	DEFAULT_HOST_KEY,
	deleteDomainRecord,
	newId,
	normalizeHost,
	putDomainRecord,
	toDomainRecord
} from '@lordbagel42/links-core';
import { getDb } from './db';
import { domain as domainTable, link as linkTable, type Domain } from './db/schema';
import type { Env } from './env';

/**
 * Domains.
 *
 * A domain owns a slug namespace: `link_domain_slug_idx` is unique on
 * `(domain_id, slug)`, so `go/launch` and `link.example.com/launch` can point
 * somewhere different. Exactly one domain per user is the default, and the
 * default is also what answers on hosts that are not registered — the
 * dashboard's own `/l/*` fallback, and `localhost:5173/l/*` in development.
 */

export class DomainError extends Error {
	constructor(
		message: string,
		readonly field: string | null = null
	) {
		super(message);
		this.name = 'DomainError';
	}
}

/**
 * The KV namespaces a domain's links are published under. The default domain
 * publishes a second copy under the wildcard so `<SHORT_PREFIX>/<slug>`
 * resolves on any host.
 */
export function hostsForDomain(row: Pick<Domain, 'hostname' | 'isDefault'>): string[] {
	const hosts = [normalizeHost(row.hostname)];
	if (row.isDefault) hosts.push(DEFAULT_HOST_KEY);
	return hosts;
}

/**
 * `https://link.example.com/l/launch` for a link on this domain.
 *
 * When the request arrived on the same hostname its origin is reused verbatim,
 * which is what keeps `http://localhost:5173/l/…` correct in development
 * without the scheme or port having to be stored anywhere.
 */
export function shortUrlForDomain(
	row: Pick<Domain, 'hostname' | 'prefix'>,
	slug: string,
	requestUrl?: URL
): string {
	const prefix = normalizePrefix(row.prefix);
	const sameHost =
		requestUrl && normalizeHost(requestUrl.hostname) === normalizeHost(row.hostname);
	const origin = sameHost ? requestUrl.origin : `https://${row.hostname}`;
	return `${origin}${prefix}/${slug}`;
}

export function normalizePrefix(raw: string | null | undefined): string {
	const value = (raw ?? '').trim();
	if (!value || value === '/') return '';
	const withSlash = value.startsWith('/') ? value : `/${value}`;
	return withSlash.replace(/\/+$/, '');
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listDomains(env: Env, userId: string): Promise<Domain[]> {
	const db = getDb(env);
	return db
		.select()
		.from(domainTable)
		.where(eq(domainTable.userId, userId))
		.orderBy(sql`${domainTable.isDefault} desc`, asc(domainTable.hostname));
}

/** The user's domains keyed by id — how every list view resolves short URLs. */
export async function domainsById(env: Env, userId: string): Promise<Map<string, Domain>> {
	const rows = await listDomains(env, userId);
	return new Map(rows.map((row) => [row.id, row]));
}

export async function getDomain(env: Env, userId: string, id: string): Promise<Domain | null> {
	const db = getDb(env);
	const [row] = await db
		.select()
		.from(domainTable)
		.where(and(eq(domainTable.id, id), eq(domainTable.userId, userId)))
		.limit(1);
	return row ?? null;
}

/** Link counts per domain, for the settings list. */
export async function domainLinkCounts(env: Env, userId: string): Promise<Record<string, number>> {
	const db = getDb(env);
	const rows = await db
		.select({ domainId: linkTable.domainId, count: sql<number>`count(*)` })
		.from(linkTable)
		.where(eq(linkTable.userId, userId))
		.groupBy(linkTable.domainId);

	return Object.fromEntries(rows.map((row) => [row.domainId, row.count]));
}

/* -------------------------------------------------------------------------- */
/*  Bootstrapping                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The host and prefix this instance is configured for, taken from `SHORT_URL`
 * if it is set, then `SHORT_HOSTS`, then the request's own origin.
 */
export function configuredHost(env: Env, url: URL): { hostname: string; prefix: string } {
	if (env.SHORT_URL) {
		try {
			const parsed = new URL(env.SHORT_URL);
			return { hostname: normalizeHost(parsed.hostname), prefix: normalizePrefix(parsed.pathname) };
		} catch {
			// Fall through to the other sources.
		}
	}

	const first = (env.SHORT_HOSTS ?? '').split(',')[0]?.trim();
	if (first) return { hostname: normalizeHost(first), prefix: '' };

	return { hostname: normalizeHost(url.hostname), prefix: normalizePrefix(env.SHORT_PREFIX ?? '/l') };
}

/** Placeholder hostnames written by the 0002 migration, before we know better. */
function isPlaceholder(hostname: string): boolean {
	return hostname.startsWith('default-');
}

/**
 * Guarantee the user has a default domain, and heal the placeholder the
 * migration left behind.
 *
 * Called from the dashboard's layout load, so the first page view after an
 * upgrade rewrites `default-<user id>` into whatever `SHORT_URL` says and
 * republishes the KV records under the real hostname.
 */
export async function ensureDefaultDomain(env: Env, userId: string, url: URL): Promise<Domain> {
	const db = getDb(env);
	const existing = await listDomains(env, userId);
	const configured = configuredHost(env, url);

	if (existing.length === 0) {
		return createDomain(env, userId, {
			hostname: configured.hostname,
			prefix: configured.prefix,
			label: 'Default',
			isDefault: true
		});
	}

	const current = existing.find((row) => row.isDefault) ?? existing[0]!;
	if (!isPlaceholder(current.hostname)) return current;

	// Only claim the configured hostname if nothing else already has it.
	const [taken] = await db
		.select({ id: domainTable.id })
		.from(domainTable)
		.where(and(eq(domainTable.hostname, configured.hostname), ne(domainTable.id, current.id)))
		.limit(1);
	if (taken) return current;

	const [healed] = await db
		.update(domainTable)
		.set({
			hostname: configured.hostname,
			prefix: configured.prefix,
			isDefault: true,
			updatedAt: new Date()
		})
		.where(eq(domainTable.id, current.id))
		.returning();

	await deleteDomainRecord(env, current.hostname);
	await publish(env, healed!);
	await republishLinks(env, healed!, [current.hostname]);

	return healed!;
}

/* -------------------------------------------------------------------------- */
/*  Writes                                                                     */
/* -------------------------------------------------------------------------- */

export type DomainInput = {
	hostname: string;
	label?: string | null;
	prefix?: string | null;
	isDefault?: boolean;
	slugLength?: number;
	redirectStatus?: number;
	mainRedirect?: string | null;
	notFoundRedirect?: string | null;
	expiredRedirect?: string | null;
};

/**
 * Single-label hostnames are allowed on purpose: `localhost` in development,
 * and intranet domains like `go/launch` that resolve through a search suffix.
 */
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export async function createDomain(
	env: Env,
	userId: string,
	input: DomainInput
): Promise<Domain> {
	const db = getDb(env);
	const now = new Date();
	const hostname = validateHostname(input.hostname);

	const [clash] = await db
		.select({ id: domainTable.id })
		.from(domainTable)
		.where(eq(domainTable.hostname, hostname))
		.limit(1);
	if (clash) throw new DomainError(`${hostname} is already registered.`, 'hostname');

	const existing = await listDomains(env, userId);
	const isDefault = input.isDefault ?? existing.length === 0;

	if (isDefault) await clearDefault(env, userId);

	const [created] = await db
		.insert(domainTable)
		.values({
			id: newId(),
			userId,
			hostname,
			label: emptyToNull(input.label),
			prefix: normalizePrefix(input.prefix),
			isDefault,
			slugLength: clampSlugLength(input.slugLength),
			redirectStatus: input.redirectStatus ?? 302,
			mainRedirect: emptyToNull(input.mainRedirect),
			notFoundRedirect: emptyToNull(input.notFoundRedirect),
			expiredRedirect: emptyToNull(input.expiredRedirect),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	await publish(env, created!);
	return created!;
}

export async function updateDomain(
	env: Env,
	userId: string,
	id: string,
	input: Partial<DomainInput>
): Promise<Domain> {
	const db = getDb(env);
	const existing = await getDomain(env, userId, id);
	if (!existing) throw new DomainError('Domain not found.');

	const patch: Partial<Domain> = { updatedAt: new Date() };

	if (input.hostname !== undefined) {
		const hostname = validateHostname(input.hostname);
		if (hostname !== existing.hostname) {
			const [clash] = await db
				.select({ id: domainTable.id })
				.from(domainTable)
				.where(eq(domainTable.hostname, hostname))
				.limit(1);
			if (clash) throw new DomainError(`${hostname} is already registered.`, 'hostname');
			patch.hostname = hostname;
		}
	}
	if (input.label !== undefined) patch.label = emptyToNull(input.label);
	if (input.prefix !== undefined) patch.prefix = normalizePrefix(input.prefix);
	if (input.slugLength !== undefined) patch.slugLength = clampSlugLength(input.slugLength);
	if (input.redirectStatus !== undefined) patch.redirectStatus = input.redirectStatus;
	if (input.mainRedirect !== undefined) patch.mainRedirect = emptyToNull(input.mainRedirect);
	if (input.notFoundRedirect !== undefined) {
		patch.notFoundRedirect = emptyToNull(input.notFoundRedirect);
	}
	if (input.expiredRedirect !== undefined) patch.expiredRedirect = emptyToNull(input.expiredRedirect);

	if (input.isDefault) {
		await clearDefault(env, userId);
		patch.isDefault = true;
	}

	const [updated] = await db
		.update(domainTable)
		.set(patch)
		.where(and(eq(domainTable.id, id), eq(domainTable.userId, userId)))
		.returning();

	// A renamed or re-defaulted domain changes which KV keys its links live
	// under, so every one of them has to be republished.
	const previousHosts = hostsForDomain(existing);
	await deleteDomainRecord(env, existing.hostname);
	await publish(env, updated!);
	await republishLinks(env, updated!, previousHosts);

	return updated!;
}

/**
 * Deleting a domain deletes its links — the slugs only mean anything inside it.
 * Refuses to remove the last one, so links always have somewhere to live.
 */
export async function deleteDomain(env: Env, userId: string, id: string): Promise<number> {
	const db = getDb(env);
	const existing = await getDomain(env, userId, id);
	if (!existing) throw new DomainError('Domain not found.');

	const all = await listDomains(env, userId);
	if (all.length <= 1) throw new DomainError('You need at least one domain.');

	const { deleteLinksForDomain } = await import('./links');
	const removed = await deleteLinksForDomain(env, userId, existing);

	await db.delete(domainTable).where(and(eq(domainTable.id, id), eq(domainTable.userId, userId)));
	await deleteDomainRecord(env, existing.hostname);

	// Promote another domain if this was the default.
	if (existing.isDefault) {
		const next = all.find((row) => row.id !== id);
		if (next) await updateDomain(env, userId, next.id, { isDefault: true });
	}

	return removed;
}

/* -------------------------------------------------------------------------- */
/*  KV publication                                                             */
/* -------------------------------------------------------------------------- */

export async function publish(env: Env, row: Domain): Promise<void> {
	await putDomainRecord(env, toDomainRecord(row));
}

/**
 * Rewrite every link on a domain into KV, removing the keys it used to occupy.
 * Runs whenever a domain's hostname or default flag changes.
 */
export async function republishLinks(
	env: Env,
	row: Domain,
	previousHosts: string[] = []
): Promise<number> {
	const db = getDb(env);
	const { writeLinkRecord, deleteLinkRecord } = await import('@lordbagel42/links-core');

	const rows = await db.select().from(linkTable).where(eq(linkTable.domainId, row.id));
	const hosts = hostsForDomain(row);
	const stale = previousHosts.filter((host) => !hosts.includes(host));

	for (const link of rows) {
		if (stale.length > 0) await deleteLinkRecord(env, stale, link.slug);
		await writeLinkRecord(env, link, hosts);
	}
	return rows.length;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function clearDefault(env: Env, userId: string): Promise<void> {
	const db = getDb(env);
	await db
		.update(domainTable)
		.set({ isDefault: false })
		.where(and(eq(domainTable.userId, userId), eq(domainTable.isDefault, true)));
}

function validateHostname(raw: string): string {
	let value = raw.trim().toLowerCase();
	// Accept a pasted URL and keep only the host.
	if (value.includes('://')) {
		try {
			value = new URL(value).hostname;
		} catch {
			throw new DomainError('Enter a hostname, not a URL.', 'hostname');
		}
	}
	value = normalizeHost(value.split('/')[0] ?? '');

	if (!value) throw new DomainError('Hostname is required.', 'hostname');
	if (value.length > 253) throw new DomainError('That hostname is too long.', 'hostname');
	if (!HOSTNAME_PATTERN.test(value)) {
		throw new DomainError('Enter a valid hostname, e.g. link.example.com.', 'hostname');
	}
	return value;
}

function clampSlugLength(value: number | undefined): number {
	if (!value || !Number.isFinite(value)) return 6;
	return Math.min(24, Math.max(3, Math.floor(value)));
}

function emptyToNull(value: string | null | undefined): string | null {
	if (value === undefined || value === null) return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}
