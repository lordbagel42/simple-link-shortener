import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, apiLink, linkInputFrom, readJson, requireApiUser } from '$lib/server/api';
import { LinkError, deleteLink, getLink, updateLink } from '$lib/server/links';
import { getAnalytics, parseScope, resolveWindow } from '$lib/server/analytics';
import { getDomain } from '$lib/server/domains';

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const link = await getLink(auth.env, auth.userId, event.params.id);
	if (!link) return apiError('Link not found.', 404);

	const domain = await getDomain(auth.env, auth.userId, link.domainId);
	const payload: Record<string, unknown> = apiLink(link, domain ?? undefined, event.url);

	// `?analytics=1` folds the aggregate stats into the same response.
	if (event.url.searchParams.get('analytics')) {
		payload.analytics = await getAnalytics(
			auth.env,
			parseScope(event.url.searchParams, auth.userId, link.id),
			resolveWindow(event.url.searchParams)
		);
	}

	return json(payload);
};

export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const link = await updateLink(
			auth.env,
			auth.userId,
			event.params.id,
			linkInputFrom(body, 'patch'),
			auth.ctx
		);
		const domain = await getDomain(auth.env, auth.userId, link.domainId);
		return json(apiLink(link, domain ?? undefined, event.url));
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
		await deleteLink(auth.env, auth.userId, event.params.id, auth.ctx);
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof LinkError) return apiError(error.message, 404);
		throw error;
	}
};
