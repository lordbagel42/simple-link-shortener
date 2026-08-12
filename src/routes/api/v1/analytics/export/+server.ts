import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/api';
import { exportClicksCsv, parseScope, resolveWindow } from '$lib/server/analytics';

/**
 * `GET /api/v1/analytics/export` — every click in the window as CSV.
 *
 * All 88 columns, nothing aggregated and nothing withheld — including the raw
 * IP and user agent. Same scope and window parameters as `/api/v1/analytics`.
 */
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const params = event.url.searchParams;
	return exportClicksCsv(
		auth.env,
		parseScope(params, auth.userId, params.get('link') ?? undefined),
		resolveWindow(params)
	);
};
