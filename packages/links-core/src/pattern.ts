/**
 * Pattern slugs.
 *
 * An ordinary slug is one literal path segment and resolves with a single KV
 * read. A *pattern* slug is matched instead of looked up, and whatever it
 * captures can be interpolated back into the destination:
 *
 *     f/:form   →  https://forms.raygen.dev/form/:form
 *     docs/*    →  https://docs.example.com/*
 *
 * Two rules keep matching cheap and unambiguous:
 *
 * 1. A pattern is always at least two segments and its **first segment is
 *    literal**. Single-segment requests — every ordinary short link — therefore
 *    never touch the pattern index at all.
 * 2. `*` is a trailing wildcard: it swallows the rest of the path, slashes
 *    included, and anything written after it in the pattern is ignored.
 */

/** Captured segments, keyed by placeholder name. The wildcard is `*`. */
export type PatternParams = Record<string, string>;

/** True when a slug has to be matched rather than read straight out of KV. */
export function isPattern(slug: string): boolean {
	return slug.includes(':') || slug.includes('*');
}

function segments(path: string): string[] {
	return path.replace(/^\/+|\/+$/g, '').split('/');
}

/**
 * Match a concrete request path against one pattern. Returns the captured
 * parameters (possibly empty), or `null` when the pattern does not apply.
 */
export function matchPattern(pattern: string, path: string): PatternParams | null {
	const patternParts = segments(pattern);
	const pathParts = segments(path);
	const params: PatternParams = {};

	for (let index = 0; index < patternParts.length; index++) {
		const part = patternParts[index]!;

		if (part === '*') {
			const rest = pathParts.slice(index).join('/');
			if (!rest) return null;
			params['*'] = decode(rest);
			return params;
		}

		const segment = pathParts[index];
		if (!segment) return null;

		if (part.startsWith(':')) {
			const name = part.slice(1);
			if (!name) return null;
			params[name] = decode(segment);
			continue;
		}

		if (part.toLowerCase() !== segment.toLowerCase()) return null;
	}

	// Without a wildcard the pattern has to account for the whole path.
	return patternParts.length === pathParts.length ? params : null;
}

/** The first pattern that matches, given a list already in precedence order. */
export function firstMatch(
	patterns: string[],
	path: string
): { pattern: string; params: PatternParams } | null {
	for (const pattern of patterns) {
		const params = matchPattern(pattern, path);
		if (params) return { pattern, params };
	}
	return null;
}

/**
 * Substitute captured parameters into a destination. `:name` takes the segment
 * captured under that name and `*` takes the wildcard remainder; a placeholder
 * with nothing to fill it is left alone rather than blanked out.
 */
export function applyParams(destination: string, params: PatternParams): string {
	if (!hasParams(params)) return destination;

	return destination.replace(/:([A-Za-z_][A-Za-z0-9_-]*)|\*/g, (token, name?: string) => {
		const value = name === undefined ? params['*'] : params[name];
		return value === undefined ? token : encodeSegments(value);
	});
}

export function hasParams(params: PatternParams | undefined): boolean {
	return Boolean(params && Object.keys(params).length > 0);
}

/**
 * Precedence order: the most specific pattern first, so `f/new` beats `f/:form`
 * and `f/:form` beats `f/*`. Ties are broken alphabetically to keep the index
 * stable between rebuilds.
 */
export function sortPatterns(patterns: string[]): string[] {
	return [...patterns].sort((a, b) => specificity(b) - specificity(a) || a.localeCompare(b));
}

function specificity(pattern: string): number {
	let score = 0;
	for (const part of segments(pattern)) {
		// A literal segment pins the path down; a placeholder matches anything;
		// a wildcard matches anything and any number of them.
		if (part === '*') score -= 8;
		else if (part.startsWith(':')) score += 1;
		else score += 4;
	}
	return score;
}

/** Percent-encode a captured value without escaping the slashes inside it. */
function encodeSegments(value: string): string {
	return value
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

function decode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
