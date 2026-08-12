import { json, type RequestEvent } from '@sveltejs/kit';
import { getEnv, type Env, type WaitUntil } from './env';
import { userIdFromApiKey } from './api-keys';
import { shortUrlForDomain } from './domains';
import type { Domain, Link } from './db/schema';
import type { LinkInput } from './links';

/**
 * Authenticate an API request with either a dashboard session cookie or an
 * `Authorization: Bearer lnk_…` API key.
 */
export async function requireApiUser(
	event: RequestEvent
): Promise<{ env: Env; userId: string; ctx?: WaitUntil } | Response> {
	const env = getEnv(event);
	const ctx = event.platform?.ctx;

	if (event.locals.user) return { env, userId: event.locals.user.id, ctx };

	const userId = await userIdFromApiKey(env, event.request, ctx);
	if (!userId) {
		return json(
			{ error: 'unauthorized', message: 'Provide a valid API key as a Bearer token.' },
			{ status: 401, headers: { 'www-authenticate': 'Bearer' } }
		);
	}
	return { env, userId, ctx };
}

export function apiLink(
	link: Link,
	domain: Pick<Domain, 'hostname' | 'prefix'> | undefined,
	requestUrl?: URL
) {
	return {
		id: link.id,
		slug: link.slug,
		shortUrl: domain ? shortUrlForDomain(domain, link.slug, requestUrl) : null,
		domainId: link.domainId,
		domain: domain?.hostname ?? null,
		folderId: link.folderId,
		destination: link.destination,
		title: link.title,
		description: link.description,
		tags: link.tags,
		enabled: link.enabled,
		archived: link.archived,
		hasPassword: Boolean(link.passwordHash),
		expiresAt: link.expiresAt?.toISOString() ?? null,
		maxClicks: link.maxClicks,
		fallbackUrl: link.fallbackUrl,
		forwardQuery: link.forwardQuery,
		redirectStatus: link.redirectStatus,
		rules: link.rules,
		variants: link.variants,
		deepLink: link.deepLink,
		cloak: link.cloak,
		hideReferrer: link.hideReferrer,
		trackConversions: link.trackConversions,
		qrOptions: link.qrOptions,
		utm: {
			source: link.utmSource,
			medium: link.utmMedium,
			campaign: link.utmCampaign,
			term: link.utmTerm,
			content: link.utmContent
		},
		clickCount: link.clickCount,
		uniqueCount: link.uniqueCount,
		conversionCount: link.conversionCount,
		conversionValue: link.conversionValue,
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

/**
 * Map a JSON body onto a `LinkInput`.
 *
 * `mode: 'create'` fills in defaults for anything absent; `mode: 'patch'` only
 * touches keys the caller actually sent, so `PATCH` never clears a field by
 * omission.
 */
export function linkInputFrom(
	body: Record<string, unknown>,
	mode: 'create' | 'patch'
): LinkInput {
	const creating = mode === 'create';
	const input: Partial<LinkInput> = {};
	const present = (key: string) => creating || key in body;

	if (creating || 'destination' in body) input.destination = String(body.destination ?? '');
	if ('slug' in body) input.slug = body.slug ? String(body.slug) : undefined;
	if ('domainId' in body) input.domainId = body.domainId == null ? null : String(body.domainId);
	if ('folderId' in body) input.folderId = body.folderId == null ? null : String(body.folderId);
	if (present('title')) input.title = body.title == null ? null : String(body.title);
	if (present('description')) {
		input.description = body.description == null ? null : String(body.description);
	}
	if (present('tags')) input.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
	if (present('enabled')) input.enabled = body.enabled === undefined ? true : Boolean(body.enabled);
	if ('archived' in body) input.archived = Boolean(body.archived);
	if ('password' in body) input.password = body.password == null ? null : String(body.password);
	if (present('expiresAt')) input.expiresAt = parseTimestamp(body.expiresAt);
	if (present('maxClicks')) {
		input.maxClicks = body.maxClicks == null ? null : Number(body.maxClicks);
	}
	if (present('fallbackUrl')) {
		input.fallbackUrl = body.fallbackUrl == null ? null : String(body.fallbackUrl);
	}
	if (present('forwardQuery')) input.forwardQuery = Boolean(body.forwardQuery);
	if (present('hideReferrer')) input.hideReferrer = Boolean(body.hideReferrer);
	if (present('trackConversions')) input.trackConversions = Boolean(body.trackConversions);
	if ('redirectStatus' in body) input.redirectStatus = Number(body.redirectStatus);
	if (present('rules')) input.rules = Array.isArray(body.rules) ? (body.rules as never) : [];
	if (present('variants')) {
		input.variants = Array.isArray(body.variants) ? (body.variants as never) : [];
	}
	if ('deepLink' in body) input.deepLink = (body.deepLink ?? null) as never;
	if ('cloak' in body) input.cloak = (body.cloak ?? null) as never;
	if ('qrOptions' in body) input.qrOptions = (body.qrOptions ?? null) as never;
	if ('utm' in body || creating) Object.assign(input, utmFrom(body));

	return input as LinkInput;
}

/** `POST` bodies that must be a JSON object, with one shared error message. */
export async function readJson(
	request: Request
): Promise<Record<string, unknown> | Response> {
	try {
		const body = await request.json();
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			return apiError('Request body must be a JSON object.');
		}
		return body as Record<string, unknown>;
	} catch {
		return apiError('Request body must be JSON.');
	}
}

export function stringIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(String).filter(Boolean))].slice(0, 1000);
}
