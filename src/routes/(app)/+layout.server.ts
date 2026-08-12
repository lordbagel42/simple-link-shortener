import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { domainLinkCounts, ensureDefaultDomain, listDomains } from '$lib/server/domains';
import { listFolders } from '$lib/server/folders';
import { serializeDomain, serializeFolder } from '$lib/server/serialize';

/**
 * Domains and folders are loaded once for the whole dashboard: the link editor,
 * the filter bar and the settings page all need them, and they change rarely
 * enough that reloading them per page would be waste.
 */
export const load: LayoutServerLoad = async (event) => {
	if (!event.locals.user) {
		const next = event.url.pathname + event.url.search;
		redirect(303, next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
	}

	const env = getEnv(event);
	const userId = event.locals.user.id;

	// Creates the first domain on a new account, and rewrites the placeholder
	// hostname the 0002 migration left behind on an upgraded one.
	await ensureDefaultDomain(env, userId, event.url);

	const [domains, counts, folders] = await Promise.all([
		listDomains(env, userId),
		domainLinkCounts(env, userId),
		listFolders(env, userId)
	]);

	return {
		domains: domains.map((domain) => serializeDomain(domain, counts[domain.id] ?? 0)),
		folders: folders.map(serializeFolder)
	};
};
