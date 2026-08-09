import { fail } from '@sveltejs/kit';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { getEnv, shortBase } from '$lib/server/env';
import { getDb } from '$lib/server/db';
import { click, link as linkTable } from '$lib/server/db/schema';
import {
	LinkError,
	allTags,
	createLink,
	deleteLink,
	listLinks,
	updateLink,
	type ListOptions
} from '$lib/server/links';
import { parseLinkForm } from '$lib/server/form';
import { serializeLink } from '$lib/server/serialize';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const userId = event.locals.user!.id;
	const params = event.url.searchParams;

	const options: ListOptions = {
		search: params.get('q') ?? undefined,
		tag: params.get('tag') ?? undefined,
		sort: (params.get('sort') as ListOptions['sort']) ?? 'recent',
		status: (params.get('status') as ListOptions['status']) ?? 'all'
	};

	const db = getDb(env);
	const weekAgo = new Date(Date.now() - 7 * 86_400_000);

	const [{ links, total }, tags, [totals], [week]] = await Promise.all([
		listLinks(env, userId, options),
		allTags(env, userId),
		db
			.select({
				links: sql<number>`count(*)`,
				clicks: sql<number>`coalesce(sum(${linkTable.clickCount}), 0)`,
				uniques: sql<number>`coalesce(sum(${linkTable.uniqueCount}), 0)`
			})
			.from(linkTable)
			.where(eq(linkTable.userId, userId)),
		db
			.select({ clicks: sql<number>`count(*)` })
			.from(click)
			.where(and(eq(click.userId, userId), gte(click.timestamp, weekAgo)))
	]);

	return {
		links: links.map(serializeLink),
		total,
		tags,
		filters: options,
		shortBase: shortBase(env, event.url),
		stats: {
			links: totals?.links ?? 0,
			clicks: totals?.clicks ?? 0,
			uniques: totals?.uniques ?? 0,
			clicksThisWeek: week?.clicks ?? 0
		}
	};
};

export const actions: Actions = {
	create: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			const created = await createLink(env, event.locals.user!.id, parseLinkForm(form));
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
			await updateLink(env, event.locals.user!.id, id, parseLinkForm(form, { partial: true }));
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
			await updateLink(env, event.locals.user!.id, id, { enabled });
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
			await deleteLink(env, event.locals.user!.id, id);
			return { deleted: true };
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
