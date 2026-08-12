/**
 * The app's view of the Worker environment.
 *
 * The `Env` shape and the URL helpers are shared with the redirect Worker and
 * live in `@lordbagel42/links-core`. Only `getEnv` stays here: it is the one
 * piece that knows about SvelteKit's `RequestEvent`.
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { Env } from '@lordbagel42/links-core';

export type { Env, WaitUntil } from '@lordbagel42/links-core';
export { shortHosts, shortPrefix, shortBase, shortUrlFor, appBase } from '@lordbagel42/links-core';

export function getEnv(event: Pick<RequestEvent, 'platform'>): Env {
	const env = event.platform?.env as Env | undefined;
	if (!env) {
		throw new Error(
			'Cloudflare bindings are unavailable. Run `npm run dev` (Vite emulates them from wrangler.jsonc) or `npm run preview`.'
		);
	}
	return env;
}
