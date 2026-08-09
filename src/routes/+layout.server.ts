import type { LayoutServerLoad } from './$types';
import { appBase, getEnv, shortBase } from '$lib/server/env';

export const load: LayoutServerLoad = async (event) => {
	const env = getEnv(event);

	return {
		user: event.locals.user
			? {
					id: event.locals.user.id,
					name: event.locals.user.name,
					email: event.locals.user.email,
					image: event.locals.user.image ?? null
				}
			: null,
		shortBase: shortBase(env, event.url),
		appBase: appBase(env, event.url)
	};
};
