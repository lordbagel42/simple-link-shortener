import type { LinkInput } from './links';
import type { CloakConfig, DeepLinkConfig, LinkRule, LinkVariant, QrOptions } from '$lib/types';

/**
 * Turn the link editor's form data into a `LinkInput`.
 *
 * In `partial` mode only the fields actually present in the submission are
 * returned, so an edit form can send a subset without clearing the rest.
 *
 * The structured fields — targeting rules, split-test arms, deep links, cloak
 * settings, QR styling — arrive as JSON in a hidden input, because encoding
 * nested arrays into flat form keys and back is more code than it is worth.
 */
export function parseLinkForm(form: FormData, opts: { partial?: boolean } = {}): LinkInput {
	const has = (name: string) => form.has(name);
	const text = (name: string) => {
		const value = form.get(name);
		return value === null ? null : String(value).trim() || null;
	};
	const bool = (name: string) => {
		const value = form.get(name);
		return value === 'true' || value === 'on' || value === '1';
	};
	const int = (name: string) => {
		const value = text(name);
		if (value === null) return null;
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : null;
	};

	const input: LinkInput = { destination: text('destination') ?? '' };
	const include = (name: string) => !opts.partial || has(name);

	if (include('slug')) input.slug = text('slug') ?? undefined;
	if (include('domainId')) input.domainId = text('domainId');
	if (include('folderId')) input.folderId = text('folderId');
	if (include('title')) input.title = text('title');
	if (include('description')) input.description = text('description');
	if (include('tags')) {
		input.tags = (text('tags') ?? '')
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}
	if (include('enabled')) input.enabled = bool('enabled');
	if (include('archived')) input.archived = bool('archived');
	if (include('forwardQuery')) input.forwardQuery = bool('forwardQuery');
	if (include('hideReferrer')) input.hideReferrer = bool('hideReferrer');
	if (include('trackConversions')) input.trackConversions = bool('trackConversions');
	if (include('fallbackUrl')) input.fallbackUrl = text('fallbackUrl');
	if (include('maxClicks')) input.maxClicks = int('maxClicks');
	if (include('redirectStatus')) input.redirectStatus = int('redirectStatus') ?? 302;
	if (include('utmSource')) input.utmSource = text('utmSource');
	if (include('utmMedium')) input.utmMedium = text('utmMedium');
	if (include('utmCampaign')) input.utmCampaign = text('utmCampaign');
	if (include('utmTerm')) input.utmTerm = text('utmTerm');
	if (include('utmContent')) input.utmContent = text('utmContent');

	// `expiresAt` arrives as a `datetime-local` value in the visitor's timezone.
	if (include('expiresAt')) {
		const raw = text('expiresAt');
		const parsed = raw ? Date.parse(raw) : NaN;
		input.expiresAt = Number.isNaN(parsed) ? null : parsed;
	}

	// An empty password field on an edit form means "leave it alone"; the
	// dedicated `removePassword` flag is how you clear one.
	if (form.get('removePassword') === 'true') {
		input.password = null;
	} else {
		const password = text('password');
		if (password) input.password = password;
	}

	if (include('rules')) input.rules = json<LinkRule[]>(text('rules'), []);
	if (include('variants')) input.variants = json<LinkVariant[]>(text('variants'), []);
	if (include('deepLink')) input.deepLink = json<DeepLinkConfig | null>(text('deepLink'), null);
	if (include('cloak')) input.cloak = json<CloakConfig | null>(text('cloak'), null);
	if (include('qrOptions')) {
		input.qrOptions = json<Partial<QrOptions> | null>(text('qrOptions'), null);
	}

	return input;
}

/** Ids from a checkbox column, for the bulk actions on the list view. */
export function parseIds(form: FormData, name = 'ids'): string[] {
	const raw = form.getAll(name).flatMap((value) => String(value).split(','));
	return [...new Set(raw.map((value) => value.trim()).filter(Boolean))];
}

function json<T>(raw: string | null, fallback: T): T {
	if (!raw) return fallback;
	try {
		const parsed = JSON.parse(raw);
		return (parsed ?? fallback) as T;
	} catch {
		return fallback;
	}
}
