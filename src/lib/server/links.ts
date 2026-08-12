import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import {
	deleteLinkRecord,
	hashPassword,
	newId,
	writeLinkRecord,
	type CloakConfig,
	type DeepLinkConfig,
	type LinkVariant,
	type QrOptions
} from '@lordbagel42/links-core';
import { getDb, type Db } from './db';
import {
	click,
	conversion,
	link as linkTable,
	type Domain,
	type Link,
	type LinkRule
} from './db/schema';
import type { Env, WaitUntil } from './env';
import { generateSlug, validateDestination, validateSlug } from '$lib/slug';
import {
	domainsById,
	ensureDefaultDomain,
	getDomain,
	hostsForDomain,
	listDomains
} from './domains';
import { fire } from './webhooks';

export class LinkError extends Error {
	constructor(
		message: string,
		readonly field: string | null = null
	) {
		super(message);
		this.name = 'LinkError';
	}
}

export type LinkInput = {
	slug?: string;
	destination: string;
	domainId?: string | null;
	folderId?: string | null;
	title?: string | null;
	description?: string | null;
	tags?: string[];
	enabled?: boolean;
	archived?: boolean;
	/** `null` clears an existing password, `undefined` leaves it untouched. */
	password?: string | null;
	expiresAt?: number | null;
	maxClicks?: number | null;
	fallbackUrl?: string | null;
	forwardQuery?: boolean;
	utmSource?: string | null;
	utmMedium?: string | null;
	utmCampaign?: string | null;
	utmTerm?: string | null;
	utmContent?: string | null;
	redirectStatus?: number;
	rules?: LinkRule[];
	variants?: LinkVariant[];
	deepLink?: DeepLinkConfig | null;
	cloak?: CloakConfig | null;
	hideReferrer?: boolean;
	trackConversions?: boolean;
	qrOptions?: Partial<QrOptions> | null;
};

const VALID_STATUSES = new Set([301, 302, 307, 308]);

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

export type ListOptions = {
	search?: string;
	tag?: string;
	folderId?: string;
	domainId?: string;
	sort?: 'recent' | 'oldest' | 'clicks' | 'conversions' | 'slug';
	/** `archived` shows only archived links; every other value hides them. */
	status?: 'all' | 'active' | 'inactive' | 'expiring' | 'archived';
	limit?: number;
	offset?: number;
};

function listFilters(userId: string, options: ListOptions) {
	const filters = [eq(linkTable.userId, userId)];

	if (options.search) {
		const needle = `%${options.search.toLowerCase()}%`;
		filters.push(
			or(
				like(sql`lower(${linkTable.slug})`, needle),
				like(sql`lower(${linkTable.destination})`, needle),
				like(sql`lower(coalesce(${linkTable.title}, ''))`, needle),
				like(sql`lower(coalesce(${linkTable.description}, ''))`, needle)
			)!
		);
	}
	if (options.tag) filters.push(like(linkTable.tags, `%"${options.tag}"%`));
	if (options.folderId) filters.push(eq(linkTable.folderId, options.folderId));
	if (options.domainId) filters.push(eq(linkTable.domainId, options.domainId));

	// Archived links are hidden everywhere except their own view — they still
	// resolve, they are just out of the way.
	filters.push(eq(linkTable.archived, options.status === 'archived'));

	if (options.status === 'active') filters.push(eq(linkTable.enabled, true));
	if (options.status === 'inactive') filters.push(eq(linkTable.enabled, false));
	if (options.status === 'expiring') {
		filters.push(sql`${linkTable.expiresAt} is not null or ${linkTable.maxClicks} is not null`);
	}

	return and(...filters);
}

export async function listLinks(
	env: Env,
	userId: string,
	options: ListOptions = {}
): Promise<{ links: Link[]; total: number }> {
	const db = getDb(env);
	const where = listFilters(userId, options);

	const order =
		options.sort === 'clicks'
			? desc(linkTable.clickCount)
			: options.sort === 'conversions'
				? desc(linkTable.conversionCount)
				: options.sort === 'slug'
					? asc(linkTable.slug)
					: options.sort === 'oldest'
						? asc(linkTable.createdAt)
						: desc(linkTable.createdAt);

	const [links, [counted]] = await Promise.all([
		db
			.select()
			.from(linkTable)
			.where(where)
			.orderBy(order)
			.limit(options.limit ?? 100)
			.offset(options.offset ?? 0),
		db.select({ value: sql<number>`count(*)` }).from(linkTable).where(where)
	]);

	return { links, total: counted?.value ?? 0 };
}

export async function getLink(env: Env, userId: string, id: string): Promise<Link | null> {
	const db = getDb(env);
	const [row] = await db
		.select()
		.from(linkTable)
		.where(and(eq(linkTable.id, id), eq(linkTable.userId, userId)))
		.limit(1);
	return row ?? null;
}

export async function allTags(env: Env, userId: string): Promise<string[]> {
	const db = getDb(env);
	const rows = await db
		.select({ tags: linkTable.tags })
		.from(linkTable)
		.where(eq(linkTable.userId, userId));
	const seen = new Set<string>();
	for (const row of rows) for (const tag of row.tags ?? []) seen.add(tag);
	return [...seen].sort();
}

export async function archivedCount(env: Env, userId: string): Promise<number> {
	const db = getDb(env);
	const [row] = await db
		.select({ value: sql<number>`count(*)` })
		.from(linkTable)
		.where(and(eq(linkTable.userId, userId), eq(linkTable.archived, true)));
	return row?.value ?? 0;
}

/* -------------------------------------------------------------------------- */
/*  Create                                                                     */
/* -------------------------------------------------------------------------- */

export async function createLink(
	env: Env,
	userId: string,
	input: LinkInput,
	ctx?: WaitUntil
): Promise<Link> {
	const [created] = await createLinks(env, userId, [input], ctx);
	if (!created) throw new LinkError('Could not create the link.');
	return created;
}

/**
 * Create many links against one domain.
 *
 * Slug collisions are resolved against a single in-memory set rather than a
 * query per link, and the rows go in through `db.batch` — D1 allows only 100
 * bound parameters per statement, so a multi-row `INSERT` would cap out at two
 * links a time.
 */
export async function createLinks(
	env: Env,
	userId: string,
	inputs: LinkInput[],
	ctx?: WaitUntil
): Promise<Link[]> {
	if (inputs.length === 0) return [];

	const db = getDb(env);
	const now = new Date();
	const domain = await resolveDomain(env, userId, inputs[0]!.domainId, undefined);
	const taken = await slugsOnDomain(env, domain.id);
	// Checked once per distinct folder rather than once per link, which is the
	// difference between one query and a thousand on a bulk import.
	const folders = await validFolders(env, userId, inputs.map((input) => input.folderId));

	const rows = await Promise.all(
		inputs.map(async (input) => {
			const destinationError = validateDestination(input.destination);
			if (destinationError) throw new LinkError(destinationError, 'destination');

			const slug = input.slug?.trim() || generateUnique(taken, domain.slugLength);
			const slugError = validateSlug(slug);
			if (slugError) throw new LinkError(slugError, 'slug');
			if (taken.has(slug.toLowerCase())) {
				throw new LinkError(`"${slug}" is already in use on ${domain.hostname}.`, 'slug');
			}
			taken.add(slug.toLowerCase());

			return {
				id: newId(),
				slug,
				userId,
				domainId: domain.id,
				folderId: input.folderId ? (folders.get(input.folderId) ?? null) : null,
				destination: input.destination.trim(),
				title: emptyToNull(input.title),
				description: emptyToNull(input.description),
				tags: normalizeTags(input.tags),
				enabled: input.enabled ?? true,
				archived: input.archived ?? false,
				passwordHash: input.password ? await hashPassword(input.password) : null,
				expiresAt: toDate(input.expiresAt),
				maxClicks: positiveOrNull(input.maxClicks),
				fallbackUrl: validatedUrlOrNull(input.fallbackUrl, 'fallbackUrl'),
				forwardQuery: input.forwardQuery ?? false,
				utmSource: emptyToNull(input.utmSource),
				utmMedium: emptyToNull(input.utmMedium),
				utmCampaign: emptyToNull(input.utmCampaign),
				utmTerm: emptyToNull(input.utmTerm),
				utmContent: emptyToNull(input.utmContent),
				redirectStatus: validStatus(input.redirectStatus ?? domain.redirectStatus),
				rules: validateRules(input.rules),
				variants: validateVariants(input.variants),
				deepLink: validateDeepLink(input.deepLink),
				cloak: validateCloak(input.cloak),
				hideReferrer: input.hideReferrer ?? false,
				trackConversions: input.trackConversions ?? false,
				qrOptions: input.qrOptions ?? null,
				createdAt: now,
				updatedAt: now
			};
		})
	);

	for (const chunk of chunks(rows, 50)) {
		await runBatch(db, chunk.map((row) => db.insert(linkTable).values(row)));
	}

	const created = await db
		.select()
		.from(linkTable)
		.where(inArray(linkTable.id, rows.map((row) => row.id)));

	const hosts = hostsForDomain(domain);
	await forEachLimited(created, 10, (row) => writeLinkRecord(env, row, hosts));

	await fire(
		env,
		userId,
		created.map((row) => ({
			event: 'link.created' as const,
			data: { link: publicLink(row, domain) }
		})),
		ctx
	);

	return created;
}

/* -------------------------------------------------------------------------- */
/*  Update                                                                     */
/* -------------------------------------------------------------------------- */

export async function updateLink(
	env: Env,
	userId: string,
	id: string,
	input: Partial<LinkInput>,
	ctx?: WaitUntil
): Promise<Link> {
	const db = getDb(env);
	const existing = await getLink(env, userId, id);
	if (!existing) throw new LinkError('Link not found.');

	const previousDomain = await requireDomain(env, userId, existing.domainId);
	const domain = await resolveDomain(env, userId, input.domainId, previousDomain);

	const patch: Partial<Link> = { updatedAt: new Date() };
	if (domain.id !== existing.domainId) patch.domainId = domain.id;

	if (input.destination !== undefined) {
		const error = validateDestination(input.destination);
		if (error) throw new LinkError(error, 'destination');
		patch.destination = input.destination.trim();
	}

	const slug = input.slug?.trim();
	const movingDomain = domain.id !== existing.domainId;
	if ((slug && slug !== existing.slug) || movingDomain) {
		const next = slug || existing.slug;
		const error = validateSlug(next);
		if (error) throw new LinkError(error, 'slug');
		if (await slugTaken(env, domain.id, next, id)) {
			throw new LinkError(`"${next}" is already in use on ${domain.hostname}.`, 'slug');
		}
		patch.slug = next;
	}

	if (input.folderId !== undefined) patch.folderId = await validFolder(env, userId, input.folderId);
	if (input.title !== undefined) patch.title = emptyToNull(input.title);
	if (input.description !== undefined) patch.description = emptyToNull(input.description);
	if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
	if (input.enabled !== undefined) patch.enabled = input.enabled;
	if (input.archived !== undefined) patch.archived = input.archived;
	if (input.password !== undefined) {
		patch.passwordHash = input.password ? await hashPassword(input.password) : null;
	}
	if (input.expiresAt !== undefined) patch.expiresAt = toDate(input.expiresAt);
	if (input.maxClicks !== undefined) patch.maxClicks = positiveOrNull(input.maxClicks);
	if (input.fallbackUrl !== undefined) {
		patch.fallbackUrl = validatedUrlOrNull(input.fallbackUrl, 'fallbackUrl');
	}
	if (input.forwardQuery !== undefined) patch.forwardQuery = input.forwardQuery;
	if (input.utmSource !== undefined) patch.utmSource = emptyToNull(input.utmSource);
	if (input.utmMedium !== undefined) patch.utmMedium = emptyToNull(input.utmMedium);
	if (input.utmCampaign !== undefined) patch.utmCampaign = emptyToNull(input.utmCampaign);
	if (input.utmTerm !== undefined) patch.utmTerm = emptyToNull(input.utmTerm);
	if (input.utmContent !== undefined) patch.utmContent = emptyToNull(input.utmContent);
	if (input.redirectStatus !== undefined) patch.redirectStatus = validStatus(input.redirectStatus);
	if (input.rules !== undefined) patch.rules = validateRules(input.rules);
	if (input.variants !== undefined) patch.variants = validateVariants(input.variants);
	if (input.deepLink !== undefined) patch.deepLink = validateDeepLink(input.deepLink);
	if (input.cloak !== undefined) patch.cloak = validateCloak(input.cloak);
	if (input.hideReferrer !== undefined) patch.hideReferrer = input.hideReferrer;
	if (input.trackConversions !== undefined) patch.trackConversions = input.trackConversions;
	if (input.qrOptions !== undefined) patch.qrOptions = input.qrOptions;

	const [updated] = await db
		.update(linkTable)
		.set(patch)
		.where(and(eq(linkTable.id, id), eq(linkTable.userId, userId)))
		.returning();

	// A renamed or moved link must stop resolving at its old address immediately.
	const previousHosts = hostsForDomain(previousDomain);
	const hosts = hostsForDomain(domain);
	const stale = previousHosts.filter((host) => !hosts.includes(host) || patch.slug !== undefined);
	if (stale.length > 0) await deleteLinkRecord(env, stale, existing.slug);

	await writeLinkRecord(env, updated!, hosts);
	await fire(
		env,
		userId,
		[{ event: 'link.updated', data: { link: publicLink(updated!, domain) } }],
		ctx
	);

	return updated!;
}

/* -------------------------------------------------------------------------- */
/*  Delete and archive                                                         */
/* -------------------------------------------------------------------------- */

export async function deleteLink(
	env: Env,
	userId: string,
	id: string,
	ctx?: WaitUntil
): Promise<void> {
	const removed = await deleteLinks(env, userId, [id], ctx);
	if (removed === 0) throw new LinkError('Link not found.');
}

/** Returns how many were actually removed — ids that were not the caller's are skipped. */
export async function deleteLinks(
	env: Env,
	userId: string,
	ids: string[],
	ctx?: WaitUntil
): Promise<number> {
	if (ids.length === 0) return 0;

	const db = getDb(env);
	const rows = await db
		.select()
		.from(linkTable)
		.where(and(eq(linkTable.userId, userId), inArray(linkTable.id, ids)));
	if (rows.length === 0) return 0;

	const domains = await domainsById(env, userId);
	const found = rows.map((row) => row.id);

	// D1 does not enforce `on delete cascade` unless foreign keys are on for the
	// session, so the dependent rows are removed explicitly.
	for (const chunk of chunks(found, 50)) {
		await db.delete(click).where(inArray(click.linkId, chunk));
		await db.delete(conversion).where(inArray(conversion.linkId, chunk));
		await db
			.delete(linkTable)
			.where(and(eq(linkTable.userId, userId), inArray(linkTable.id, chunk)));
	}

	await forEachLimited(rows, 10, async (row) => {
		const domain = domains.get(row.domainId);
		if (domain) await deleteLinkRecord(env, hostsForDomain(domain), row.slug);
	});

	await fire(
		env,
		userId,
		rows.map((row) => ({
			event: 'link.deleted' as const,
			data: { link: { id: row.id, slug: row.slug, domainId: row.domainId } }
		})),
		ctx
	);

	return rows.length;
}

/** Archive or restore in bulk. Archived links keep resolving. */
export async function archiveLinks(
	env: Env,
	userId: string,
	ids: string[],
	archived: boolean,
	ctx?: WaitUntil
): Promise<number> {
	if (ids.length === 0) return 0;

	const db = getDb(env);
	let touched = 0;

	for (const chunk of chunks(ids, 50)) {
		const rows = await db
			.update(linkTable)
			.set({ archived, updatedAt: new Date() })
			.where(and(eq(linkTable.userId, userId), inArray(linkTable.id, chunk)))
			.returning({ id: linkTable.id, slug: linkTable.slug });
		touched += rows.length;
	}

	await fire(
		env,
		userId,
		[{ event: 'link.archived', data: { ids, archived, count: touched } }],
		ctx
	);

	return touched;
}

/** Add and/or remove tags across many links in one pass. */
export async function tagLinks(
	env: Env,
	userId: string,
	ids: string[],
	changes: { add?: string[]; remove?: string[] }
): Promise<number> {
	if (ids.length === 0) return 0;

	const db = getDb(env);
	const add = normalizeTags(changes.add);
	const remove = new Set(normalizeTags(changes.remove));
	if (add.length === 0 && remove.size === 0) return 0;

	const rows = await db
		.select({ id: linkTable.id, tags: linkTable.tags })
		.from(linkTable)
		.where(and(eq(linkTable.userId, userId), inArray(linkTable.id, ids)));

	const now = new Date();
	for (const chunk of chunks(rows, 50)) {
		await runBatch(
			db,
			chunk.map((row) => {
				const next = normalizeTags([
					...(row.tags ?? []).filter((tag) => !remove.has(tag)),
					...add
				]);
				return db
					.update(linkTable)
					.set({ tags: next, updatedAt: now })
					.where(eq(linkTable.id, row.id));
			})
		);
	}

	return rows.length;
}

/** Used when a whole domain is removed. Skips the per-link webhook storm. */
export async function deleteLinksForDomain(
	env: Env,
	userId: string,
	domain: Domain
): Promise<number> {
	const db = getDb(env);
	const rows = await db
		.select({ id: linkTable.id, slug: linkTable.slug })
		.from(linkTable)
		.where(and(eq(linkTable.userId, userId), eq(linkTable.domainId, domain.id)));
	if (rows.length === 0) return 0;

	const ids = rows.map((row) => row.id);
	for (const chunk of chunks(ids, 50)) {
		await db.delete(click).where(inArray(click.linkId, chunk));
		await db.delete(conversion).where(inArray(conversion.linkId, chunk));
		await db.delete(linkTable).where(inArray(linkTable.id, chunk));
	}

	const hosts = hostsForDomain(domain);
	await forEachLimited(rows, 10, (row) => deleteLinkRecord(env, hosts, row.slug));

	return rows.length;
}

/** Republish every link into KV. Useful after restoring or migrating a database. */
export async function resyncLinks(env: Env, userId: string): Promise<number> {
	const db = getDb(env);
	const domains = await domainsById(env, userId);
	const rows = await db.select().from(linkTable).where(eq(linkTable.userId, userId));

	await forEachLimited(rows, 10, async (row) => {
		const domain = domains.get(row.domainId);
		if (domain) await writeLinkRecord(env, row, hostsForDomain(domain));
	});

	return rows.length;
}

/* -------------------------------------------------------------------------- */
/*  Domain and folder resolution                                               */
/* -------------------------------------------------------------------------- */

async function requireDomain(env: Env, userId: string, id: string): Promise<Domain> {
	const row = await getDomain(env, userId, id);
	if (!row) throw new LinkError('This link points at a domain that no longer exists.', 'domainId');
	return row;
}

/**
 * Which domain a write lands on: the one asked for, the one it is already on,
 * or the user's default.
 */
async function resolveDomain(
	env: Env,
	userId: string,
	requested: string | null | undefined,
	current: Domain | undefined
): Promise<Domain> {
	if (requested) {
		const row = await getDomain(env, userId, requested);
		if (!row) throw new LinkError('Domain not found.', 'domainId');
		return row;
	}
	if (current) return current;

	const rows = await listDomains(env, userId);
	const preferred = rows.find((row) => row.isDefault) ?? rows[0];
	if (preferred) return preferred;

	// First link on a brand-new account.
	return ensureDefaultDomain(env, userId, new URL('https://localhost'));
}

async function validFolder(
	env: Env,
	userId: string,
	folderId: string | null | undefined
): Promise<string | null> {
	if (!folderId) return null;
	const { getFolder } = await import('./folders');
	const row = await getFolder(env, userId, folderId);
	if (!row) throw new LinkError('Folder not found.', 'folderId');
	return row.id;
}

/** Validate every distinct folder id in one pass, for the bulk create path. */
async function validFolders(
	env: Env,
	userId: string,
	folderIds: (string | null | undefined)[]
): Promise<Map<string, string>> {
	const wanted = [...new Set(folderIds.filter((id): id is string => Boolean(id)))];
	if (wanted.length === 0) return new Map();

	const db = getDb(env);
	const { folder } = await import('./db/schema');
	const rows = await db
		.select({ id: folder.id })
		.from(folder)
		.where(and(eq(folder.userId, userId), inArray(folder.id, wanted)));

	const found = new Map(rows.map((row) => [row.id, row.id]));
	const missing = wanted.find((id) => !found.has(id));
	if (missing) throw new LinkError('Folder not found.', 'folderId');
	return found;
}

export async function slugTaken(
	env: Env,
	domainId: string,
	slug: string,
	exceptId?: string
): Promise<boolean> {
	const db = getDb(env);
	const [row] = await db
		.select({ id: linkTable.id })
		.from(linkTable)
		.where(and(eq(linkTable.domainId, domainId), eq(linkTable.slug, slug)))
		.limit(1);
	return Boolean(row) && row!.id !== exceptId;
}

async function slugsOnDomain(env: Env, domainId: string): Promise<Set<string>> {
	const db = getDb(env);
	const rows = await db
		.select({ slug: linkTable.slug })
		.from(linkTable)
		.where(eq(linkTable.domainId, domainId));
	return new Set(rows.map((row) => row.slug.toLowerCase()));
}

function generateUnique(taken: Set<string>, length: number): string {
	for (let attempt = 0; attempt < 8; attempt++) {
		// Widen the alphabet's reach rather than retrying forever on a busy domain.
		const slug = generateSlug(attempt < 5 ? length : length + 2);
		if (!taken.has(slug.toLowerCase())) return slug;
	}
	throw new LinkError('Could not allocate a unique slug. Try again.', 'slug');
}

/* -------------------------------------------------------------------------- */
/*  Webhook payload                                                            */
/* -------------------------------------------------------------------------- */

function publicLink(row: Link, domain: Domain) {
	return {
		id: row.id,
		slug: row.slug,
		domain: domain.hostname,
		destination: row.destination,
		title: row.title,
		tags: row.tags,
		enabled: row.enabled,
		archived: row.archived,
		createdAt: row.createdAt.toISOString()
	};
}

/* -------------------------------------------------------------------------- */
/*  Input normalisation                                                        */
/* -------------------------------------------------------------------------- */

function emptyToNull(value: string | null | undefined): string | null {
	if (value === undefined || value === null) return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function positiveOrNull(value: number | null | undefined): number | null {
	if (value === undefined || value === null) return null;
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function toDate(value: number | null | undefined): Date | null {
	if (value === undefined || value === null) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function validStatus(value: number | undefined): number {
	return value && VALID_STATUSES.has(value) ? value : 302;
}

function validatedUrlOrNull(value: string | null | undefined, field: string): string | null {
	const trimmed = emptyToNull(value);
	if (!trimmed) return null;
	const error = validateDestination(trimmed);
	if (error) throw new LinkError(error, field);
	return trimmed;
}

function normalizeTags(tags: string[] | undefined): string[] {
	if (!tags) return [];
	const cleaned = tags
		.map((tag) => tag.trim().toLowerCase())
		.filter((tag) => tag.length > 0 && tag.length <= 32);
	return [...new Set(cleaned)].slice(0, 12);
}

const RULE_TYPES = new Set<LinkRule['type']>([
	'country',
	'region',
	'city',
	'continent',
	'device',
	'os',
	'browser',
	'language',
	'referer',
	'asn',
	'timezone',
	'query'
]);

const RULE_OPS = new Set(['contains', 'is', 'starts_with', 'ends_with', 'not']);

function validateRules(rules: LinkRule[] | undefined): LinkRule[] {
	if (!rules) return [];
	return rules
		.filter((rule) => rule && RULE_TYPES.has(rule.type) && rule.value?.trim())
		.map((rule) => {
			const error = validateDestination(rule.destination);
			if (error) throw new LinkError(`Targeting rule: ${error}`, 'rules');
			return {
				type: rule.type,
				op: rule.op && RULE_OPS.has(rule.op) ? rule.op : 'contains',
				value: rule.value.trim(),
				destination: rule.destination.trim()
			} satisfies LinkRule;
		})
		.slice(0, 25);
}

function validateVariants(variants: LinkVariant[] | undefined): LinkVariant[] {
	if (!variants) return [];
	const cleaned = variants
		.filter((variant) => variant?.destination?.trim())
		.map((variant, index) => {
			const error = validateDestination(variant.destination);
			if (error) throw new LinkError(`Split test: ${error}`, 'variants');
			const weight = Number(variant.weight);
			return {
				label: variant.label?.trim() || String.fromCharCode(65 + index),
				destination: variant.destination.trim(),
				weight: Number.isFinite(weight) && weight >= 0 ? Math.min(1000, weight) : 1
			} satisfies LinkVariant;
		})
		.slice(0, 10);

	// A single arm is not a split test; it would silently replace the
	// destination for every visitor, which is not what anyone means by it.
	return cleaned.length >= 2 ? cleaned : [];
}

function validateDeepLink(config: DeepLinkConfig | null | undefined): DeepLinkConfig | null {
	if (!config) return null;
	const clean = (value: string | null | undefined) => {
		const trimmed = value?.trim();
		return trimmed ? trimmed : null;
	};

	const next: DeepLinkConfig = {
		iosUrl: clean(config.iosUrl),
		iosFallback: clean(config.iosFallback),
		androidUrl: clean(config.androidUrl),
		androidFallback: clean(config.androidFallback),
		timeoutMs: Number.isFinite(config.timeoutMs)
			? Math.min(10_000, Math.max(200, Number(config.timeoutMs)))
			: 1200
	};

	// Store-fallback URLs are ordinary web links and must be safe; the app URLs
	// themselves are custom schemes, so they are deliberately not checked.
	for (const [key, value] of [
		['deepLink.iosFallback', next.iosFallback],
		['deepLink.androidFallback', next.androidFallback]
	] as const) {
		if (!value) continue;
		const error = validateDestination(value);
		if (error) throw new LinkError(`${key}: ${error}`, 'deepLink');
	}

	return next.iosUrl || next.androidUrl ? next : null;
}

function validateCloak(config: CloakConfig | null | undefined): CloakConfig | null {
	if (!config) return null;
	const trim = (value: string | null | undefined) => value?.trim() || null;
	const next: CloakConfig = {
		enabled: Boolean(config.enabled),
		title: trim(config.title),
		description: trim(config.description),
		image: trim(config.image)
	};
	if (next.image) {
		const error = validateDestination(next.image);
		if (error) throw new LinkError(`Cloak image: ${error}`, 'cloak');
	}
	return next.enabled || next.title || next.description || next.image ? next : null;
}

/* -------------------------------------------------------------------------- */
/*  Small utilities                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `db.batch` insists on a non-empty tuple at the type level, which an array
 * built from a loop can never be. The runtime is happy with any array.
 */
type BatchStatements = Parameters<Db['batch']>[0];

async function runBatch(db: Db, statements: unknown[]): Promise<void> {
	if (statements.length === 0) return;
	await db.batch(statements as unknown as BatchStatements);
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
	for (let index = 0; index < items.length; index += size) {
		yield items.slice(index, index + size);
	}
}

/**
 * Run an async job over every item, `limit` at a time. Bulk operations touch KV
 * once or twice per link, and firing a thousand of those at once trips
 * Workers' concurrent-subrequest ceiling.
 */
async function forEachLimited<T>(
	items: T[],
	limit: number,
	job: (item: T) => Promise<unknown>
): Promise<void> {
	for (const chunk of chunks(items, limit)) {
		await Promise.all(chunk.map(job));
	}
}
