/** Slug rules shared by the server and the browser so validation matches. */

import { isPattern } from '@lordbagel42/links-core';

/** No vowels or lookalikes — generated slugs stay unambiguous and unoffensive. */
const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,63}$/;

/** `:form` in `f/:form`. */
const PLACEHOLDER_PATTERN = /^:[A-Za-z_][A-Za-z0-9_-]*$/;

/** A link answers to at most this many slugs, each of which is a KV key. */
export const MAX_SLUGS_PER_LINK = 20;

/**
 * Paths the dashboard and the redirect worker need for themselves. Blocked even
 * when short links are served from the root of a host.
 */
export const RESERVED_SLUGS = new Set([
	'api',
	'_app',
	'favicon.ico',
	'robots.txt',
	'sitemap.xml',
	'login',
	'signup',
	'signout',
	'settings',
	'links',
	'analytics',
	'admin',
	'dashboard',
	'health'
]);

export function generateSlug(length = 7): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let slug = '';
	for (const byte of bytes) slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
	return slug;
}

export function validateSlug(slug: string): string | null {
	if (!slug) return 'Slug is required.';
	if (!SLUG_PATTERN.test(slug)) {
		return 'Use 1–64 characters: letters, numbers, and . _ ~ - (must start with a letter or number).';
	}
	if (RESERVED_SLUGS.has(slug.toLowerCase())) return `"${slug}" is reserved.`;
	return null;
}

/**
 * A pattern slug: `f/:form`, `docs/*`. Matched against the request path rather
 * than looked up by key, with whatever it captures interpolated back into the
 * destination.
 *
 * The first segment has to be a literal, and there has to be a second segment.
 * That is what keeps ordinary one-segment links off the pattern path entirely —
 * no pattern can ever shadow a plain slug.
 */
export function validatePattern(pattern: string): string | null {
	const parts = pattern.split('/');
	if (parts.length < 2) {
		return 'A pattern needs at least two segments, e.g. f/:form.';
	}
	if (parts.some((part) => part === '')) {
		return 'Patterns cannot contain an empty segment or a leading/trailing slash.';
	}

	const [first, ...rest] = parts;
	if (first.startsWith(':') || first === '*') {
		return 'The first segment must be literal text, e.g. f/:form rather than :form.';
	}
	const firstError = validateSlug(first);
	if (firstError) return firstError;

	for (const [index, part] of rest.entries()) {
		if (part === '*') {
			if (index !== rest.length - 1) return '* has to be the last segment.';
			continue;
		}
		if (part.startsWith(':')) {
			if (!PLACEHOLDER_PATTERN.test(part)) {
				return `"${part}" is not a valid placeholder. Use :name — letters, numbers, _ and -.`;
			}
			continue;
		}
		if (!SLUG_PATTERN.test(part)) {
			return `"${part}" is not a valid path segment.`;
		}
	}

	return null;
}

/** Whichever of the two shapes the value is. */
export function validateSlugOrPattern(value: string): string | null {
	return isPattern(value) || value.includes('/') ? validatePattern(value) : validateSlug(value);
}

/** Only http(s) destinations, and never a `javascript:`/`data:` payload. */
export function validateDestination(destination: string): string | null {
	if (!destination) return 'Destination is required.';
	let url: URL;
	try {
		url = new URL(destination);
	} catch {
		return 'Enter a full URL, including https://';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return 'Only http:// and https:// destinations are allowed.';
	}
	return null;
}
