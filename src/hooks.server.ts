import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { getEnv } from '$lib/server/env';
import { handleShortLink, isShortHost, matchShortLink } from '$lib/server/redirect';

/**
 * Request routing for the whole Worker.
 *
 * 1. Short-link hits are answered here and never reach the SvelteKit router —
 *    that keeps a redirect down to a KV read plus a `Response`.
 * 2. The short-link hostname serves nothing else, so the dashboard is not
 *    reachable from it.
 * 3. Everything else is the management app, with the session resolved once and
 *    put on `locals`.
 */
export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);

	const env = getEnv(event);

	const short = matchShortLink(event.url, env);
	if (short) return handleShortLink(event, short.slug);

	if (isShortHost(event.url, env)) {
		return new Response('Not found', {
			status: 404,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const auth = getAuth(env);
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.auth = auth;
	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;

	return svelteKitHandler({ event, resolve, auth, building });
};
