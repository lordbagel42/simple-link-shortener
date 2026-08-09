import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, apiLink, parseTimestamp, requireApiUser, utmFrom } from '$lib/server/api';
import { LinkError, deleteLink, getLink, updateLink, type LinkInput } from '$lib/server/links';
import { getAnalytics } from '$lib/server/analytics';
import { parseRange } from '$lib/types';

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const link = await getLink(auth.env, auth.userId, event.params.id);
	if (!link) return apiError('Link not found.', 404);

	const payload: Record<string, unknown> = apiLink(link, auth.env, event.url);

	// `?analytics=1` folds the aggregate stats into the same response.
	if (event.url.searchParams.get('analytics')) {
		payload.analytics = await getAnalytics(
			auth.env,
			{ userId: auth.userId, linkId: link.id },
			parseRange(event.url.searchParams.get('range'))
		);
	}

	return json(payload);
};

export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch {
		return apiError('Request body must be JSON.');
	}

	const patch: Partial<LinkInput> = {};
	if ('destination' in body) patch.destination = String(body.destination);
	if ('slug' in body) patch.slug = String(body.slug);
	if ('title' in body) patch.title = body.title == null ? null : String(body.title);
	if ('description' in body) {
		patch.description = body.description == null ? null : String(body.description);
	}
	if ('tags' in body) patch.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
	if ('enabled' in body) patch.enabled = Boolean(body.enabled);
	if ('password' in body) patch.password = body.password == null ? null : String(body.password);
	if ('expiresAt' in body) patch.expiresAt = parseTimestamp(body.expiresAt);
	if ('maxClicks' in body) patch.maxClicks = body.maxClicks == null ? null : Number(body.maxClicks);
	if ('fallbackUrl' in body) {
		patch.fallbackUrl = body.fallbackUrl == null ? null : String(body.fallbackUrl);
	}
	if ('forwardQuery' in body) patch.forwardQuery = Boolean(body.forwardQuery);
	if ('redirectStatus' in body) patch.redirectStatus = Number(body.redirectStatus);
	if ('rules' in body) patch.rules = Array.isArray(body.rules) ? (body.rules as never) : [];
	if ('utm' in body) Object.assign(patch, utmFrom(body));

	try {
		const link = await updateLink(auth.env, auth.userId, event.params.id, patch);
		return json(apiLink(link, auth.env, event.url));
	} catch (error) {
		if (error instanceof LinkError) {
			return apiError(error.message, error.message === 'Link not found.' ? 404 : 400, error.field);
		}
		throw error;
	}
};

export const DELETE: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	try {
		await deleteLink(auth.env, auth.userId, event.params.id);
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof LinkError) return apiError(error.message, 404);
		throw error;
	}
};
