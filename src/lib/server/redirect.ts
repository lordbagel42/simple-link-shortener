/**
 * Short-link handling for the dashboard host.
 *
 * The resolution itself lives in `@lordbagel42/links-core`, which the dedicated
 * redirect Worker (`lordbagel42/links-agent`) also calls. This module is only
 * the SvelteKit adapter around it, used in development and for the
 * `links.raygen.dev/l/*` fallback — production short links never reach here.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { resolveShortLink } from '@lordbagel42/links-core';
import { getEnv } from './env';

export type { RedirectContext } from '@lordbagel42/links-core';
export {
	matchShortLink,
	isShortHost,
	notFoundResponse,
	resolveShortLink
} from '@lordbagel42/links-core';

export function handleShortLink(event: RequestEvent, slug: string): Promise<Response> {
	return resolveShortLink(slug, {
		request: event.request,
		url: event.url,
		env: getEnv(event),
		ctx: event.platform?.ctx,
		cf: event.platform?.cf as Record<string, unknown> | undefined
	});
}
