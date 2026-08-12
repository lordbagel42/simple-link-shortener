import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, readJson, requireApiUser } from '$lib/server/api';
import { WebhookError, deleteWebhook, test, updateWebhook } from '$lib/server/webhooks';
import { serializeWebhook } from '$lib/server/serialize';

export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const updated = await updateWebhook(auth.env, auth.userId, event.params.id, {
			url: 'url' in body ? String(body.url) : undefined,
			events: Array.isArray(body.events) ? body.events.map(String) : undefined,
			description: 'description' in body ? String(body.description ?? '') : undefined,
			enabled: 'enabled' in body ? Boolean(body.enabled) : undefined
		});
		return json(serializeWebhook(updated));
	} catch (error) {
		if (error instanceof WebhookError) {
			return apiError(
				error.message,
				error.message === 'Webhook not found.' ? 404 : 400,
				error.field
			);
		}
		throw error;
	}
};

/** `POST` sends a test delivery and reports back what the endpoint answered. */
export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	try {
		const status = await test(auth.env, auth.userId, event.params.id);
		return json({ delivered: status !== null && status < 400, status });
	} catch (error) {
		if (error instanceof WebhookError) {
			return apiError(error.message, error.message === 'Webhook not found.' ? 404 : 502);
		}
		throw error;
	}
};

export const DELETE: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	await deleteWebhook(auth.env, auth.userId, event.params.id);
	return new Response(null, { status: 204 });
};
