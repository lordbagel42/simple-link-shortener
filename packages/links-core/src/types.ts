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
