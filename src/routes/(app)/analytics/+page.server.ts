import type { PageServerLoad } from './$types';
import { getEnv } from '$lib/server/env';
import {
	getAnalytics,
	parseScope,
	recentClicks,
	resolveWindow,
	topLinks
} from '$lib/server/analytics';
import { listConversions } from '$lib/server/conversions';
import { serializeConversion } from '$lib/server/serialize';

export const load: PageServerLoad = async (event) => {
	const env = getEnv(event);
	const userId = event.locals.user!.id;
	const scope = parseScope(event.url.searchParams, userId);
	const window = resolveWindow(event.url.searchParams);

	const [analytics, recent, top, conversions] = await Promise.all([
		getAnalytics(env, scope, window),
		recentClicks(env, scope, 60),
		topLinks(env, scope, window, 10),
		listConversions(
			env,
			{ userId },
			{ from: window.from === null ? null : new Date(window.from), to: new Date(window.to) },
			20
		)
	]);

	return {
		analytics,
		recent,
		topLinks: top,
		conversions: conversions.map(serializeConversion),
		scope: { bots: scope.bots ?? 'all', domainId: scope.domainId ?? null }
	};
};
