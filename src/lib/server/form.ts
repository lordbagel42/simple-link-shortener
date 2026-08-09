import type { LinkInput } from './links';
import type { LinkRule } from './db/schema';

/**
 * Turn the link editor's form data into a `LinkInput`.
 *
 * In `partial` mode only the fields actually present in the submission are
 * returned, so an edit form can send a subset without clearing the rest.
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
	if (include('title')) input.title = text('title');
	if (include('description')) input.description = text('description');
	if (include('tags')) {
		input.tags = (text('tags') ?? '')
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}
	if (include('enabled')) input.enabled = bool('enabled');
	if (include('forwardQuery')) input.forwardQuery = bool('forwardQuery');
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

	if (include('rules')) input.rules = parseRules(text('rules'));

	return input;
}

function parseRules(raw: string | null): LinkRule[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as LinkRule[]) : [];
	} catch {
		return [];
	}
}
