import type { RequestHandler } from './$types';
import { apiError, requireApiUser } from '$lib/server/api';
import { getLink } from '$lib/server/links';
import { getDomain, shortUrlForDomain } from '$lib/server/domains';
import { renderQrSvg } from '$lib/qr';
import type { QrOptions } from '$lib/types';

/**
 * `GET /api/v1/links/:id/qr` — the link's QR code as SVG.
 *
 * Styling comes from the link's saved `qrOptions`, and every one of them can be
 * overridden per request. SVG only: a Worker has no canvas, and a vector code
 * is the better artefact anyway — the dashboard rasterises in the browser when
 * someone asks for a PNG.
 */
export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const link = await getLink(auth.env, auth.userId, event.params.id);
	if (!link) return apiError('Link not found.', 404);

	const domain = await getDomain(auth.env, auth.userId, link.domainId);
	if (!domain) return apiError('This link points at a domain that no longer exists.', 404);

	const params = event.url.searchParams;
	// The QR carries `?qr=1`, which is what separates scans from ordinary
	// clicks in analytics. `track=0` opts out for codes printed somewhere the
	// distinction is not wanted.
	const target =
		shortUrlForDomain(domain, link.slug, event.url) + (params.get('track') === '0' ? '' : '?qr=1');

	const overrides: Partial<QrOptions> = { ...(link.qrOptions ?? {}) };
	if (params.has('fg')) overrides.foreground = color(params.get('fg')!);
	if (params.has('bg')) overrides.background = color(params.get('bg')!);
	if (params.has('margin')) overrides.margin = Number(params.get('margin'));
	if (params.has('size')) overrides.size = Number(params.get('size'));
	if (params.has('style')) overrides.style = style(params.get('style')!);
	if (params.has('ec')) overrides.errorCorrection = errorCorrection(params.get('ec')!);
	if (params.get('logo') === '0') overrides.logo = null;

	return new Response(renderQrSvg(target, overrides), {
		headers: {
			'content-type': 'image/svg+xml; charset=utf-8',
			'cache-control': 'public, max-age=300',
			'content-disposition': `inline; filename="${link.slug}.svg"`
		}
	});
};

/** Accepts `#rrggbb`, bare hex, or a plain CSS colour name. */
function color(raw: string): string {
	const value = raw.trim();
	if (/^[0-9a-f]{3,8}$/i.test(value)) return `#${value}`;
	if (/^#[0-9a-f]{3,8}$/i.test(value) || /^[a-z]+$/i.test(value)) return value;
	return '#000000';
}

function style(raw: string): QrOptions['style'] {
	return raw === 'rounded' || raw === 'dots' ? raw : 'square';
}

function errorCorrection(raw: string): QrOptions['errorCorrection'] {
	const value = raw.toUpperCase();
	return value === 'L' || value === 'Q' || value === 'H' ? value : 'M';
}
