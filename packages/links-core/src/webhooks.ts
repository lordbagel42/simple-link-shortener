import type { Env } from './env.js';
import { newId } from './crypto.js';
import { writeWebhookDelivery } from './d1.js';
import type { WebhookEvent, WebhookSubscriber } from './types.js';

/**
 * Outbound webhooks.
 *
 * The subscriber list is published to KV as one key per user, so the redirect
 * path can find out whether anyone is listening without a D1 query. The read
 * happens inside `waitUntil` alongside the click write, well after the visitor
 * has been redirected, and returns `null` — costing nothing — for the common
 * case of a user with no webhooks at all.
 */

export function webhookKey(userId: string): string {
	return `hooks:${userId}`;
}

export async function readWebhooks(env: Env, userId: string): Promise<WebhookSubscriber[]> {
	const list = await env.LINKS.get<WebhookSubscriber[]>(webhookKey(userId), {
		type: 'json',
		cacheTtl: 60
	});
	return list ?? [];
}

export async function putWebhooks(
	env: Env,
	userId: string,
	subscribers: WebhookSubscriber[]
): Promise<void> {
	if (subscribers.length === 0) {
		await env.LINKS.delete(webhookKey(userId));
		return;
	}
	await env.LINKS.put(webhookKey(userId), JSON.stringify(subscribers));
}

export type WebhookPayload = {
	event: WebhookEvent;
	data: Record<string, unknown>;
};

/** How long an endpoint gets before we give up on it. */
const TIMEOUT_MS = 5000;

/**
 * Deliver every payload to every subscriber listening for it.
 *
 * Failures are logged and swallowed: a broken endpoint must never take down a
 * redirect, and this always runs after the response has gone out.
 */
export async function dispatchWebhooks(
	env: Env,
	userId: string,
	payloads: readonly WebhookPayload[]
): Promise<void> {
	if (payloads.length === 0) return;

	const subscribers = await readWebhooks(env, userId);
	if (subscribers.length === 0) return;

	const jobs: Promise<void>[] = [];
	for (const payload of payloads) {
		for (const subscriber of subscribers) {
			if (!subscriber.events.includes(payload.event)) continue;
			jobs.push(deliver(env, userId, subscriber, payload));
		}
	}

	await Promise.allSettled(jobs);
}

async function deliver(
	env: Env,
	userId: string,
	subscriber: WebhookSubscriber,
	payload: WebhookPayload
): Promise<void> {
	const sentAt = Date.now();
	const body = JSON.stringify({
		id: newId(),
		event: payload.event,
		createdAt: new Date(sentAt).toISOString(),
		data: payload.data
	});

	let status: number | null = null;
	let error: string | null = null;

	try {
		const response = await fetch(subscriber.url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'user-agent': 'links-webhook/1',
				'x-links-event': payload.event,
				'x-links-signature': await sign(subscriber.secret, sentAt, body)
			},
			body,
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		status = response.status;
		if (!response.ok) error = `HTTP ${response.status}`;
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	}

	await writeWebhookDelivery(env, {
		id: newId(),
		webhookId: subscriber.id,
		userId,
		event: payload.event,
		status,
		error,
		durationMs: Date.now() - sentAt,
		timestamp: sentAt
	}).catch(() => {});
}

/**
 * `t=<unix seconds>,v1=<hex>` where the HMAC covers `<t>.<body>`, so a captured
 * delivery cannot be replayed against a different payload or timestamp.
 */
export async function sign(secret: string, sentAt: number, body: string): Promise<string> {
	const seconds = Math.floor(sentAt / 1000);
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${seconds}.${body}`));
	const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `t=${seconds},v1=${hex}`;
}
