import { and, desc, eq } from 'drizzle-orm';
import {
	WEBHOOK_EVENTS,
	dispatchWebhooks,
	newId,
	putWebhooks,
	sign,
	type WebhookEvent,
	type WebhookPayload,
	type WebhookSubscriber
} from '@lordbagel42/links-core';
import { getDb } from './db';
import { webhook as webhookTable, webhookDelivery, type Webhook } from './db/schema';
import type { Env, WaitUntil } from './env';

/**
 * Webhook management.
 *
 * D1 holds the definitions; KV holds the subscriber list the redirect Worker
 * reads. Every write here republishes that list, so the two never drift — and
 * a user with no webhooks has no KV key at all, which is what keeps
 * `link.clicked` free for everyone who is not using it.
 */

export class WebhookError extends Error {
	constructor(
		message: string,
		readonly field: string | null = null
	) {
		super(message);
		this.name = 'WebhookError';
	}
}

export async function listWebhooks(env: Env, userId: string): Promise<Webhook[]> {
	const db = getDb(env);
	return db
		.select()
		.from(webhookTable)
		.where(eq(webhookTable.userId, userId))
		.orderBy(desc(webhookTable.createdAt));
}

export async function recentDeliveries(env: Env, userId: string, limit = 20) {
	const db = getDb(env);
	return db
		.select()
		.from(webhookDelivery)
		.where(eq(webhookDelivery.userId, userId))
		.orderBy(desc(webhookDelivery.timestamp))
		.limit(limit);
}

export type WebhookInput = {
	url: string;
	events?: string[];
	description?: string | null;
	enabled?: boolean;
};

export async function createWebhook(
	env: Env,
	userId: string,
	input: WebhookInput
): Promise<Webhook> {
	const db = getDb(env);
	const now = new Date();

	const [created] = await db
		.insert(webhookTable)
		.values({
			id: newId(),
			userId,
			url: validateUrl(input.url),
			description: input.description?.trim() || null,
			// Long enough that an HMAC over it is not worth attacking.
			secret: `whsec_${newId(32)}`,
			events: validateEvents(input.events),
			enabled: input.enabled ?? true,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	await republish(env, userId);
	return created!;
}

export async function updateWebhook(
	env: Env,
	userId: string,
	id: string,
	input: Partial<WebhookInput>
): Promise<Webhook> {
	const db = getDb(env);

	const patch: Partial<Webhook> = { updatedAt: new Date() };
	if (input.url !== undefined) patch.url = validateUrl(input.url);
	if (input.events !== undefined) patch.events = validateEvents(input.events);
	if (input.description !== undefined) patch.description = input.description?.trim() || null;
	if (input.enabled !== undefined) patch.enabled = input.enabled;

	const [updated] = await db
		.update(webhookTable)
		.set(patch)
		.where(and(eq(webhookTable.id, id), eq(webhookTable.userId, userId)))
		.returning();

	if (!updated) throw new WebhookError('Webhook not found.');

	await republish(env, userId);
	return updated;
}

export async function deleteWebhook(env: Env, userId: string, id: string): Promise<void> {
	const db = getDb(env);
	await db
		.delete(webhookTable)
		.where(and(eq(webhookTable.id, id), eq(webhookTable.userId, userId)));
	await republish(env, userId);
}

/** Rewrite the KV subscriber list from D1. Cheap, and always safe to re-run. */
export async function republish(env: Env, userId: string): Promise<void> {
	const rows = await listWebhooks(env, userId);
	const subscribers: WebhookSubscriber[] = rows
		.filter((row) => row.enabled && row.events.length > 0)
		.map((row) => ({ id: row.id, url: row.url, secret: row.secret, events: row.events }));

	await putWebhooks(env, userId, subscribers);
}

/**
 * Fire a lifecycle event from the dashboard.
 *
 * Deferred through `waitUntil` when a context is available so a slow endpoint
 * never delays the response the user is waiting on; awaited otherwise, which is
 * what happens under `vite dev`.
 */
export async function fire(
	env: Env,
	userId: string,
	payloads: WebhookPayload[],
	ctx?: WaitUntil
): Promise<void> {
	const job = dispatchWebhooks(env, userId, payloads).catch((error) => {
		console.error('webhook dispatch failed', error);
	});
	if (ctx) ctx.waitUntil(job);
	else await job;
}

/**
 * Send a synthetic payload so the user can check their endpoint works.
 *
 * Posts directly rather than going through `dispatchWebhooks`, so a disabled
 * hook — or one subscribed to no events — can still be tested. Returns the
 * status the endpoint answered with.
 */
export async function test(env: Env, userId: string, id: string): Promise<number | null> {
	const db = getDb(env);
	const [row] = await db
		.select()
		.from(webhookTable)
		.where(and(eq(webhookTable.id, id), eq(webhookTable.userId, userId)))
		.limit(1);
	if (!row) throw new WebhookError('Webhook not found.');

	const sentAt = Date.now();
	const body = JSON.stringify({
		id: newId(),
		event: 'link.created',
		createdAt: new Date(sentAt).toISOString(),
		data: { test: true, webhookId: row.id }
	});

	try {
		const response = await fetch(row.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'user-agent': 'links-webhook/1',
				'x-links-event': 'link.created',
				'x-links-signature': await sign(row.secret, sentAt, body)
			},
			body,
			signal: AbortSignal.timeout(5000)
		});
		return response.status;
	} catch (cause) {
		throw new WebhookError(cause instanceof Error ? cause.message : 'Delivery failed.');
	}
}

function validateUrl(raw: string): string {
	const value = raw.trim();
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new WebhookError('Enter a full URL, including https://', 'url');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new WebhookError('Webhook URLs must be http or https.', 'url');
	}
	return url.toString();
}

function validateEvents(events: string[] | undefined): WebhookEvent[] {
	if (!events) return [];
	const allowed = new Set<string>(WEBHOOK_EVENTS);
	return [...new Set(events.filter((event) => allowed.has(event)))] as WebhookEvent[];
}
