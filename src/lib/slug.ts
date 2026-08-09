/** Slug rules shared by the server and the browser so validation matches. */

/** No vowels or lookalikes — generated slugs stay unambiguous and unoffensive. */
const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,63}$/;

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
