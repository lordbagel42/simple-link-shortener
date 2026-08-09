import type { PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import { getAnalytics, recentClicks } from '$lib/server/analytics';
import { parseRange } from '$lib/types';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const userId = event.locals.user!.id;
	const range = parseRange(event.url.searchParams.get('range'));

	const [analytics, recent] = await Promise.all([
		getAnalytics(env, { userId }, range),
		recentClicks(env, { userId }, 50)
	]);

	return { analytics, recent, range };
};
