import { json, type RequestEvent } from '@sveltejs/kit';
import { getEnv, shortUrlFor, type Env } from './env';
import { userIdFromApiKey } from './api-keys';
import type { Link } from './db/schema';

/**
 * Authenticate an API request with either a dashboard session cookie or an
 * `Authorization: Bearer lnk_…` API key.
 */
export async function requireApiUser(
	event: RequestEvent
): Promise<{ env: Env; userId: string } | Response> {
	const env = getEnv(event);

	if (event.locals.user) return { env, userId: event.locals.user.id };

	const userId = await userIdFromApiKey(env, event.request, event.platform?.ctx);
	if (!userId) {
		return json(
			{ error: 'unauthorized', message: 'Provide a valid API key as a Bearer token.' },
			{ status: 401, headers: { 'www-authenticate': 'Bearer' } }
		);
	}
	return { env, userId };
}

export function apiLink(link: Link, env: Env, url: URL) {
	return {
		id: link.id,
		slug: link.slug,
		shortUrl: shortUrlFor(env, url, link.slug),
		destination: link.destination,
		title: link.title,
		description: link.description,
		tags: link.tags,
		enabled: link.enabled,
		hasPassword: Boolean(link.passwordHash),
		expiresAt: link.expiresAt?.toISOString() ?? null,
		maxClicks: link.maxClicks,
		fallbackUrl: link.fallbackUrl,
		forwardQuery: link.forwardQuery,
		redirectStatus: link.redirectStatus,
		rules: link.rules,
		utm: {
			source: link.utmSource,
			medium: link.utmMedium,
			campaign: link.utmCampaign,
			term: link.utmTerm,
			content: link.utmContent
		},
		clickCount: link.clickCount,
		uniqueCount: link.uniqueCount,
		lastClickedAt: link.lastClickedAt?.toISOString() ?? null,
		createdAt: link.createdAt.toISOString(),
		updatedAt: link.updatedAt.toISOString()
	};
}

export function apiError(message: string, status = 400, field: string | null = null) {
	return json({ error: 'invalid_request', message, field }, { status });
}

/** Accepts either epoch ms or anything `Date.parse` understands. */
export function parseTimestamp(value: unknown): number | null {
	if (value == null) return null;
	const parsed = typeof value === 'number' ? value : Date.parse(String(value));
	return Number.isFinite(parsed) ? parsed : null;
}

/** Flattens the API's nested `utm` object onto the column names. */
export function utmFrom(body: Record<string, unknown>) {
	const utm = (body.utm ?? {}) as Record<string, unknown>;
	const pick = (key: string) => (utm[key] == null ? null : String(utm[key]));
	return {
		utmSource: pick('source'),
		utmMedium: pick('medium'),
		utmCampaign: pick('campaign'),
		utmTerm: pick('term'),
		utmContent: pick('content')
	};
}
