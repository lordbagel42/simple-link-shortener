import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getEnv, shortBase } from '$lib/server/env';
import { getAnalytics, recentClicks } from '$lib/server/analytics';
import { parseRange } from '$lib/types';
import { LinkError, deleteLink, getLink, updateLink } from '$lib/server/links';
import { parseLinkForm } from '$lib/server/form';
import { serializeLink } from '$lib/server/serialize';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const userId = event.locals.user!.id;
	const range = parseRange(event.url.searchParams.get('range'));

	const link = await getLink(env, userId, event.params.id);
	if (!link) error(404, 'Link not found');

	const [analytics, recent] = await Promise.all([
		getAnalytics(env, { userId, linkId: link.id }, range),
		recentClicks(env, { userId, linkId: link.id }, 50)
	]);

	return {
		link: serializeLink(link),
		analytics,
		recent,
		range,
		shortBase: shortBase(env, event.url)
	};
};

export const actions: Actions = {
	update: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			await updateLink(
				env,
				event.locals.user!.id,
				event.params.id,
				parseLinkForm(form, { partial: true })
			);
			return { updated: true };
		} catch (err) {
			if (err instanceof LinkError) return fail(400, { message: err.message, field: err.field });
			throw err;
		}
	},

	toggle: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			await updateLink(env, event.locals.user!.id, event.params.id, {
				enabled: form.get('enabled') === 'true'
			});
			return { updated: true };
		} catch (err) {
			if (err instanceof LinkError) return fail(400, { message: err.message, field: err.field });
			throw err;
		}
	},

	delete: async (event) => {
		const env = getEnv(event);
		await deleteLink(env, event.locals.user!.id, event.params.id);
		redirect(303, '/');
	}
};
