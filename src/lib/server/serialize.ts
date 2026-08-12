import type { Domain, Folder, Link, Conversion, Webhook } from './db/schema';
import type {
	SerializedConversion,
	SerializedDomain,
	SerializedFolder,
	SerializedLink
} from '$lib/types';
import { shortUrlForDomain } from './domains';

/**
 * Prepare rows for the browser: epoch-ms dates, secrets reduced to booleans,
 * and the link's short URL resolved from its domain so no component has to
 * know how one is assembled.
 */
export function serializeLink(
	link: Link,
	domain: Pick<Domain, 'hostname' | 'prefix'>,
	requestUrl?: URL
): SerializedLink {
	return {
		id: link.id,
		slug: link.slug,
		destination: link.destination,
		domainId: link.domainId,
		folderId: link.folderId,
		title: link.title,
		description: link.description,
		tags: link.tags ?? [],
		userId: link.userId,
		enabled: link.enabled,
		archived: link.archived,
		hasPassword: Boolean(link.passwordHash),
		expiresAt: link.expiresAt?.getTime() ?? null,
		maxClicks: link.maxClicks,
		fallbackUrl: link.fallbackUrl,
		forwardQuery: link.forwardQuery,
		utmSource: link.utmSource,
		utmMedium: link.utmMedium,
		utmCampaign: link.utmCampaign,
		utmTerm: link.utmTerm,
		utmContent: link.utmContent,
		redirectStatus: link.redirectStatus,
		rules: link.rules ?? [],
		variants: link.variants ?? [],
		deepLink: link.deepLink ?? null,
		cloak: link.cloak ?? null,
		hideReferrer: link.hideReferrer,
		trackConversions: link.trackConversions,
		qrOptions: link.qrOptions ?? null,
		clickCount: link.clickCount,
		uniqueCount: link.uniqueCount,
		conversionCount: link.conversionCount,
		conversionValue: link.conversionValue,
		lastClickedAt: link.lastClickedAt?.getTime() ?? null,
		createdAt: link.createdAt.getTime(),
		updatedAt: link.updatedAt.getTime(),
		shortUrl: shortUrlForDomain(domain, link.slug, requestUrl)
	};
}

/**
 * Serialise many links against a domain lookup. Links whose domain has gone
 * missing are dropped rather than rendered with a broken short URL.
 */
export function serializeLinks(
	links: Link[],
	domains: Map<string, Domain>,
	requestUrl?: URL
): SerializedLink[] {
	const out: SerializedLink[] = [];
	for (const link of links) {
		const domain = domains.get(link.domainId);
		if (domain) out.push(serializeLink(link, domain, requestUrl));
	}
	return out;
}

export function serializeDomain(domain: Domain, linkCount = 0): SerializedDomain {
	return {
		id: domain.id,
		hostname: domain.hostname,
		label: domain.label,
		prefix: domain.prefix,
		isDefault: domain.isDefault,
		slugLength: domain.slugLength,
		redirectStatus: domain.redirectStatus,
		mainRedirect: domain.mainRedirect,
		notFoundRedirect: domain.notFoundRedirect,
		expiredRedirect: domain.expiredRedirect,
		linkCount,
		createdAt: domain.createdAt.getTime()
	};
}

export function serializeFolder(folder: Folder & { linkCount?: number }): SerializedFolder {
	return {
		id: folder.id,
		name: folder.name,
		color: folder.color,
		linkCount: folder.linkCount ?? 0
	};
}

export function serializeConversion(row: Conversion): SerializedConversion {
	return {
		id: row.id,
		linkId: row.linkId,
		clickId: row.clickId,
		slug: row.slug,
		event: row.event,
		value: row.value,
		currency: row.currency,
		latencyMs: row.latencyMs,
		timestamp: row.timestamp.getTime()
	};
}

/** Everything about a webhook except its signing secret, which is write-once. */
export function serializeWebhook(hook: Webhook) {
	return {
		id: hook.id,
		url: hook.url,
		description: hook.description,
		events: hook.events,
		enabled: hook.enabled,
		lastStatus: hook.lastStatus,
		lastFiredAt: hook.lastFiredAt?.toISOString() ?? null,
		failureCount: hook.failureCount,
		createdAt: hook.createdAt.toISOString()
	};
}
