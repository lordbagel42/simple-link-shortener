import type { getAuth } from '$lib/server/auth';
import type { Env } from '$lib/server/env';

type Auth = ReturnType<typeof getAuth>;
type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

declare global {
	namespace App {
		interface Locals {
			auth: Auth;
			session: AuthSession['session'] | null;
			user: AuthSession['user'] | null;
		}
		interface Platform {
			env: Env;
		}
	}
}

export {};
