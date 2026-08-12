import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { appBase, getEnv, shortBase } from '$lib/server/env';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/api-keys';
import { resyncLinks } from '$lib/server/links';
import { DomainError, createDomain, deleteDomain, updateDomain } from '$lib/server/domains';
import { FolderError, createFolder, deleteFolder, updateFolder } from '$lib/server/folders';
import {
	WebhookError,
	createWebhook,
	deleteWebhook,
	listWebhooks,
	recentDeliveries,
	test,
	updateWebhook
} from '$lib/server/webhooks';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const userId = event.locals.user!.id;

	const [keys, hooks, deliveries] = await Promise.all([
		listApiKeys(env, userId),
		listWebhooks(env, userId),
		recentDeliveries(env, userId, 15)
	]);

	return {
		keys: keys.map((key) => ({
			...key,
			lastUsedAt: key.lastUsedAt?.getTime() ?? null,
			expiresAt: key.expiresAt?.getTime() ?? null,
			createdAt: key.createdAt.getTime()
		})),
		webhooks: hooks.map((hook) => ({
			id: hook.id,
			url: hook.url,
			description: hook.description,
			events: hook.events,
			enabled: hook.enabled,
			lastStatus: hook.lastStatus,
			lastFiredAt: hook.lastFiredAt?.getTime() ?? null,
			failureCount: hook.failureCount,
			createdAt: hook.createdAt.getTime()
		})),
		deliveries: deliveries.map((row) => ({
			id: row.id,
			webhookId: row.webhookId,
			event: row.event,
			status: row.status,
			error: row.error,
			durationMs: row.durationMs,
			timestamp: row.timestamp.getTime()
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
	/* --- API keys --------------------------------------------------------- */

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
	},

	/* --- domains ---------------------------------------------------------- */

	createDomain: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			await createDomain(env, event.locals.user!.id, {
				hostname: String(form.get('hostname') ?? ''),
				label: String(form.get('label') ?? ''),
				prefix: String(form.get('prefix') ?? ''),
				isDefault: form.get('isDefault') === 'true'
			});
			return { domainSaved: true };
		} catch (error) {
			return failure(error);
		}
	},

	updateDomain: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		const number = (name: string) => {
			const raw = String(form.get(name) ?? '').trim();
			return raw ? Number(raw) : undefined;
		};
		try {
			await updateDomain(env, event.locals.user!.id, String(form.get('id') ?? ''), {
				hostname: String(form.get('hostname') ?? ''),
				label: String(form.get('label') ?? ''),
				prefix: String(form.get('prefix') ?? ''),
				slugLength: number('slugLength'),
				redirectStatus: number('redirectStatus'),
				mainRedirect: String(form.get('mainRedirect') ?? ''),
				notFoundRedirect: String(form.get('notFoundRedirect') ?? ''),
				expiredRedirect: String(form.get('expiredRedirect') ?? ''),
				isDefault: form.get('isDefault') === 'true'
			});
			return { domainSaved: true };
		} catch (error) {
			return failure(error);
		}
	},

	deleteDomain: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			const removed = await deleteDomain(env, event.locals.user!.id, String(form.get('id') ?? ''));
			return { domainDeleted: removed };
		} catch (error) {
			return failure(error);
		}
	},

	/* --- folders ---------------------------------------------------------- */

	createFolder: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			await createFolder(env, event.locals.user!.id, {
				name: String(form.get('name') ?? ''),
				color: String(form.get('color') ?? 'slate')
			});
			return { folderSaved: true };
		} catch (error) {
			return failure(error);
		}
	},

	updateFolder: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			await updateFolder(env, event.locals.user!.id, String(form.get('id') ?? ''), {
				name: String(form.get('name') ?? ''),
				color: String(form.get('color') ?? 'slate')
			});
			return { folderSaved: true };
		} catch (error) {
			return failure(error);
		}
	},

	deleteFolder: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			await deleteFolder(env, event.locals.user!.id, String(form.get('id') ?? ''));
			return { folderDeleted: true };
		} catch (error) {
			return failure(error);
		}
	},

	/* --- webhooks --------------------------------------------------------- */

	createWebhook: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			const created = await createWebhook(env, event.locals.user!.id, {
				url: String(form.get('url') ?? ''),
				description: String(form.get('description') ?? ''),
				events: form.getAll('events').map(String)
			});
			// Shown once, then never again.
			return { webhookSecret: created.secret };
		} catch (error) {
			return failure(error);
		}
	},

	updateWebhook: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			await updateWebhook(env, event.locals.user!.id, String(form.get('id') ?? ''), {
				url: String(form.get('url') ?? ''),
				description: String(form.get('description') ?? ''),
				events: form.getAll('events').map(String),
				enabled: form.get('enabled') === 'true'
			});
			return { webhookSaved: true };
		} catch (error) {
			return failure(error);
		}
	},

	testWebhook: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		try {
			const status = await test(env, event.locals.user!.id, String(form.get('id') ?? ''));
			return { webhookTest: { status, ok: status !== null && status < 400 } };
		} catch (error) {
			return failure(error);
		}
	},

	deleteWebhook: async (event) => {
		const env = getEnv(event);
		const form = await event.request.formData();
		await deleteWebhook(env, event.locals.user!.id, String(form.get('id') ?? ''));
		return { webhookDeleted: true };
	}
};

function failure(error: unknown) {
	if (error instanceof DomainError || error instanceof FolderError || error instanceof WebhookError) {
		return fail(400, { message: error.message, field: error.field ?? null });
	}
	console.error(error);
	return fail(500, { message: 'Something went wrong. Try again.', field: null });
}
