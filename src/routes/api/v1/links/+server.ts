import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, apiLink, linkInputFrom, readJson, requireApiUser } from '$lib/server/api';
import { LinkError, createLink, listLinks, type ListOptions } from '$lib/server/links';
import { domainsById } from '$lib/server/domains';

/** `GET /api/v1/links` — list the caller's links. */
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const params = event.url.searchParams;
	const options: ListOptions = {
		search: params.get('search') ?? undefined,
		tag: params.get('tag') ?? undefined,
		folderId: params.get('folder') ?? undefined,
		domainId: params.get('domain') ?? undefined,
		sort: (params.get('sort') as ListOptions['sort']) ?? 'recent',
		status: (params.get('status') as ListOptions['status']) ?? 'all',
		limit: Math.min(Number(params.get('limit')) || 50, 200),
		offset: Number(params.get('offset')) || 0
	};

	const [{ links, total }, domains] = await Promise.all([
		listLinks(auth.env, auth.userId, options),
		domainsById(auth.env, auth.userId)
	]);

	return json({
		total,
		limit: options.limit,
		offset: options.offset,
		links: links.map((link) => apiLink(link, domains.get(link.domainId), event.url))
	});
};

/** `POST /api/v1/links` — create a link. `slug` is generated when omitted. */
export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const link = await createLink(auth.env, auth.userId, linkInputFrom(body, 'create'), auth.ctx);
		const domains = await domainsById(auth.env, auth.userId);
		return json(apiLink(link, domains.get(link.domainId), event.url), { status: 201 });
	} catch (error) {
		if (error instanceof LinkError) return apiError(error.message, 400, error.field);
		throw error;
	}
};
