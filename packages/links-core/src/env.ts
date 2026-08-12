/**
 * Every binding and variable declared in `wrangler.jsonc`, plus the secrets set
 * with `wrangler secret put`.
 *
 * This is the union across both Workers that read the link store. The redirect
 * Worker binds only `DB`, `LINKS`, and `CLICKS_AE`; the rest are the
 * dashboard's, and are optional here so one interface can describe both.
 */
export interface Env {
	DB: D1Database;
	LINKS: KVNamespace;
	CLICKS_AE?: AnalyticsEngineDataset;
	ASSETS?: Fetcher;

	APP_URL?: string;
	SHORT_URL?: string;
	SHORT_HOSTS?: string;
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

/**
 * Hostnames dedicated entirely to short links. On these, every single-segment
 * path is a slug and nothing else is served — so they can be pointed at a
 * Worker route without shadowing whatever else lives on the zone.
 */
export function shortHosts(env: Env): string[] {
	return (env.SHORT_HOSTS ?? '')
		.split(',')
		.map((host) => host.trim().toLowerCase())
		.filter(Boolean);
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
