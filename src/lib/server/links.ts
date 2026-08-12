import { and, asc, desc, eq, getTableColumns, inArray, like, or, sql } from 'drizzle-orm';
import { getDb } from './db';
import {
	click,
	link as linkTable,
	linkSlug,
	type Link,
	type LinkRule,
	type PreviewMode
} from './db/schema';
import type { Env } from './env';
import { hashPassword, newId, isPattern, allSlugs, isPreviewMode } from '@lordbagel42/links-core';
import {
	deleteLinkRecords,
	writeLinkRecord,
	writePatternIndex
} from '@lordbagel42/links-core';
import {
	MAX_SLUGS_PER_LINK,
	generateSlug,
	validateDestination,
	validateSlugOrPattern
} from '$lib/slug';

export class LinkError extends Error {
	constructor(
		message: string,
		readonly field: string | null = null
	) {
		super(message);
		this.name = 'LinkError';
	}
}

/**
 * A link row plus every slug that resolves to it, primary first.
 *
 * Nothing in the app deals in a bare `Link`: the slugs come back from the same
 * statement as the row itself, and every write publishes them together.
 */
export type LinkWithSlugs = Link & { slugs: string[] };

export type LinkInput = {
	slug?: string;
	/** Extra slugs beyond the primary. Each is a KV key of its own. */
	aliases?: string[];
	destination: string;
	title?: string | null;
	description?: string | null;
	tags?: string[];
	enabled?: boolean;
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
	previewMode?: PreviewMode;
	previewImage?: string | null;
	rules?: LinkRule[];
};

const VALID_STATUSES = new Set([301, 302, 307, 308]);

export type ListOptions = {
	search?: string;
	tag?: string;
	sort?: 'recent' | 'clicks' | 'slug';
	status?: 'all' | 'active' | 'inactive';
	limit?: number;
	offset?: number;
};

/**
 * The link columns plus its aliases, gathered in one statement. Slugs cannot
 * contain a comma, so `group_concat`'s default separator is unambiguous.
 */
function linkSelection() {
	return {
		...getTableColumns(linkTable),
		aliasList: sql<string | null>`(
			select group_concat(${linkSlug.slug}) from ${linkSlug}
			where ${linkSlug.linkId} = ${linkTable.id} and ${linkSlug.isPrimary} = 0
		)`
	};
}

type LinkRow = Link & { aliasList: string | null };

function withSlugs({ aliasList, ...link }: LinkRow): LinkWithSlugs {
	return { ...link, slugs: allSlugs(link.slug, aliasList ? aliasList.split(',') : []) };
}

export async function listLinks(
	env: Env,
	userId: string,
	options: ListOptions = {}
): Promise<{ links: LinkWithSlugs[]; total: number }> {
	const db = getDb(env);
	const filters = [eq(linkTable.userId, userId)];

	if (options.search) {
		const needle = `%${options.search.toLowerCase()}%`;
		filters.push(
			or(
				like(sql`lower(${linkTable.slug})`, needle),
				like(sql`lower(${linkTable.destination})`, needle),
				like(sql`lower(coalesce(${linkTable.title}, ''))`, needle),
				// Aliases are short links too, so searching has to find them.
				sql`exists (select 1 from ${linkSlug}
					where ${linkSlug.linkId} = ${linkTable.id}
					  and lower(${linkSlug.slug}) like ${needle})`
			)!
		);
	}
	if (options.tag) {
		filters.push(like(linkTable.tags, `%"${options.tag}"%`));
	}
	if (options.status === 'active') filters.push(eq(linkTable.enabled, true));
	if (options.status === 'inactive') filters.push(eq(linkTable.enabled, false));

	const where = and(...filters);
	const order =
		options.sort === 'clicks'
			? desc(linkTable.clickCount)
			: options.sort === 'slug'
				? asc(linkTable.slug)
				: desc(linkTable.createdAt);

	const [links, [counted]] = await Promise.all([
		db
			.select(linkSelection())
			.from(linkTable)
			.where(where)
			.orderBy(order)
			.limit(options.limit ?? 100)
			.offset(options.offset ?? 0),
		db.select({ value: sql<number>`count(*)` }).from(linkTable).where(where)
	]);

	return { links: links.map(withSlugs), total: counted?.value ?? 0 };
}

export async function getLink(
	env: Env,
	userId: string,
	id: string
): Promise<LinkWithSlugs | null> {
	const db = getDb(env);
	const [row] = await db
		.select(linkSelection())
		.from(linkTable)
		.where(and(eq(linkTable.id, id), eq(linkTable.userId, userId)))
		.limit(1);
	return row ? withSlugs(row) : null;
}

export async function createLink(
	env: Env,
	userId: string,
	input: LinkInput
): Promise<LinkWithSlugs> {
	const db = getDb(env);
	const now = new Date();

	const destinationError = validateDestination(input.destination);
	if (destinationError) throw new LinkError(destinationError, 'destination');

	const slug = input.slug?.trim() || (await uniqueSlug(env));
	const slugError = validateSlugOrPattern(slug);
	if (slugError) throw new LinkError(slugError, 'slug');

	const slugs = allSlugs(slug, validateAliases(input.aliases));
	await assertAvailable(env, slugs);

	const id = newId();
	const [created] = await db
		.insert(linkTable)
		.values({
			id,
			slug,
			userId,
			destination: input.destination.trim(),
			title: emptyToNull(input.title),
			description: emptyToNull(input.description),
			tags: normalizeTags(input.tags),
			enabled: input.enabled ?? true,
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
			redirectStatus: validStatus(input.redirectStatus),
			previewMode: validPreviewMode(input.previewMode),
			previewImage: validatedUrlOrNull(input.previewImage, 'previewImage'),
			rules: validateRules(input.rules),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	await db.insert(linkSlug).values(slugRows(id, slugs, now));

	await writeLinkRecord(env, created, slugs);
	await syncPatternIndex(env, slugs);

	return { ...created, slugs };
}

export async function updateLink(
	env: Env,
	userId: string,
	id: string,
	input: Partial<LinkInput>
): Promise<LinkWithSlugs> {
	const db = getDb(env);
	const existing = await getLink(env, userId, id);
	if (!existing) throw new LinkError('Link not found.');

	const now = new Date();
	const patch: Partial<Link> = { updatedAt: now };

	if (input.destination !== undefined) {
		const error = validateDestination(input.destination);
		if (error) throw new LinkError(error, 'destination');
		patch.destination = input.destination.trim();
	}

	// The slug set is reconciled as a whole: renaming the primary and editing
	// the aliases are the same operation as far as KV and the pattern index are
	// concerned.
	let nextSlugs: string[] | null = null;
	if (input.slug !== undefined || input.aliases !== undefined) {
		const primary = input.slug !== undefined ? input.slug.trim() : existing.slug;
		if (primary !== existing.slug) {
			const error = validateSlugOrPattern(primary);
			if (error) throw new LinkError(error, 'slug');
			patch.slug = primary;
		}
		const aliases =
			input.aliases !== undefined ? validateAliases(input.aliases) : existing.slugs.slice(1);
		nextSlugs = allSlugs(primary, aliases);
		await assertAvailable(env, nextSlugs, id);
	}

	if (input.title !== undefined) patch.title = emptyToNull(input.title);
	if (input.description !== undefined) patch.description = emptyToNull(input.description);
	if (input.tags !== undefined) patch.tags = normalizeTags(input.tags);
	if (input.enabled !== undefined) patch.enabled = input.enabled;
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
	if (input.previewMode !== undefined) patch.previewMode = validPreviewMode(input.previewMode);
	if (input.previewImage !== undefined) {
		patch.previewImage = validatedUrlOrNull(input.previewImage, 'previewImage');
	}
	if (input.rules !== undefined) patch.rules = validateRules(input.rules);

	const [updated] = await db
		.update(linkTable)
		.set(patch)
		.where(and(eq(linkTable.id, id), eq(linkTable.userId, userId)))
		.returning();

	const slugs = nextSlugs ?? existing.slugs;

	if (nextSlugs) {
		// Replaced wholesale rather than diffed: the primary flag moves around
		// when a link is renamed, and rewriting the set cannot leave it stale.
		await db.batch([
			db.delete(linkSlug).where(eq(linkSlug.linkId, id)),
			db.insert(linkSlug).values(slugRows(id, nextSlugs, now))
		]);

		// A slug that is no longer attached must stop resolving immediately.
		const dropped = existing.slugs.filter((slug) => !includesSlug(nextSlugs!, slug));
		if (dropped.length > 0) await deleteLinkRecords(env, dropped);
	}

	await writeLinkRecord(env, updated, slugs);
	await syncPatternIndex(env, [...existing.slugs, ...slugs]);

	return { ...updated, slugs };
}

export async function deleteLink(env: Env, userId: string, id: string): Promise<void> {
	const db = getDb(env);
	const existing = await getLink(env, userId, id);
	if (!existing) throw new LinkError('Link not found.');

	// D1 does not enforce `on delete cascade` unless foreign keys are on for the
	// session, so clicks and slugs are removed explicitly.
	await db.delete(click).where(eq(click.linkId, id));
	await db.delete(linkSlug).where(eq(linkSlug.linkId, id));
	await db.delete(linkTable).where(and(eq(linkTable.id, id), eq(linkTable.userId, userId)));

	await deleteLinkRecords(env, existing.slugs);
	await syncPatternIndex(env, existing.slugs);
}

/** Republish every link into KV. Useful after restoring or migrating a database. */
export async function resyncLinks(env: Env, userId: string): Promise<number> {
	const db = getDb(env);
	const rows = await db.select(linkSelection()).from(linkTable).where(eq(linkTable.userId, userId));
	for (const row of rows) {
		const link = withSlugs(row);
		await writeLinkRecord(env, link, link.slugs);
	}
	// A repair should leave the pattern index correct whether or not this user
	// happens to own any patterns.
	await rebuildPatternIndex(env);
	return rows.length;
}

/* --- slugs ---------------------------------------------------------------- */

function slugRows(linkId: string, slugs: string[], now: Date) {
	return slugs.map((slug, index) => ({
		slug,
		linkId,
		isPrimary: index === 0,
		isPattern: isPattern(slug),
		createdAt: now
	}));
}

function includesSlug(slugs: string[], slug: string): boolean {
	return slugs.some((candidate) => candidate.toLowerCase() === slug.toLowerCase());
}

/**
 * Slugs are compared case-insensitively because KV keys are lowercased — `Docs`
 * and `docs` would be the same short link even though SQLite sees two strings.
 */
async function assertAvailable(
	env: Env,
	slugs: string[],
	excludeLinkId?: string
): Promise<void> {
	if (slugs.length === 0) return;
	const db = getDb(env);
	const lowered = slugs.map((slug) => slug.toLowerCase());

	const rows = await db
		.select({ slug: linkSlug.slug, linkId: linkSlug.linkId })
		.from(linkSlug)
		.where(inArray(sql`lower(${linkSlug.slug})`, lowered));

	for (const row of rows) {
		if (row.linkId === excludeLinkId) continue;
		throw new LinkError(
			`"${row.slug}" is already in use.`,
			includesSlug([slugs[0]], row.slug) ? 'slug' : 'aliases'
		);
	}
}

export async function slugTaken(env: Env, slug: string): Promise<boolean> {
	const db = getDb(env);
	const [row] = await db
		.select({ slug: linkSlug.slug })
		.from(linkSlug)
		.where(sql`lower(${linkSlug.slug}) = ${slug.toLowerCase()}`)
		.limit(1);
	return Boolean(row);
}

async function uniqueSlug(env: Env): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const slug = generateSlug(attempt < 3 ? 6 : 8);
		if (!(await slugTaken(env, slug))) return slug;
	}
	throw new LinkError('Could not allocate a unique slug. Try again.', 'slug');
}

function validateAliases(aliases: string[] | undefined): string[] {
	if (!aliases) return [];
	const cleaned = aliases.map((alias) => alias.trim()).filter(Boolean);

	for (const alias of cleaned) {
		const error = validateSlugOrPattern(alias);
		if (error) throw new LinkError(error, 'aliases');
	}
	if (cleaned.length + 1 > MAX_SLUGS_PER_LINK) {
		throw new LinkError(`A link can have at most ${MAX_SLUGS_PER_LINK} slugs.`, 'aliases');
	}
	return cleaned;
}

/**
 * The redirect worker matches patterns against a single KV value listing them
 * all, so any change to a pattern slug has to republish it. Links without
 * patterns — nearly all of them — skip the query entirely.
 */
async function syncPatternIndex(env: Env, touched: string[]): Promise<void> {
	if (!touched.some(isPattern)) return;
	await rebuildPatternIndex(env);
}

async function rebuildPatternIndex(env: Env): Promise<void> {
	const db = getDb(env);
	const rows = await db
		.select({ slug: linkSlug.slug })
		.from(linkSlug)
		.where(eq(linkSlug.isPattern, true));
	await writePatternIndex(
		env,
		rows.map((row) => row.slug)
	);
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

/* --- input normalisation ------------------------------------------------- */

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

function validPreviewMode(value: PreviewMode | undefined): PreviewMode {
	return isPreviewMode(value) ? value : 'target';
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
	'continent',
	'device',
	'os',
	'language',
	'referer'
]);

function validateRules(rules: LinkRule[] | undefined): LinkRule[] {
	if (!rules) return [];
	return rules
		.filter((rule) => rule && RULE_TYPES.has(rule.type) && rule.value?.trim())
		.map((rule) => {
			const error = validateDestination(rule.destination);
			if (error) throw new LinkError(`Targeting rule: ${error}`, 'rules');
			return {
				type: rule.type,
				value: rule.value.trim(),
				destination: rule.destination.trim()
			};
		})
		.slice(0, 20);
}
