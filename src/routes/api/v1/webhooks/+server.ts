import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, readJson, requireApiUser } from '$lib/server/api';
import { WebhookError, createWebhook, listWebhooks } from '$lib/server/webhooks';
import { serializeWebhook } from '$lib/server/serialize';

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const hooks = await listWebhooks(auth.env, auth.userId);
	return json({ webhooks: hooks.map(serializeWebhook) });
};

export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const created = await createWebhook(auth.env, auth.userId, {
			url: String(body.url ?? ''),
			events: Array.isArray(body.events) ? body.events.map(String) : [],
			description: body.description == null ? null : String(body.description),
			enabled: body.enabled === undefined ? true : Boolean(body.enabled)
		});
		// The only time the signing secret is ever returned.
		return json({ ...serializeWebhook(created), secret: created.secret }, { status: 201 });
	} catch (error) {
		if (error instanceof WebhookError) return apiError(error.message, 400, error.field);
		throw error;
	}
};
