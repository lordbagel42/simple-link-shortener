/**
 * Link previews — what Slack, Discord, iMessage, and the rest unfurl when a
 * short link is pasted into a conversation.
 *
 * A crawler that follows a 302 usually ends up showing the destination's own
 * card, which is fine until the destination blocks unknown clients, or until
 * you actually wanted the card to say something about the short link. So the
 * redirect path answers crawlers with an HTML page instead of a redirect, in
 * one of two shapes (see `PreviewMode`):
 *
 * - `target` — the destination's Open Graph tags, fetched once and cached, then
 *   re-served under the short URL. The card looks like the destination's.
 * - `branded` — our own card: the link's title, its notes, and where it goes.
 *
 * Anything that cannot be resolved falls back to the plain redirect, so the
 * worst case is exactly the behaviour that existed before previews.
 */

import type { Env, WaitUntil } from './env.js';
import type { LinkRecord } from './link-record.js';
import { sha256Hex } from './crypto.js';
import { previewPage } from './pages.js';

/**
 * Clients that fetch a URL to render a card rather than to visit it.
 *
 * Deliberately narrower than the `isBot` check used for analytics: a search
 * crawler or an uptime monitor should keep getting the redirect, and only the
 * unfurlers get an HTML card.
 */
const CRAWLER_RE =
	/slackbot|slack-imgproxy|discordbot|twitterbot|facebookexternalhit|facebot|whatsapp|telegrambot|linkedinbot|pinterest(?:bot|\/)|redditbot|embedly|iframely|quora link preview|skypeuripreview|vkshare|applebot|bingpreview|snapchat|flipboard|tumblr|mastodon|pleroma|misskey|akkoma|matrix|synapse|nextcloud|googlebot|google-inspectiontool|developers\.google\.com\/\+\/web\/snippet|bitlybot|opengraph|metainspector|http\.rb|yahoo|duckduckbot/i;

export function isPreviewCrawler(userAgent: string | null | undefined): boolean {
	return Boolean(userAgent) && CRAWLER_RE.test(userAgent!);
}

/** The handful of tags a card is built from. */
export type PreviewMeta = {
	title: string | null;
	description: string | null;
	image: string | null;
	siteName: string | null;
	largeImage: boolean;
};

export type PreviewInput = {
	env: Env;
	record: LinkRecord;
	/** The destination this visitor would have been sent to. */
	destination: string;
	/** The short URL as it was requested, which is what the card points at. */
	shortUrl: string;
	ctx?: WaitUntil;
};

/**
 * The card for a link, or `null` when the caller should just redirect.
 *
 * `null` covers both `previewMode: 'off'` and a `target` preview whose
 * destination could not be read — in either case letting the crawler follow the
 * redirect is better than serving it a card we are not confident in.
 */
export async function previewResponse(input: PreviewInput): Promise<Response | null> {
	const { record, destination, shortUrl } = input;

	if (record.previewMode === 'off') return null;

	// A protected link must not leak where it goes, or what is waiting there, to
	// anything that has not entered the password.
	if (record.passwordHash) {
		return page({
			title: record.title ?? 'Protected link',
			description: record.description ?? 'This link is password protected.',
			image: record.previewImage,
			siteName: hostOf(shortUrl),
			largeImage: Boolean(record.previewImage),
			url: shortUrl,
			destination: null
		});
	}

	if (record.previewMode === 'target') {
		const meta = await targetMeta(input);
		if (!meta) return null;
		return page({
			title: meta.title ?? record.title ?? hostOf(destination) ?? 'Link',
			description: meta.description ?? record.description,
			image: meta.image,
			siteName: meta.siteName ?? hostOf(destination),
			largeImage: meta.largeImage,
			url: shortUrl,
			destination
		});
	}

	return page({
		title: record.title ?? hostOf(destination) ?? 'Link',
		description: record.description ?? `Redirects to ${trimUrl(destination)}`,
		image: record.previewImage,
		siteName: hostOf(shortUrl),
		largeImage: Boolean(record.previewImage),
		url: shortUrl,
		destination
	});
}

function page(opts: Parameters<typeof previewPage>[0]): Response {
	return new Response(previewPage(opts), {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			// Crawlers re-fetch often; let their own caches hold the card briefly.
			'cache-control': 'public, max-age=300',
			'referrer-policy': 'unsafe-url'
		}
	});
}

/* --- the destination's own tags ------------------------------------------ */

const CACHE_TTL_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 2500;
const MAX_HEAD_BYTES = 96 * 1024;

/** Cached per destination URL, so links sharing a destination share the fetch. */
async function metaKey(destination: string): Promise<string> {
	return `og:${(await sha256Hex(destination)).slice(0, 32)}`;
}

async function targetMeta(input: PreviewInput): Promise<PreviewMeta | null> {
	const { env, destination, ctx } = input;
	const key = await metaKey(destination);

	const cached = await env.LINKS.get<PreviewMeta | { miss: true }>(key, {
		type: 'json',
		cacheTtl: 300
	});
	if (cached) return 'miss' in cached ? null : cached;

	const meta = await fetchPreviewMeta(destination);

	// Failures are cached too, briefly, so an unreachable destination cannot turn
	// every unfurl into another outbound request.
	const write = env.LINKS.put(key, JSON.stringify(meta ?? { miss: true }), {
		expirationTtl: meta ? CACHE_TTL_SECONDS : 300
	}).catch(() => {});
	if (ctx) ctx.waitUntil(write);
	else await write;

	return meta;
}

/** Fetch a URL and read the Open Graph tags out of its `<head>`. */
export async function fetchPreviewMeta(destination: string): Promise<PreviewMeta | null> {
	let response: Response;
	try {
		response = await fetch(destination, {
			redirect: 'follow',
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: {
				// Identifying ourselves honestly gets through more bot filters than
				// pretending to be a browser does.
				'user-agent': 'links-preview/1.0 (+https://github.com/lordbagel42/links-agent)',
				accept: 'text/html,application/xhtml+xml',
				'accept-language': 'en'
			}
		});
	} catch {
		return null;
	}

	if (!response.ok) return null;
	if (!(response.headers.get('content-type') ?? '').includes('html')) return null;

	const html = await readHead(response);
	const meta = parseMeta(html);

	// A card with nothing on it is worse than the redirect it replaced.
	if (!meta.title && !meta.description && !meta.image) return null;

	meta.image = absolute(meta.image, response.url || destination);
	return meta;
}

/** Read until `</head>`, or until the cap, whichever comes first. */
async function readHead(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return '';

	const decoder = new TextDecoder();
	let html = '';
	let bytes = 0;

	try {
		while (bytes < MAX_HEAD_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			html += decoder.decode(value, { stream: true });
			const headEnd = html.search(/<\/head>/i);
			if (headEnd !== -1) return html.slice(0, headEnd);
		}
	} catch {
		// A truncated body is still worth parsing.
	} finally {
		reader.cancel().catch(() => {});
	}

	return html;
}

const META_TAG_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

export function parseMeta(html: string): PreviewMeta {
	const tags = new Map<string, string>();

	for (const [tag] of html.matchAll(META_TAG_RE)) {
		const attrs = new Map<string, string>();
		for (const [, name, dq, sq, bare] of tag.matchAll(ATTR_RE)) {
			attrs.set(name.toLowerCase(), dq ?? sq ?? bare ?? '');
		}
		const key = attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop');
		const content = attrs.get('content');
		// First tag of a given name wins, which is what crawlers do.
		if (key && content && !tags.has(key.toLowerCase())) tags.set(key.toLowerCase(), content);
	}

	const pick = (...keys: string[]): string | null => {
		for (const key of keys) {
			const value = tags.get(key)?.trim();
			if (value) return decodeEntities(value);
		}
		return null;
	};

	const documentTitle = TITLE_RE.exec(html)?.[1]?.trim();

	return {
		title: pick('og:title', 'twitter:title') ?? (documentTitle ? decodeEntities(documentTitle) : null),
		description: pick('og:description', 'twitter:description', 'description'),
		image: pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'),
		siteName: pick('og:site_name', 'application-name'),
		largeImage: (pick('twitter:card') ?? '').toLowerCase() !== 'summary'
	};
}

/** Card images are routinely relative; crawlers will not resolve them for us. */
function absolute(image: string | null, base: string): string | null {
	if (!image) return null;
	try {
		const resolved = new URL(image, base);
		return resolved.protocol === 'http:' || resolved.protocol === 'https:'
			? resolved.toString()
			: null;
	} catch {
		return null;
	}
}

const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	'#39': "'",
	nbsp: ' '
};

function decodeEntities(value: string): string {
	return value
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body: string) => {
			const key = body.toLowerCase();
			if (ENTITIES[key]) return ENTITIES[key];
			if (key.startsWith('#x')) return codePoint(parseInt(key.slice(2), 16)) ?? entity;
			if (key.startsWith('#')) return codePoint(parseInt(key.slice(1), 10)) ?? entity;
			return entity;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

function codePoint(value: number): string | null {
	return Number.isFinite(value) && value > 0 && value <= 0x10ffff
		? String.fromCodePoint(value)
		: null;
}

function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}

/** `https://example.com/a/b?c=d` → `example.com/a/b` */
function trimUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname === '/' ? '' : parsed.pathname;
		return `${parsed.hostname.replace(/^www\./, '')}${path}`;
	} catch {
		return url;
	}
}
