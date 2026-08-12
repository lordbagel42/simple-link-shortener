import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, readJson, requireApiUser } from '$lib/server/api';
import { ConversionError, listConversions, recordConversion } from '$lib/server/conversions';
import { resolveWindow } from '$lib/server/analytics';
import { serializeConversion } from '$lib/server/serialize';

/**
 * `POST /api/v1/conversions` — report an outcome back from the destination.
 *
 * The destination site keeps the `clid` query parameter the redirect added and
 * posts it here when the visitor converts. Attribution is exact rather than
 * modelled: `clid` is the click's own id, so every dimension already on that
 * click — country, device, referrer, A/B arm — carries over.
 */
export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const created = await recordConversion(
			auth.env,
			auth.userId,
			{
				clid: body.clid == null ? null : String(body.clid),
				linkId: body.linkId == null ? null : String(body.linkId),
				event: body.event == null ? null : String(body.event),
				value: body.value == null ? null : Number(body.value),
				currency: body.currency == null ? null : String(body.currency),
				metadata:
					body.metadata && typeof body.metadata === 'object'
						? (body.metadata as Record<string, unknown>)
						: null,
				timestamp: body.timestamp == null ? null : Number(body.timestamp)
			},
			auth.ctx
		);
		return json(serializeConversion(created), { status: 201 });
	} catch (error) {
		if (error instanceof ConversionError) return apiError(error.message, 400, error.field);
		throw error;
	}
};

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const window = resolveWindow(event.url.searchParams);
	const rows = await listConversions(
		auth.env,
		{ userId: auth.userId, linkId: event.url.searchParams.get('link') ?? undefined },
		{ from: window.from === null ? null : new Date(window.from), to: new Date(window.to) },
		Math.min(Number(event.url.searchParams.get('limit')) || 50, 500)
	);

	return json({ window, conversions: rows.map(serializeConversion) });
};
