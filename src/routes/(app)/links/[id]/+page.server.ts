import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { getAnalytics, parseScope, recentClicks, resolveWindow } from '$lib/server/analytics';
import { LinkError, archiveLinks, deleteLink, getLink, updateLink } from '$lib/server/links';
import { parseLinkForm } from '$lib/server/form';
import { serializeConversion, serializeLink } from '$lib/server/serialize';
import { getDomain } from '$lib/server/domains';
import { listConversions } from '$lib/server/conversions';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const userId = event.locals.user!.id;

	const link = await getLink(env, userId, event.params.id);
	if (!link) error(404, 'Link not found');

	const domain = await getDomain(env, userId, link.domainId);
	if (!domain) error(500, 'This link points at a domain that no longer exists.');

	const scope = parseScope(event.url.searchParams, userId, link.id);
	const window = resolveWindow(event.url.searchParams);

	const [analytics, recent, conversions] = await Promise.all([
		getAnalytics(env, scope, window),
		recentClicks(env, scope, 60),
		listConversions(
			env,
			{ userId, linkId: link.id },
			{ from: window.from === null ? null : new Date(window.from), to: new Date(window.to) },
			20
		)
	]);

	return {
		link: serializeLink(link, domain, event.url),
		analytics,
		recent,
		conversions: conversions.map(serializeConversion),
		scope: { bots: scope.bots ?? 'all' }
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
				parseLinkForm(form, { partial: true }),
				event.platform?.ctx
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
			await updateLink(
				env,
				event.locals.user!.id,
				event.params.id,
				{ enabled: form.get('enabled') === 'true' },
				event.platform?.ctx
			);
			return { updated: true };
		} catch (err) {
			if (err instanceof LinkError) return fail(400, { message: err.message, field: err.field });
			throw err;
		}
	},

	archive: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const archived = form.get('archived') !== 'false';
		await archiveLinks(
			env,
			event.locals.user!.id,
			[event.params.id],
			archived,
			event.platform?.ctx
		);
		return { archived };
	},

	delete: async (event) => {
		const env = getEnv(event);
		await deleteLink(env, event.locals.user!.id, event.params.id, event.platform?.ctx);
		redirect(303, '/');
	}
};
