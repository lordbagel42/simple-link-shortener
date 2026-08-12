import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/api';
import {
	getAnalytics,
	parseScope,
	recentClicks,
	resolveWindow,
	topLinks
} from '$lib/server/analytics';

/**
 * `GET /api/v1/analytics` — the whole summary for a window.
 *
 * Scope with `link`, `domain` or `folder`; window with `range=<preset>` or
 * `from`/`to`; bucket with `interval`. `bots=exclude|only` filters automated
 * traffic, and `include=clicks,top` adds the raw event feed and the per-link
 * rollup to the same response.
 */
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const params = event.url.searchParams;
	const scope = parseScope(params, auth.userId, params.get('link') ?? undefined);
	const window = resolveWindow(params);
	const include = new Set((params.get('include') ?? '').split(',').map((part) => part.trim()));

	const [summary, clicks, top] = await Promise.all([
		getAnalytics(auth.env, scope, window),
		include.has('clicks')
			? recentClicks(auth.env, scope, Math.min(Number(params.get('limit')) || 50, 500))
			: Promise.resolve(null),
		include.has('top') ? topLinks(auth.env, scope, window) : Promise.resolve(null)
	]);

	return json({
		...summary,
		...(clicks ? { clicks } : {}),
		...(top ? { topLinks: top } : {})
	});
};
