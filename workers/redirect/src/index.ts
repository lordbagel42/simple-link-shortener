import { matchShortLink, notFoundResponse, resolveShortLink } from '../../../src/lib/server/redirect';
import { appBase } from '../../../src/lib/server/env';
import type { Env } from '../../../src/lib/server/env';

/**
 * The redirect Worker.
 *
 * This exists purely so short links never pay for the dashboard. It has no
 * SvelteKit, no better-auth, no static assets, and — deliberately — no Smart
 * Placement, so it runs in the Cloudflare colo nearest the visitor rather than
 * near D1. A redirect is one KV read and a 302; the click write happens in
 * `waitUntil` after the response is already on its way.
 *
 * The dashboard Worker at the repository root still contains the same matching
 * logic for local development and for `links.raygen.dev/l/*`, and both import
 * it from `src/lib/server/redirect.ts` so the two can never drift.
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Health checks are answered before slug matching, so they cannot be
		// swallowed as a slug on a dedicated short host.
		if (url.pathname === '/healthz') {
			return new Response('ok', { headers: { 'content-type': 'text/plain' } });
		}

		const match = matchShortLink(url, env);
		if (match) {
			return resolveShortLink(match.slug, {
				request,
				url,
				env,
				ctx,
				cf: request.cf as unknown as Record<string, unknown> | undefined
			});
		}

		// The bare short domain is a friendlier door to the dashboard than a 404.
		if (url.pathname === '/' && env.APP_URL) {
			return Response.redirect(appBase(env, url), 302);
		}

		return notFoundResponse();
	}
} satisfies ExportedHandler<Env>;
