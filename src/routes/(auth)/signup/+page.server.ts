import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { enabledSocialProviders, getAuth } from '$lib/server/auth';
import { getEnv } from '$lib/server/env';
import { APIError } from 'better-auth/api';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) redirect(303, '/');
	const env = getEnv(event);
	const mode = (env.SIGNUP_MODE ?? 'invite').toLowerCase();
	if (mode === 'closed') redirect(303, '/login');

	return { providers: enabledSocialProviders(env), signupMode: mode };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		const values = { name, email };
		if (!name || !email || !password) {
			return fail(400, { ...values, message: 'Fill in every field.' });
		}
		if (password.length < 10) {
			return fail(400, { ...values, message: 'Use at least 10 characters for your password.' });
		}

		const auth = getAuth(getEnv(event));
		try {
			await auth.api.signUpEmail({
				body: { name, email, password },
				headers: event.request.headers
			});
		} catch (error) {
			const message =
				error instanceof APIError
					? (error.body?.message ?? 'Could not create your account.')
					: 'Something went wrong creating your account.';
			return fail(400, { ...values, message });
		}

		redirect(303, '/');
	}
};
