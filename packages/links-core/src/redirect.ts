import { findLinkBySlug, findPatternSlugs } from './d1.js';
import { shortHosts, shortPrefix, type Env, type WaitUntil } from './env.js';
import { verifyPassword } from './crypto.js';
import {
	buildTargetUrl,
	linkState,
	readLinkRecord,
	readPatternIndex,
	writePatternIndex,
	putLinkRecord,
	selectDestination,
	type LinkRecord
} from './link-record.js';
import { applyParams, firstMatch, sortPatterns, type PatternParams } from './pattern.js';
import { isPreviewCrawler, previewResponse } from './preview.js';
import { recordClick, snapshotVisitor } from './clicks.js';
import { errorPage, passwordPage } from './pages.js';

/**
 * Decides whether a request is a short-link hit, and if so which slug it wants.
 *
 * Two shapes resolve to the same link:
 *
 * - `<SHORT_PREFIX>/<slug>` on any host — `raygen.dev/l/abc`, and the same path
 *   on localhost during development.
 * - `/<slug>` at the root of any host in `SHORT_HOSTS` — `link.raygen.dev/abc`.
 *
 * Multi-segment paths are accepted because pattern slugs (`f/:form`) span more
 * than one segment. They resolve to nothing unless a pattern claims them.
 */
export function matchShortLink(url: URL, env: Env): { slug: string } | null {
	const prefix = shortPrefix(env);
	const path = url.pathname;

	if (prefix && path.startsWith(`${prefix}/`)) {
		return slugOf(path.slice(prefix.length + 1));
	}

	if (isShortHost(url, env)) {
		return slugOf(path.slice(1));
	}

	return null;
}

/** A trailing slash is the same link; anything empty is not a link at all. */
function slugOf(path: string): { slug: string } | null {
	const slug = path.replace(/\/+$/, '');
	return slug ? { slug } : null;
}

/** True when the request arrived on a hostname dedicated to short links. */
export function isShortHost(url: URL, env: Env): boolean {
	return shortHosts(env).includes(url.hostname.toLowerCase());
}

/** The 404 page, shared by the redirect Worker and the SvelteKit hook. */
export function notFoundResponse(): Response {
	return new Response(
		errorPage({
			title: 'Link not found',
			message: 'This short link does not exist, or it has been deleted.',
			code: 404
		}),
		{ status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } }
	);
}

const NO_STORE = {
	'cache-control': 'private, no-store, max-age=0',
	'referrer-policy': 'unsafe-url'
};

/** Everything the hot path needs, with no framework types involved. */
export type RedirectContext = {
	request: Request;
	url: URL;
	env: Env;
	/** Cloudflare's execution context, for deferring the click write. */
	ctx?: WaitUntil;
	/** `request.cf` — geo and network metadata. */
	cf?: Record<string, unknown>;
};

/**
 * The hot path. One KV read, then a redirect. Analytics are written after the
 * response has been handed back to the client.
 */
export async function resolveShortLink(slug: string, c: RedirectContext): Promise<Response> {
	const { request, url, env, ctx } = c;

	const resolved = await resolveRecord(env, slug, ctx);
	if (!resolved) return notFoundResponse();

	const { record, params } = resolved;

	const state = linkState(record);
	if (state !== 'ok') return unavailable(record, state);

	const visitor = snapshotVisitor(request, url, c.cf);
	const matched = selectDestination(record, {
		country: visitor.country,
		continent: visitor.continent,
		deviceType: visitor.ua.deviceType,
		os: visitor.ua.os,
		language: visitor.language,
		referer: visitor.refererDomain
	});
	// A pattern link carries its captured segments into the destination.
	const destination = applyParams(matched, params);
	const target = buildTargetUrl(record, destination, url);

	// Chat clients and crawlers get a card rather than a redirect, and are not
	// counted as clicks — nobody has gone anywhere yet. `previewResponse`
	// returns null when the link opts out or the card cannot be built, which
	// leaves the crawler with the same redirect everyone else gets.
	if (isPreviewCrawler(request.headers.get('user-agent'))) {
		const preview = await previewResponse({
			env,
			record,
			destination: target,
			shortUrl: `${url.origin}${url.pathname}`,
			ctx
		});
		if (preview) return preview;
	}

	if (record.passwordHash) {
		const unlocked = await checkPassword(request, url, record);
		if (unlocked !== true) return unlocked;
	}

	ctx?.waitUntil(
		recordClick(env, record, visitor, target).catch((error) => {
			console.error('failed to record click', error);
		})
	);

	return new Response(null, {
		// A password unlock arrives as a POST; 303 turns the follow-up into a GET.
		status: request.method === 'POST' ? 303 : record.redirectStatus,
		headers: { location: target, ...NO_STORE }
	});
}

/**
 * Slug to record, in the order that keeps the common case at one KV read:
 *
 * 1. The exact slug — every ordinary link, and every alias, is its own KV key.
 * 2. A pattern, but only for multi-segment paths. Patterns always start with a
 *    literal segment, so a single-segment request can never be claimed by one
 *    and never pays for the index read.
 * 3. D1, which repopulates KV behind the response.
 */
async function resolveRecord(
	env: Env,
	slug: string,
	ctx: WaitUntil | undefined
): Promise<{ record: LinkRecord; params: PatternParams } | null> {
	const exact = await readLinkRecord(env, slug);
	if (exact) return { record: exact, params: {} };

	if (slug.includes('/')) {
		const matched = await resolvePattern(env, slug, ctx);
		if (matched) return matched;
	}

	// KV misses are self-healing: fall back to D1 and repopulate the cache. This
	// covers cold caches, evictions, and links created before the KV write.
	const hydrated = await hydrateFromDatabase(env, slug, ctx);
	return hydrated ? { record: hydrated, params: {} } : null;
}

async function resolvePattern(
	env: Env,
	path: string,
	ctx: WaitUntil | undefined
): Promise<{ record: LinkRecord; params: PatternParams } | null> {
	let patterns = await readPatternIndex(env);

	// The dashboard republishes the index on every change; rebuilding it here
	// only covers a cold or evicted namespace.
	if (!patterns) {
		patterns = sortPatterns(await findPatternSlugs(env));
		ctx?.waitUntil(writePatternIndex(env, patterns).catch(() => {}));
	}
	if (patterns.length === 0) return null;

	const hit = firstMatch(patterns, path);
	if (!hit) return null;

	// The pattern itself is a slug, so its record is stored the usual way.
	const record =
		(await readLinkRecord(env, hit.pattern)) ??
		(await hydrateFromDatabase(env, hit.pattern, ctx));
	return record ? { record, params: hit.params } : null;
}

async function hydrateFromDatabase(
	env: Env,
	slug: string,
	ctx: WaitUntil | undefined
): Promise<LinkRecord | null> {
	const record = await findLinkBySlug(env, slug);
	if (!record) return null;

	ctx?.waitUntil(putLinkRecord(env, record).catch(() => {}));
	return record;
}

function unavailable(record: LinkRecord, state: 'disabled' | 'expired'): Response {
	if (record.fallbackUrl) {
		return new Response(null, { status: 302, headers: { location: record.fallbackUrl, ...NO_STORE } });
	}
	const message =
		state === 'expired'
			? 'This short link has expired.'
			: 'This short link is no longer active.';
	return new Response(errorPage({ title: 'Link unavailable', message, code: 410 }), {
		status: 410,
		headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE }
	});
}

/**
 * Password-protected links. Returns `true` once the visitor is through, or the
 * response to send them instead (the form, or the form with an error).
 */
async function checkPassword(
	request: Request,
	url: URL,
	record: LinkRecord
): Promise<true | Response> {
	const html = (error?: string) =>
		new Response(passwordPage({ action: url.pathname + url.search, error }), {
			status: error ? 401 : 200,
			headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE }
		});

	if (request.method !== 'POST') return html();

	const form = await request.formData();
	const password = String(form.get('password') ?? '');
	if (!password) return html('Enter the password to continue.');

	const ok = await verifyPassword(password, record.passwordHash!);
	return ok ? true : html('That password is incorrect.');
}
