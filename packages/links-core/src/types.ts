/**
 * Types shared by every consumer of the link store — the dashboard, the
 * redirect Worker, and anything else that reads the same D1 database.
 *
 * Only the redirect-path vocabulary lives here. Dashboard-only shapes
 * (`SerializedLink`, the analytics summaries) stay in the app, which is the
 * only thing that renders them.
 */

/** A targeting rule evaluated on the redirect path before the default destination. */
export type LinkRule = {
	/** What to match on. */
	type: 'country' | 'continent' | 'device' | 'os' | 'language' | 'referer';
	/** Case-insensitive value to compare against, e.g. `US`, `mobile`, `ios`, `de`. */
	value: string;
	/** Where matching visitors go instead of the default destination. */
	destination: string;
};

export const RULE_TYPES: LinkRule['type'][] = [
	'country',
	'continent',
	'device',
	'os',
	'language',
	'referer'
];

/**
 * What a link unfurls into when a chat client (Slack, Discord, iMessage…) or a
 * crawler asks for it, instead of following the redirect.
 *
 * - `target` — fetch the destination's own Open Graph tags and re-serve them
 *   under the short URL, so the card looks exactly like the destination's.
 * - `branded` — a card of our own: the link's title, notes, and where it goes.
 * - `off` — no preview page at all; crawlers get the same redirect as everyone
 *   else and unfurl whatever they find at the other end.
 */
export type PreviewMode = 'target' | 'branded' | 'off';

export const PREVIEW_MODES: PreviewMode[] = ['target', 'branded', 'off'];

export const DEFAULT_PREVIEW_MODE: PreviewMode = 'target';

export function isPreviewMode(value: unknown): value is PreviewMode {
	return typeof value === 'string' && (PREVIEW_MODES as string[]).includes(value);
}
