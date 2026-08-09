import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { getDb, schema } from './db';
import type { Env } from './env';
import { APIError } from 'better-auth/api';

function createAuth(env: Env) {
	if (!env.BETTER_AUTH_SECRET) {
		// Without a stable secret better-auth invents one per isolate, which signs
		// every session with a different key and logs people out at random.
		throw new Error(
			'BETTER_AUTH_SECRET is not set. Run `wrangler secret put BETTER_AUTH_SECRET` (or add it to .dev.vars for local development).'
		);
	}

	return betterAuth({
		appName: 'Links',
		database: drizzleAdapter(getDb(env), { provider: 'sqlite', schema }),
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.APP_URL,
		// The dashboard is served from its own hostname; short-link hosts never
		// see auth routes.
		trustedOrigins: env.APP_URL ? [env.APP_URL] : [],

		emailAndPassword: {
			enabled: true,
			minPasswordLength: 10,
			autoSignIn: true
		},

		socialProviders: socialProviders(env),

		session: {
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24,
			cookieCache: { enabled: true, maxAge: 5 * 60 }
		},

		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						assertSignupAllowed(env, user.email);
						return { data: user };
					}
				}
			}
		},

		plugins: [sveltekitCookies(getRequestEvent)]
	});
}

export type Auth = ReturnType<typeof createAuth>;

const cache = new WeakMap<Env, Auth>();

/**
 * better-auth instance for the current request's bindings.
 *
 * Workers hand us the environment per request rather than through
 * `process.env`, so the instance is built lazily and memoised per env object
 * (one per isolate in practice).
 */
export function getAuth(env: Env): Auth {
	const existing = cache.get(env);
	if (existing) return existing;

	const auth = createAuth(env);
	cache.set(env, auth);
	return auth;
}

function socialProviders(env: Env) {
	const providers: Record<string, { clientId: string; clientSecret: string }> = {};
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		providers.github = {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET
		};
	}
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		providers.google = {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET
		};
	}
	return providers;
}

/** Which social buttons the login page should render. */
export function enabledSocialProviders(env: Env): string[] {
	return Object.keys(socialProviders(env));
}

/**
 * A link shortener on your own domain is rarely meant to be open to the public,
 * so sign-up is gated by `SIGNUP_MODE` unless you opt out.
 */
function assertSignupAllowed(env: Env, email: string): void {
	const mode = (env.SIGNUP_MODE ?? 'invite').toLowerCase();
	if (mode === 'open') return;
	if (mode === 'closed') {
		throw new APIError('FORBIDDEN', { message: 'Sign-ups are disabled.' });
	}

	const allowlist = (env.SIGNUP_ALLOWLIST ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);

	const normalized = email.toLowerCase();
	const allowed = allowlist.some((entry) =>
		entry.startsWith('@') ? normalized.endsWith(entry) : normalized === entry
	);

	if (!allowed) {
		throw new APIError('FORBIDDEN', {
			message: 'This email is not on the invite list for this instance.'
		});
	}
}
