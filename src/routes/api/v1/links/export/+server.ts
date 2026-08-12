import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/api';
import { listLinks, type ListOptions } from '$lib/server/links';
import { domainsById, shortUrlForDomain } from '$lib/server/domains';
import { csvLine } from '$lib/csv';

/**
 * `GET /api/v1/links/export` — the whole link table as CSV.
 *
 * Column names match what `POST /api/v1/links/import` reads back, so an export
 * is a valid import: this is the migration path between instances, and the
 * backup for anyone who wants one that is not a D1 dump.
 */
const COLUMNS = [
	'id',
	'domain',
	'slug',
	'shortUrl',
	'destination',
	'title',
	'description',
	'tags',
	'enabled',
	'archived',
	'hasPassword',
	'expiresAt',
	'maxClicks',
	'fallbackUrl',
	'forwardQuery',
	'redirectStatus',
	'hideReferrer',
	'trackConversions',
	'utmSource',
	'utmMedium',
	'utmCampaign',
	'utmTerm',
	'utmContent',
	'clickCount',
	'uniqueCount',
	'conversionCount',
	'conversionValue',
	'lastClickedAt',
	'createdAt'
];

const PAGE = 250;

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const params = event.url.searchParams;
	const base: ListOptions = {
		search: params.get('search') ?? undefined,
		tag: params.get('tag') ?? undefined,
		folderId: params.get('folder') ?? undefined,
		domainId: params.get('domain') ?? undefined,
		status: (params.get('status') as ListOptions['status']) ?? 'all',
		sort: 'oldest'
	};

	const domains = await domainsById(auth.env, auth.userId);
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(encoder.encode(csvLine(COLUMNS)));

			try {
				for (let offset = 0; offset < 100_000; offset += PAGE) {
					const { links } = await listLinks(auth.env, auth.userId, {
						...base,
						limit: PAGE,
						offset
					});
					if (links.length === 0) break;

					for (const link of links) {
						const domain = domains.get(link.domainId);
						controller.enqueue(
							encoder.encode(
								csvLine([
									link.id,
									domain?.hostname ?? '',
									link.slug,
									domain ? shortUrlForDomain(domain, link.slug, event.url) : '',
									link.destination,
									link.title,
									link.description,
									(link.tags ?? []).join(' '),
									link.enabled,
									link.archived,
									Boolean(link.passwordHash),
									link.expiresAt?.toISOString() ?? '',
									link.maxClicks,
									link.fallbackUrl,
									link.forwardQuery,
									link.redirectStatus,
									link.hideReferrer,
									link.trackConversions,
									link.utmSource,
									link.utmMedium,
									link.utmCampaign,
									link.utmTerm,
									link.utmContent,
									link.clickCount,
									link.uniqueCount,
									link.conversionCount,
									link.conversionValue,
									link.lastClickedAt?.toISOString() ?? '',
									link.createdAt.toISOString()
								])
							)
						);
					}

					if (links.length < PAGE) break;
				}
			} catch (error) {
				console.error('link export failed', error);
			}

			controller.close();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="links-${new Date().toISOString().slice(0, 10)}.csv"`,
			'cache-control': 'no-store'
		}
	});
};
