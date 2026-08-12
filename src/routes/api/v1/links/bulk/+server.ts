import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	apiError,
	apiLink,
	linkInputFrom,
	readJson,
	requireApiUser,
	stringIds
} from '$lib/server/api';
import {
	LinkError,
	archiveLinks,
	createLinks,
	deleteLinks,
	tagLinks,
	type LinkInput
} from '$lib/server/links';
import { domainsById } from '$lib/server/domains';

/**
 * `POST /api/v1/links/bulk` — one endpoint, four actions.
 *
 * `action` defaults to `create`, which is the one people reach for; `delete`,
 * `archive` and `tag` take `ids` instead of `links`. Creation is not
 * transactional: a bad entry fails the whole request before anything is
 * written, but a partial failure mid-write leaves what it wrote.
 */
const MAX_LINKS = 1000;

export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	const action = String(body.action ?? 'create');

	try {
		switch (action) {
			case 'create': {
				const entries = Array.isArray(body.links) ? body.links : null;
				if (!entries) return apiError('`links` must be an array.', 400, 'links');
				if (entries.length === 0) return json({ created: 0, links: [] });
				if (entries.length > MAX_LINKS) {
					return apiError(`Send at most ${MAX_LINKS} links per call.`, 400, 'links');
				}

				const inputs: LinkInput[] = entries.map((entry) =>
					linkInputFrom(entry as Record<string, unknown>, 'create')
				);
				// One domain per call: the slug namespace is per-domain, and mixing
				// them would mean re-reading the taken-slug set for each one.
				if (body.domainId) for (const input of inputs) input.domainId = String(body.domainId);

				const created = await createLinks(auth.env, auth.userId, inputs, auth.ctx);
				const domains = await domainsById(auth.env, auth.userId);
				return json(
					{
						created: created.length,
						links: created.map((link) => apiLink(link, domains.get(link.domainId), event.url))
					},
					{ status: 201 }
				);
			}

			case 'delete': {
				const removed = await deleteLinks(auth.env, auth.userId, stringIds(body.ids), auth.ctx);
				return json({ deleted: removed });
			}

			case 'archive': {
				const archived = body.archived === undefined ? true : Boolean(body.archived);
				const touched = await archiveLinks(
					auth.env,
					auth.userId,
					stringIds(body.ids),
					archived,
					auth.ctx
				);
				return json({ updated: touched, archived });
			}

			case 'tag': {
				const touched = await tagLinks(auth.env, auth.userId, stringIds(body.ids), {
					add: Array.isArray(body.add) ? body.add.map(String) : [],
					remove: Array.isArray(body.remove) ? body.remove.map(String) : []
				});
				return json({ updated: touched });
			}

			default:
				return apiError(
					'`action` must be one of create, delete, archive, tag.',
					400,
					'action'
				);
		}
	} catch (error) {
		if (error instanceof LinkError) return apiError(error.message, 400, error.field);
		throw error;
	}
};
