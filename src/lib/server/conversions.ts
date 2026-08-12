import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { newId } from '@lordbagel42/links-core';
import { getDb } from './db';
import { click, conversion, link as linkTable, type Conversion } from './db/schema';
import type { Env, WaitUntil } from './env';
import { fire } from './webhooks';

/**
 * Conversions.
 *
 * A link with `trackConversions` on appends `clid=<click id>` to its
 * destination. The destination site keeps that value and posts it back here
 * when the visitor does something worth counting, which is what turns a click
 * count into an outcome.
 *
 * `clid` is the click's own primary key, so attribution is a single lookup and
 * every dimension already recorded on that click — country, device, referrer,
 * A/B arm — comes along for free.
 */

export class ConversionError extends Error {
	constructor(
		message: string,
		readonly field: string | null = null
	) {
		super(message);
		this.name = 'ConversionError';
	}
}

export type ConversionInput = {
	/** The click id handed to the destination. Preferred. */
	clid?: string | null;
	/** Falls back to naming the link directly when there is no `clid`. */
	linkId?: string | null;
	event?: string | null;
	value?: number | null;
	currency?: string | null;
	metadata?: Record<string, unknown> | null;
	/** Epoch ms; defaults to now. */
	timestamp?: number | null;
};

export async function recordConversion(
	env: Env,
	userId: string,
	input: ConversionInput,
	ctx?: WaitUntil
): Promise<Conversion> {
	const db = getDb(env);
	const at = input.timestamp && Number.isFinite(input.timestamp) ? new Date(input.timestamp) : new Date();

	const source = await resolveSource(env, userId, input);

	const value = Number.isFinite(input.value) ? Number(input.value) : 0;
	const [created] = await db
		.insert(conversion)
		.values({
			id: newId(),
			userId,
			linkId: source.linkId,
			clickId: source.clickId,
			slug: source.slug,
			event: (input.event ?? 'conversion').trim().slice(0, 64) || 'conversion',
			value,
			currency: (input.currency ?? 'USD').trim().toUpperCase().slice(0, 8) || 'USD',
			metadata: input.metadata ?? null,
			latencyMs: source.clickedAt ? at.getTime() - source.clickedAt : null,
			timestamp: at
		})
		.returning();

	// Denormalised onto the link for the list view, exactly like click counts.
	await db
		.update(linkTable)
		.set({
			conversionCount: sql`${linkTable.conversionCount} + 1`,
			conversionValue: sql`${linkTable.conversionValue} + ${value}`
		})
		.where(eq(linkTable.id, source.linkId));

	await fire(
		env,
		userId,
		[
			{
				event: 'conversion.recorded',
				data: {
					conversion: {
						id: created!.id,
						event: created!.event,
						value: created!.value,
						currency: created!.currency,
						clickId: created!.clickId,
						latencyMs: created!.latencyMs,
						timestamp: at.toISOString()
					},
					link: { id: source.linkId, slug: source.slug }
				}
			}
		],
		ctx
	);

	return created!;
}

async function resolveSource(
	env: Env,
	userId: string,
	input: ConversionInput
): Promise<{ linkId: string; clickId: string | null; slug: string | null; clickedAt: number | null }> {
	const db = getDb(env);

	if (input.clid) {
		const [row] = await db
			.select({
				id: click.id,
				linkId: click.linkId,
				slug: click.slug,
				userId: click.userId,
				timestamp: click.timestamp
			})
			.from(click)
			.where(eq(click.id, input.clid))
			.limit(1);

		if (!row) throw new ConversionError('No click matches that clid.', 'clid');
		if (row.userId !== userId) throw new ConversionError('No click matches that clid.', 'clid');

		return {
			linkId: row.linkId,
			clickId: row.id,
			slug: row.slug,
			clickedAt: row.timestamp.getTime()
		};
	}

	if (input.linkId) {
		const [row] = await db
			.select({ id: linkTable.id, slug: linkTable.slug })
			.from(linkTable)
			.where(and(eq(linkTable.id, input.linkId), eq(linkTable.userId, userId)))
			.limit(1);

		if (!row) throw new ConversionError('Link not found.', 'linkId');
		return { linkId: row.id, clickId: null, slug: row.slug, clickedAt: null };
	}

	throw new ConversionError('Provide either a clid or a linkId.', 'clid');
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function listConversions(
	env: Env,
	scope: { userId: string; linkId?: string },
	window: { from: Date | null; to: Date },
	limit = 50
): Promise<Conversion[]> {
	const db = getDb(env);
	const filters = [eq(conversion.userId, scope.userId), lte(conversion.timestamp, window.to)];
	if (scope.linkId) filters.push(eq(conversion.linkId, scope.linkId));
	if (window.from) filters.push(gte(conversion.timestamp, window.from));

	return db
		.select()
		.from(conversion)
		.where(and(...filters))
		.orderBy(desc(conversion.timestamp))
		.limit(limit);
}
