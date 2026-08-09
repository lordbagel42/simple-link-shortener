import type { Link } from './db/schema';
import type { SerializedLink } from '$lib/types';

/**
 * Prepare a link row for the browser: epoch-ms dates, and the password hash
 * reduced to a boolean so it never leaves the server.
 */
export function serializeLink(link: Link): SerializedLink {
	return {
		id: link.id,
		slug: link.slug,
		destination: link.destination,
		title: link.title,
		description: link.description,
		tags: link.tags ?? [],
		userId: link.userId,
		enabled: link.enabled,
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
		clickCount: link.clickCount,
		uniqueCount: link.uniqueCount,
		lastClickedAt: link.lastClickedAt?.getTime() ?? null,
		createdAt: link.createdAt.getTime(),
		updatedAt: link.updatedAt.getTime()
	};
}
