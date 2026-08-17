import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { getAuthenticatorName } from '@better-auth/passkey';
import type { Actions, PageServerLoad } from './$types';
import { appBase, getEnv, shortBase } from '$lib/server/env';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/api-keys';
import { resyncLinks } from '$lib/server/links';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const keys = await listApiKeys(env, event.locals.user!.id);
	// Scoped to the session's own user by the endpoint, not by us.
	const passkeys = await event.locals.auth.api.listPasskeys({ headers: event.request.headers });

	return {
		keys: keys.map((key) => ({
			...key,
			lastUsedAt: key.lastUsedAt?.getTime() ?? null,
			expiresAt: key.expiresAt?.getTime() ?? null,
			createdAt: key.createdAt.getTime()
		})),
		passkeys: passkeys.map((key) => ({
			id: key.id,
			// An unnamed passkey is labelled by its authenticator model where the
			// AAGUID is one we recognise. Most platforms report an all-zero one.
			name: key.name?.trim() || getAuthenticatorName(key.aaguid) || 'Passkey',
			named: Boolean(key.name?.trim()),
			/** Synced to a provider, so it survives losing the device. */
			backedUp: key.backedUp,
			createdAt: new Date(key.createdAt).getTime()
		})),
		instance: {
			shortBase: shortBase(env, event.url),
			appBase: appBase(env, event.url),
			signupMode: (env.SIGNUP_MODE ?? 'invite').toLowerCase(),
			analyticsEngine: Boolean(env.CLICKS_AE)
		}
	};
};

function passkeyErrorMessage(error: unknown, fallback: string): string {
	return error instanceof APIError ? (error.body?.message ?? fallback) : fallback;
}

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

	/**
	 * Registering a passkey is a WebAuthn ceremony and can only happen in the
	 * browser; renaming and deleting are ordinary writes, so they go through
	 * better-auth's endpoints here and keep working without JS.
	 */
	renamePasskey: async (event) => {
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { passkeyMessage: 'Give the passkey a name.' });

		try {
			await event.locals.auth.api.updatePasskey({
				body: { id: String(form.get('id') ?? ''), name },
				headers: event.request.headers
			});
		} catch (error) {
			return fail(400, { passkeyMessage: passkeyErrorMessage(error, 'Could not rename it.') });
		}

		return { renamed: true };
	},

	deletePasskey: async (event) => {
		const form = await event.request.formData();

		try {
			await event.locals.auth.api.deletePasskey({
				body: { id: String(form.get('id') ?? '') },
				headers: event.request.headers
			});
		} catch (error) {
			return fail(400, { passkeyMessage: passkeyErrorMessage(error, 'Could not remove it.') });
		}

		return { deleted: true };
	},

	resync: async (event) => {
		const env = getEnv(event);
		const count = await resyncLinks(env, event.locals.user!.id);
		return { resynced: count };
	}
};
