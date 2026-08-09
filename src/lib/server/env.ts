import type { RequestEvent } from '@sveltejs/kit';

/**
 * Every binding and variable declared in `wrangler.jsonc`, plus the secrets set
 * with `wrangler secret put`.
 */
export interface Env {
	DB: D1Database;
	LINKS: KVNamespace;
	CLICKS_AE?: AnalyticsEngineDataset;
	ASSETS?: Fetcher;

	APP_URL?: string;
	SHORT_URL?: string;
	SHORT_HOST?: string;
	SHORT_PREFIX?: string;
	SIGNUP_MODE?: string;
	SIGNUP_ALLOWLIST?: string;

	BETTER_AUTH_SECRET?: string;
	VISITOR_HASH_SALT?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
}

/**
 * Structural stand-in for `ExecutionContext`. The adapter and the generated
 * runtime types ship slightly different versions of that interface, and
 * `waitUntil` is the only part any of this code needs.
 */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export function getEnv(event: Pick<RequestEvent, 'platform'>): Env {
	const env = event.platform?.env as Env | undefined;
	if (!env) {
		throw new Error(
			'Cloudflare bindings are unavailable. Run `npm run dev` (Vite emulates them from wrangler.jsonc) or `npm run preview`.'
		);
	}
	return env;
}

/** Normalised short-link prefix: always starts with `/`, never ends with one. */
export function shortPrefix(env: Env): string {
	const raw = (env.SHORT_PREFIX ?? '/l').trim();
	if (raw === '' || raw === '/') return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

/** Absolute base a short link is built on, e.g. `https://raygen.dev/l`. */
export function shortBase(env: Env, url: URL): string {
	if (env.SHORT_URL) return env.SHORT_URL.replace(/\/+$/, '');
	return `${url.origin}${shortPrefix(env)}`;
}

export function shortUrlFor(env: Env, url: URL, slug: string): string {
	return `${shortBase(env, url)}/${slug}`;
}

/** Absolute base of the management dashboard. */
export function appBase(env: Env, url: URL): string {
	return (env.APP_URL ?? url.origin).replace(/\/+$/, '');
}
