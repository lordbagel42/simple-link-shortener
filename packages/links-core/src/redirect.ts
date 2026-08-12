import { findLinkBySlug } from './d1.js';
import { shortHosts, shortPrefix, type Env, type WaitUntil } from './env.js';
import { newId, verifyPassword } from './crypto.js';
import {
	buildTargetUrl,
	linkState,
	normalizeHost,
	readDomainRecord,
	readLinkRecord,
	putLinkRecord,
	selectDestination,
	type DomainRecord,
	type LinkRecord,
	type Selection
} from './link-record.js';
import { recordClick, snapshotVisitor, type VisitorSnapshot } from './clicks.js';
import { cloakPage, deepLinkPage, errorPage, hiddenReferrerPage, passwordPage } from './pages.js';
import { hasDeepLink } from './types.js';

/**
 * Decides whether a request is a short-link hit, and if so which slug it wants.
 *
 * Two shapes resolve without any lookup at all:
 *
 * - `<SHORT_PREFIX>/<slug>` on any host — `raygen.dev/l/abc`, and the same path
 *   on localhost during development.
 * - `/<slug>` at the root of any host in `SHORT_HOSTS`.
 *
 * Registered domains beyond `SHORT_HOSTS` are handled by `resolveRequest`,
 * which will pay for a KV read to recognise them. This function stays sync so
 * the dashboard's hook can call it on every request without cost.
 */
export function matchShortLink(url: URL, env: Env): { slug: string } | null {
	const prefix = shortPrefix(env);
	const path = url.pathname;

	if (prefix && path.startsWith(`${prefix}/`)) {
		const slug = path.slice(prefix.length + 1);
		return slug && !slug.includes('/') ? { slug } : null;
	}

	if (isShortHost(url, env)) {
		return singleSegment(path);
	}

	return null;
}

function singleSegment(path: string): { slug: string } | null {
	const slug = path.slice(1);
	return slug && !slug.includes('/') ? { slug } : null;
}

/** True when the request arrived on a hostname dedicated to short links. */
export function isShortHost(url: URL, env: Env): boolean {
	return shortHosts(env).includes(url.hostname.toLowerCase());
}

const NO_STORE = {
	'cache-control': 'private, no-store, max-age=0',
	'referrer-policy': 'unsafe-url'
};

const HTML = { 'content-type': 'text/html; charset=utf-8', ...NO_STORE };

/** The 404 page, shared by the redirect Worker and the SvelteKit hook. */
export function notFoundResponse(domain?: DomainRecord | null): Response {
	if (domain?.notFoundRedirect) {
		return new Response(null, {
			status: 302,
			headers: { location: domain.notFoundRedirect, ...NO_STORE }
		});
	}
	return new Response(
		errorPage({
			title: 'Link not found',
			message: 'This short link does not exist, or it has been deleted.',
			code: 404
		}),
		{ status: 404, headers: HTML }
	);
}

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
 * Full request handling for a Worker that serves nothing but short links.
 *
 * Returns `null` when the request is not this Worker's to answer, so the caller
 * decides what a miss means. Registered domains are recognised here — a KV read
 * that the sync `matchShortLink` deliberately avoids — which is what lets a new
 * domain start serving links without touching `SHORT_HOSTS`.
 */
export async function resolveRequest(c: RedirectContext): Promise<Response | null> {
	const { url, env } = c;
	const host = normalizeHost(url.hostname);

	const direct = matchShortLink(url, env);
	if (direct) return resolveShortLink(host, direct.slug, c);

	const domain = await readDomainRecord(env, host);
	if (!domain) return null;

	// The domain's own prefix, which may differ from the instance-wide default.
	const prefix = domain.prefix.replace(/\/+$/, '');
	const path = url.pathname;

	if (prefix) {
		if (path === prefix || path === `${prefix}/`) return mainRedirect(domain, c);
		if (!path.startsWith(`${prefix}/`)) return notFoundResponse(domain);
		const slug = path.slice(prefix.length + 1);
		if (!slug || slug.includes('/')) return notFoundResponse(domain);
		return resolveShortLink(host, slug, c, domain);
	}

	if (path === '/') return mainRedirect(domain, c);

	const match = singleSegment(path);
	if (!match) return notFoundResponse(domain);
	return resolveShortLink(host, match.slug, c, domain);
}

function mainRedirect(domain: DomainRecord, c: RedirectContext): Response | null {
	const target = domain.mainRedirect ?? c.env.APP_URL;
	if (!target) return notFoundResponse(domain);
	return new Response(null, { status: 302, headers: { location: target, ...NO_STORE } });
}

/**
 * The hot path. One KV read, then a redirect. Analytics are written after the
 * response has been handed back to the client.
 */
export async function resolveShortLink(
	host: string,
	slug: string,
	c: RedirectContext,
	domain?: DomainRecord | null
): Promise<Response> {
	const started = Date.now();
	const { request, url, env, ctx } = c;

	let record = await readLinkRecord(env, host, slug);

	// KV misses are self-healing: fall back to D1 and repopulate the cache. This
	// covers cold caches, evictions, and links created before the KV write.
	if (!record) {
		record = await hydrateFromDatabase(env, host, slug, ctx);
		if (!record) return notFoundResponse(domain);
	}

	const state = linkState(record);
	if (state !== 'ok') return unavailable(record, state, domain);

	if (record.passwordHash) {
		const unlocked = await checkPassword(request, url, record);
		if (unlocked !== true) return unlocked;
	}

	const visitor = snapshotVisitor(request, url, c.cf);
	// Allocated up front so it can travel to the destination as `clid` and be
	// reported back later as a conversion.
	const clickId = newId();

	const roll = stickyRoll(request, record.id);
	const selection = selectDestination(record, visitorContext(visitor), roll.value);
	const target = buildTargetUrl(record, selection.destination, url, clickId);

	const response = render(record, visitor, target, request);

	if (record.variants.length > 0 && !roll.pinned) {
		response.headers.append(
			'set-cookie',
			`${variantCookie(record.id)}=${roll.value.toFixed(6)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`
		);
	}

	ctx?.waitUntil(
		recordClick(env, record, visitor, {
			id: clickId,
			destination: target,
			variant: selection.variant,
			rule: selection.rule,
			responseStatus: response.status,
			processingMs: Date.now() - started
		}).catch((error) => {
			console.error('failed to record click', error);
		})
	);

	return response;
}

/* -------------------------------------------------------------------------- */
/*  Response shape                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Four ways to send a visitor onward, in priority order: hand off to a native
 * app, frame the destination, launder the referrer, or just redirect.
 */
function render(
	record: LinkRecord,
	visitor: VisitorSnapshot,
	target: string,
	request: Request
): Response {
	const app = deepLinkTarget(record, visitor);
	if (app) {
		return new Response(
			deepLinkPage({
				appUrl: app.appUrl,
				fallbackUrl: app.fallbackUrl ?? target,
				timeoutMs: record.deepLink?.timeoutMs ?? 1200
			}),
			{ status: 200, headers: HTML }
		);
	}

	if (record.cloak?.enabled) {
		return new Response(
			cloakPage({
				destination: target,
				title: record.cloak.title,
				description: record.cloak.description,
				image: record.cloak.image
			}),
			{ status: 200, headers: HTML }
		);
	}

	if (record.hideReferrer) {
		return new Response(hiddenReferrerPage(target), {
			status: 200,
			headers: { ...HTML, 'referrer-policy': 'no-referrer' }
		});
	}

	return new Response(null, {
		// A password unlock arrives as a POST; 303 turns the follow-up into a GET.
		status: request.method === 'POST' ? 303 : record.redirectStatus,
		headers: { location: target, ...NO_STORE }
	});
}

function deepLinkTarget(
	record: LinkRecord,
	visitor: VisitorSnapshot
): { appUrl: string; fallbackUrl: string | null } | null {
	const config = record.deepLink;
	if (!hasDeepLink(config)) return null;

	const os = (visitor.ua.os ?? '').toLowerCase();
	if (os.startsWith('ios') || os.startsWith('ipad')) {
		return config!.iosUrl
			? { appUrl: config!.iosUrl, fallbackUrl: config!.iosFallback ?? null }
			: null;
	}
	if (os === 'android') {
		return config!.androidUrl
			? { appUrl: config!.androidUrl, fallbackUrl: config!.androidFallback ?? null }
			: null;
	}
	return null;
}

function visitorContext(visitor: VisitorSnapshot) {
	return {
		country: visitor.country,
		region: visitor.region,
		city: visitor.city,
		continent: visitor.continent,
		deviceType: visitor.ua.deviceType,
		os: visitor.ua.os,
		browser: visitor.ua.browser,
		language: visitor.language,
		referer: visitor.refererDomain,
		asn: visitor.asn,
		timezone: visitor.timezone,
		query: visitor.queryString
	};
}

/* -------------------------------------------------------------------------- */
/*  A/B stickiness                                                             */
/* -------------------------------------------------------------------------- */

function variantCookie(linkId: string): string {
	return `_lv_${linkId}`;
}

/**
 * Keep a visitor on the arm they first landed on. The roll itself is stored
 * rather than the arm index, so re-weighting a live test moves the boundary
 * without reshuffling everyone who is already in it.
 */
function stickyRoll(request: Request, linkId: string): { value: number; pinned: boolean } {
	const cookies = request.headers.get('cookie');
	if (cookies) {
		const name = variantCookie(linkId);
		for (const part of cookies.split(';')) {
			const [key, raw] = part.split('=');
			if (key?.trim() !== name) continue;
			const parsed = Number.parseFloat(raw ?? '');
			if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1) {
				return { value: parsed, pinned: true };
			}
		}
	}
	return { value: Math.random(), pinned: false };
}

/* -------------------------------------------------------------------------- */
/*  Misses and gates                                                           */
/* -------------------------------------------------------------------------- */

async function hydrateFromDatabase(
	env: Env,
	host: string,
	slug: string,
	ctx: WaitUntil | undefined
): Promise<LinkRecord | null> {
	const record = await findLinkBySlug(env, host, slug);
	if (!record) return null;

	ctx?.waitUntil(putLinkRecord(env, record, [record.host]).catch(() => {}));
	return record;
}

function unavailable(
	record: LinkRecord,
	state: 'disabled' | 'expired',
	domain?: DomainRecord | null
): Response {
	const fallback = record.fallbackUrl ?? domain?.expiredRedirect ?? null;
	if (fallback) {
		return new Response(null, { status: 302, headers: { location: fallback, ...NO_STORE } });
	}
	const message =
		state === 'expired' ? 'This short link has expired.' : 'This short link is no longer active.';
	return new Response(errorPage({ title: 'Link unavailable', message, code: 410 }), {
		status: 410,
		headers: HTML
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
			headers: HTML
		});

	if (request.method !== 'POST') return html();

	const form = await request.formData();
	const password = String(form.get('password') ?? '');
	if (!password) return html('Enter the password to continue.');

	const ok = await verifyPassword(password, record.passwordHash!);
	return ok ? true : html('That password is incorrect.');
}

export type { Selection };
