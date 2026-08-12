import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, apiLink, requireApiUser } from '$lib/server/api';
import { LinkError, createLinks, type LinkInput } from '$lib/server/links';
import { domainsById } from '$lib/server/domains';
import { parseCsvObjects } from '$lib/csv';

/**
 * `POST /api/v1/links/import` — bulk import from CSV or JSON.
 *
 * Send `text/csv` with a header row, or JSON `{ links: [...] }`. Column names
 * are matched loosely (case, spaces and underscores are ignored) and the common
 * aliases other shorteners use are accepted, so a Bitly or Short.io export
 * usually imports without editing.
 */
const MAX_ROWS = 1000;

/** Header aliases, in priority order. First match wins. */
const FIELDS = {
	destination: ['destination', 'destinationurl', 'longurl', 'originalurl', 'url', 'target'],
	slug: ['slug', 'path', 'shortcode', 'keyword', 'alias', 'shorturlpath'],
	title: ['title', 'name'],
	description: ['description', 'notes', 'note'],
	tags: ['tags', 'tag', 'labels'],
	expiresAt: ['expiresat', 'expiry', 'expireson', 'expiration'],
	maxClicks: ['maxclicks', 'clicklimit'],
	fallbackUrl: ['fallbackurl', 'expiredurl', 'expiredredirect'],
	redirectStatus: ['redirectstatus', 'statuscode', 'httpstatus'],
	utmSource: ['utmsource'],
	utmMedium: ['utmmedium'],
	utmCampaign: ['utmcampaign'],
	utmTerm: ['utmterm'],
	utmContent: ['utmcontent']
} as const;

export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const contentType = event.request.headers.get('content-type') ?? '';
	const domainId = event.url.searchParams.get('domain') ?? undefined;

	let inputs: LinkInput[];

	if (contentType.includes('csv') || contentType.startsWith('text/plain')) {
		const rows = parseCsvObjects(await event.request.text());
		if (rows.length === 0) return apiError('No rows found. Is the header row present?');
		if (rows.length > MAX_ROWS) return apiError(`Import at most ${MAX_ROWS} rows at a time.`);
		inputs = rows.map(fromCsvRow);
	} else {
		let body: { links?: unknown };
		try {
			body = (await event.request.json()) as { links?: unknown };
		} catch {
			return apiError('Send text/csv, or JSON with a `links` array.');
		}
		const entries = Array.isArray(body.links) ? body.links : null;
		if (!entries) return apiError('`links` must be an array.', 400, 'links');
		if (entries.length > MAX_ROWS) return apiError(`Import at most ${MAX_ROWS} rows at a time.`);
		inputs = entries.map((entry) => fromCsvRow(entry as Record<string, string>));
	}

	const usable = inputs.filter((input) => input.destination);
	const skipped = inputs.length - usable.length;
	if (usable.length === 0) {
		return apiError('None of those rows had a destination URL.', 400, 'destination');
	}

	if (domainId) for (const input of usable) input.domainId = domainId;

	try {
		const created = await createLinks(auth.env, auth.userId, usable, auth.ctx);
		const domains = await domainsById(auth.env, auth.userId);
		return json(
			{
				imported: created.length,
				skipped,
				links: created.map((link) => apiLink(link, domains.get(link.domainId), event.url))
			},
			{ status: 201 }
		);
	} catch (error) {
		if (error instanceof LinkError) return apiError(error.message, 400, error.field);
		throw error;
	}
};

function fromCsvRow(row: Record<string, string>): LinkInput {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(row ?? {})) {
		normalized[key.toLowerCase().replace(/[\s_-]+/g, '')] = value == null ? '' : String(value);
	}

	const pick = (field: keyof typeof FIELDS): string | null => {
		for (const alias of FIELDS[field]) {
			const value = normalized[alias];
			if (value) return value;
		}
		return null;
	};

	const number = (field: keyof typeof FIELDS): number | null => {
		const value = pick(field);
		if (!value) return null;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	};

	const expiresAt = pick('expiresAt');
	const parsedExpiry = expiresAt ? Date.parse(expiresAt) : NaN;

	return {
		destination: pick('destination') ?? '',
		slug: pick('slug') ?? undefined,
		title: pick('title'),
		description: pick('description'),
		tags: (pick('tags') ?? '')
			.split(/[,;|\s]+/)
			.map((tag) => tag.trim())
			.filter(Boolean),
		expiresAt: Number.isNaN(parsedExpiry) ? null : parsedExpiry,
		maxClicks: number('maxClicks'),
		fallbackUrl: pick('fallbackUrl'),
		redirectStatus: number('redirectStatus') ?? 302,
		utmSource: pick('utmSource'),
		utmMedium: pick('utmMedium'),
		utmCampaign: pick('utmCampaign'),
		utmTerm: pick('utmTerm'),
		utmContent: pick('utmContent')
	};
}
