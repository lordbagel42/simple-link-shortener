import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { enabledSocialProviders, getAuth } from '$lib/server/auth';
import { getEnv } from '$lib/server/env';
import { APIError } from 'better-auth/api';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) redirect(303, '/');
	const env = getEnv(event);
	return {
		providers: enabledSocialProviders(env),
		signupMode: (env.SIGNUP_MODE ?? 'invite').toLowerCase()
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { email, message: 'Enter your email and password.' });
		}

		const auth = getAuth(getEnv(event));
		try {
			await auth.api.signInEmail({
				body: { email, password },
				headers: event.request.headers
			});
		} catch (error) {
			const message =
				error instanceof APIError
					? (error.body?.message ?? 'Invalid email or password.')
					: 'Something went wrong signing you in.';
			return fail(400, { email, message });
		}

		redirect(303, '/');
	}
};
