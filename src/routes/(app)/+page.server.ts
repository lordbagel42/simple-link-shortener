import { fail } from '@sveltejs/kit';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { getDb } from '$lib/server/db';
import { click, link as linkTable } from '$lib/server/db/schema';
import {
	LinkError,
	allTags,
	archiveLinks,
	archivedCount,
	createLink,
	deleteLink,
	deleteLinks,
	listLinks,
	tagLinks,
	updateLink,
	type ListOptions
} from '$lib/server/links';
import { parseIds, parseLinkForm } from '$lib/server/form';
import { serializeLinks } from '$lib/server/serialize';
import { domainsById } from '$lib/server/domains';
import { expiringSoon } from '$lib/server/analytics';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const userId = event.locals.user!.id;
	const params = event.url.searchParams;

	const options: ListOptions = {
		search: params.get('q') ?? undefined,
		tag: params.get('tag') ?? undefined,
		folderId: params.get('folder') ?? undefined,
		domainId: params.get('domain') ?? undefined,
		sort: (params.get('sort') as ListOptions['sort']) ?? 'recent',
		status: (params.get('status') as ListOptions['status']) ?? 'all'
	};

	const db = getDb(env);
	const weekAgo = new Date(Date.now() - 7 * 86_400_000);

	const [{ links, total }, tags, domains, [totals], [week], archived, expiring] = await Promise.all([
		listLinks(env, userId, options),
		allTags(env, userId),
		domainsById(env, userId),
		db
			.select({
				links: sql<number>`count(*)`,
				clicks: sql<number>`coalesce(sum(${linkTable.clickCount}), 0)`,
				uniques: sql<number>`coalesce(sum(${linkTable.uniqueCount}), 0)`,
				conversions: sql<number>`coalesce(sum(${linkTable.conversionCount}), 0)`
			})
			.from(linkTable)
			.where(and(eq(linkTable.userId, userId), eq(linkTable.archived, false))),
		db
			.select({ clicks: sql<number>`count(*)` })
			.from(click)
			.where(and(eq(click.userId, userId), gte(click.timestamp, weekAgo))),
		archivedCount(env, userId),
		expiringSoon(env, userId)
	]);

	return {
		links: serializeLinks(links, domains, event.url),
		total,
		tags,
		filters: options,
		archivedCount: archived,
		expiring: expiring.map((row) => ({
			id: row.id,
			slug: row.slug,
			expiresAt: row.expiresAt?.getTime() ?? null,
			maxClicks: row.maxClicks,
			clickCount: row.clickCount
		})),
		stats: {
			links: totals?.links ?? 0,
			clicks: totals?.clicks ?? 0,
			uniques: totals?.uniques ?? 0,
			conversions: totals?.conversions ?? 0,
			clicksThisWeek: week?.clicks ?? 0
		}
	};
};

export const actions: Actions = {
	create: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			const created = await createLink(
				env,
				event.locals.user!.id,
				parseLinkForm(form),
				event.platform?.ctx
			);
			return { created: { slug: created.slug, id: created.id } };
		} catch (error) {
			return failure(error);
		}
	},

	update: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		try {
			await updateLink(
				env,
				event.locals.user!.id,
				id,
				parseLinkForm(form, { partial: true }),
				event.platform?.ctx
			);
			return { updated: true };
		} catch (error) {
			return failure(error);
		}
	},

	toggle: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const enabled = form.get('enabled') === 'true';
		try {
			await updateLink(env, event.locals.user!.id, id, { enabled }, event.platform?.ctx);
			return { updated: true };
		} catch (error) {
			return failure(error);
		}
	},

	delete: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		try {
			await deleteLink(env, event.locals.user!.id, id, event.platform?.ctx);
			return { deleted: true };
		} catch (error) {
			return failure(error);
		}
	},

	/* --- bulk actions over the list's checkbox column --------------------- */

	bulkDelete: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			const removed = await deleteLinks(
				env,
				event.locals.user!.id,
				parseIds(form),
				event.platform?.ctx
			);
			return { bulk: { action: 'delete', count: removed } };
		} catch (error) {
			return failure(error);
		}
	},

	bulkArchive: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const archived = form.get('archived') !== 'false';
		try {
			const count = await archiveLinks(
				env,
				event.locals.user!.id,
				parseIds(form),
				archived,
				event.platform?.ctx
			);
			return { bulk: { action: archived ? 'archive' : 'restore', count } };
		} catch (error) {
			return failure(error);
		}
	},

	bulkTag: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const split = (name: string) =>
			String(form.get(name) ?? '')
				.split(',')
				.map((tag) => tag.trim())
				.filter(Boolean);
		try {
			const count = await tagLinks(env, event.locals.user!.id, parseIds(form), {
				add: split('add'),
				remove: split('remove')
			});
			return { bulk: { action: 'tag', count } };
		} catch (error) {
			return failure(error);
		}
	},

	bulkFolder: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const folderId = String(form.get('folderId') ?? '') || null;
		const ids = parseIds(form);
		try {
			for (const id of ids) {
				await updateLink(env, event.locals.user!.id, id, { folderId }, event.platform?.ctx);
			}
			return { bulk: { action: 'move', count: ids.length } };
		} catch (error) {
			return failure(error);
		}
	}
};

function failure(error: unknown) {
	if (error instanceof LinkError) {
		return fail(400, { message: error.message, field: error.field });
	}
	console.error(error);
	return fail(500, { message: 'Something went wrong. Try again.', field: null });
}
