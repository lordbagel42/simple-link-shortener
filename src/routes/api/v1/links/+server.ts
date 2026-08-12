import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	apiError,
	apiLink,
	parseTimestamp,
	previewFrom,
	requireApiUser,
	utmFrom
} from '$lib/server/api';
import { LinkError, createLink, listLinks, type ListOptions } from '$lib/server/links';

/** `GET /api/v1/links` — list the caller's links. */
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const params = event.url.searchParams;
	const options: ListOptions = {
		search: params.get('search') ?? undefined,
		tag: params.get('tag') ?? undefined,
		sort: (params.get('sort') as ListOptions['sort']) ?? 'recent',
		status: (params.get('status') as ListOptions['status']) ?? 'all',
		limit: Math.min(Number(params.get('limit')) || 50, 200),
		offset: Number(params.get('offset')) || 0
	};

	const { links, total } = await listLinks(auth.env, auth.userId, options);
	return json({
		total,
		limit: options.limit,
		offset: options.offset,
		links: links.map((link) => apiLink(link, auth.env, event.url))
	});
};

/** `POST /api/v1/links` — create a link. `slug` is optional. */
export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch {
		return apiError('Request body must be JSON.');
	}

	try {
		const link = await createLink(auth.env, auth.userId, {
			destination: String(body.destination ?? ''),
			slug: body.slug ? String(body.slug) : undefined,
			aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : [],
			title: body.title == null ? null : String(body.title),
			description: body.description == null ? null : String(body.description),
			tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
			enabled: body.enabled === undefined ? true : Boolean(body.enabled),
			password: body.password ? String(body.password) : undefined,
			expiresAt: parseTimestamp(body.expiresAt),
			maxClicks: body.maxClicks == null ? null : Number(body.maxClicks),
			fallbackUrl: body.fallbackUrl == null ? null : String(body.fallbackUrl),
			forwardQuery: Boolean(body.forwardQuery),
			redirectStatus: body.redirectStatus ? Number(body.redirectStatus) : 302,
			rules: Array.isArray(body.rules) ? (body.rules as never) : [],
			...previewFrom(body),
			...utmFrom(body)
		});

		return json(apiLink(link, auth.env, event.url), { status: 201 });
	} catch (error) {
		if (error instanceof LinkError) return apiError(error.message, 400, error.field);
		throw error;
	}
};
