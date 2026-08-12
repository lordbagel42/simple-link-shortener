import { and, desc, eq, like, or, sql, asc } from 'drizzle-orm';
import { getDb } from './db';
import { click, link as linkTable, type Link, type LinkRule } from './db/schema';
import type { Env } from './env';
import { hashPassword, newId } from '@lordbagel42/links-core';
import { deleteLinkRecord, writeLinkRecord } from '@lordbagel42/links-core';
import { generateSlug, validateDestination, validateSlug } from '$lib/slug';

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

export async function listLinks(
	env: Env,
	userId: string,
	options: ListOptions = {}
): Promise<{ links: Link[]; total: number }> {
	const db = getDb(env);
	const filters = [eq(linkTable.userId, userId)];

	if (options.search) {
		const needle = `%${options.search.toLowerCase()}%`;
		filters.push(
			or(
				like(sql`lower(${linkTable.slug})`, needle),
				like(sql`lower(${linkTable.destination})`, needle),
				like(sql`lower(coalesce(${linkTable.title}, ''))`, needle)
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

export async function createLink(env: Env, userId: string, input: LinkInput): Promise<Link> {
	const db = getDb(env);
	const now = new Date();

	const destinationError = validateDestination(input.destination);
	if (destinationError) throw new LinkError(destinationError, 'destination');

	const slug = input.slug?.trim() || (await uniqueSlug(env));
	const slugError = validateSlug(slug);
	if (slugError) throw new LinkError(slugError, 'slug');
	if (await slugTaken(env, slug)) throw new LinkError(`"${slug}" is already in use.`, 'slug');

	const [created] = await db
		.insert(linkTable)
		.values({
			id: newId(),
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
			rules: validateRules(input.rules),
			createdAt: now,
			updatedAt: now
		})
		.returning();

	await writeLinkRecord(env, created);
	return created;
}

export async function updateLink(
	env: Env,
	userId: string,
	id: string,
	input: Partial<LinkInput>
): Promise<Link> {
	const db = getDb(env);
	const existing = await getLink(env, userId, id);
	if (!existing) throw new LinkError('Link not found.');

	const patch: Partial<Link> = { updatedAt: new Date() };

	if (input.destination !== undefined) {
		const error = validateDestination(input.destination);
		if (error) throw new LinkError(error, 'destination');
		patch.destination = input.destination.trim();
	}

	if (input.slug !== undefined && input.slug !== existing.slug) {
		const slug = input.slug.trim();
		const error = validateSlug(slug);
		if (error) throw new LinkError(error, 'slug');
		if (await slugTaken(env, slug)) throw new LinkError(`"${slug}" is already in use.`, 'slug');
		patch.slug = slug;
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
	if (input.rules !== undefined) patch.rules = validateRules(input.rules);

	const [updated] = await db
		.update(linkTable)
		.set(patch)
		.where(and(eq(linkTable.id, id), eq(linkTable.userId, userId)))
		.returning();

	// A renamed link must stop resolving under its old slug immediately.
	if (patch.slug && patch.slug !== existing.slug) await deleteLinkRecord(env, existing.slug);
	await writeLinkRecord(env, updated);

	return updated;
}

export async function deleteLink(env: Env, userId: string, id: string): Promise<void> {
	const db = getDb(env);
	const existing = await getLink(env, userId, id);
	if (!existing) throw new LinkError('Link not found.');

	// D1 does not enforce `on delete cascade` unless foreign keys are on for the
	// session, so clicks are removed explicitly.
	await db.delete(click).where(eq(click.linkId, id));
	await db.delete(linkTable).where(and(eq(linkTable.id, id), eq(linkTable.userId, userId)));
	await deleteLinkRecord(env, existing.slug);
}

/** Republish every link into KV. Useful after restoring or migrating a database. */
export async function resyncLinks(env: Env, userId: string): Promise<number> {
	const db = getDb(env);
	const rows = await db.select().from(linkTable).where(eq(linkTable.userId, userId));
	for (const row of rows) await writeLinkRecord(env, row);
	return rows.length;
}

export async function slugTaken(env: Env, slug: string): Promise<boolean> {
	const db = getDb(env);
	const [row] = await db
		.select({ id: linkTable.id })
		.from(linkTable)
		.where(eq(linkTable.slug, slug))
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
