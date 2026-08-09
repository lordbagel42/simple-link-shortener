import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { link as linkTable } from './db/schema';
import { getEnv, shortHosts, shortPrefix, type Env, type WaitUntil } from './env';
import { verifyPassword } from './crypto';
import {
	buildTargetUrl,
	linkState,
	readLinkRecord,
	selectDestination,
	toLinkRecord,
	writeLinkRecord,
	type LinkRecord
} from './link-record';
import { recordClick, snapshotVisitor } from './clicks';
import { errorPage, passwordPage } from './pages';

/**
 * Decides whether a request is a short-link hit, and if so which slug it wants.
 *
 * Two shapes resolve to the same link:
 *
 * - `<SHORT_PREFIX>/<slug>` on any host — `raygen.dev/l/abc`, and the same path
 *   on localhost during development.
 * - `/<slug>` at the root of any host in `SHORT_HOSTS` — `link.raygen.dev/abc`.
 */
export function matchShortLink(url: URL, env: Env): { slug: string } | null {
	const prefix = shortPrefix(env);
	const path = url.pathname;

	if (prefix && path.startsWith(`${prefix}/`)) {
		const slug = path.slice(prefix.length + 1);
		return slug && !slug.includes('/') ? { slug } : null;
	}

	if (isShortHost(url, env)) {
		const slug = path.slice(1);
		return slug && !slug.includes('/') ? { slug } : null;
	}

	return null;
}

/** True when the request arrived on a hostname dedicated to short links. */
export function isShortHost(url: URL, env: Env): boolean {
	return shortHosts(env).includes(url.hostname.toLowerCase());
}

const NO_STORE = {
	'cache-control': 'private, no-store, max-age=0',
	'referrer-policy': 'unsafe-url'
};

/**
 * The hot path. One KV read, then a redirect. Analytics are written after the
 * response has been handed back to the client.
 */
export async function handleShortLink(event: RequestEvent, slug: string): Promise<Response> {
	const env = getEnv(event);
	const { url, request, platform } = event;

	let record = await readLinkRecord(env, slug);

	// KV misses are self-healing: fall back to D1 and repopulate the cache. This
	// covers cold caches, evictions, and links created before the KV write.
	if (!record) {
		record = await hydrateFromDatabase(env, slug, platform?.ctx);
		if (!record) {
			return new Response(
				errorPage({
					title: 'Link not found',
					message: 'This short link does not exist, or it has been deleted.',
					code: 404
				}),
				{ status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } }
			);
		}
	}

	const state = linkState(record);
	if (state !== 'ok') return unavailable(record, state);

	if (record.passwordHash) {
		const unlocked = await checkPassword(event, record);
		if (unlocked !== true) return unlocked;
	}

	const visitor = snapshotVisitor(request, url, platform?.cf as Record<string, unknown> | undefined);
	const destination = selectDestination(record, {
		country: visitor.country,
		continent: visitor.continent,
		deviceType: visitor.ua.deviceType,
		os: visitor.ua.os,
		language: visitor.language,
		referer: visitor.refererDomain
	});
	const target = buildTargetUrl(record, destination, url);

	platform?.ctx?.waitUntil(
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

async function hydrateFromDatabase(
	env: Env,
	slug: string,
	ctx: WaitUntil | undefined
): Promise<LinkRecord | null> {
	const db = getDb(env);
	const [row] = await db.select().from(linkTable).where(eq(linkTable.slug, slug)).limit(1);
	if (!row) return null;

	ctx?.waitUntil(writeLinkRecord(env, row).catch(() => {}));
	return toLinkRecord(row);
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
async function checkPassword(event: RequestEvent, record: LinkRecord): Promise<true | Response> {
	const { request, url } = event;
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
