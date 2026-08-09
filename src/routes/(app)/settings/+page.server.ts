import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { appBase, getEnv, shortBase } from '$lib/server/env';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/api-keys';
import { resyncLinks } from '$lib/server/links';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const keys = await listApiKeys(env, event.locals.user!.id);

	return {
		keys: keys.map((key) => ({
			...key,
			lastUsedAt: key.lastUsedAt?.getTime() ?? null,
			expiresAt: key.expiresAt?.getTime() ?? null,
			createdAt: key.createdAt.getTime()
		})),
		instance: {
			shortBase: shortBase(env, event.url),
			appBase: appBase(env, event.url),
			signupMode: (env.SIGNUP_MODE ?? 'invite').toLowerCase(),
			analyticsEngine: Boolean(env.CLICKS_AE)
		}
	};
};

export const actions: Actions = {
	createKey: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Give the key a name.' });

		const { token } = await createApiKey(env, event.locals.user!.id, name);
		// The only time the plaintext token is ever available.
		return { token };
	},

	revokeKey: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		await revokeApiKey(env, event.locals.user!.id, String(form.get('id') ?? ''));
		return { revoked: true };
	},

	resync: async (event) => {
		const env = getEnv(event);
		const count = await resyncLinks(env, event.locals.user!.id);
		return { resynced: count };
	}
};
