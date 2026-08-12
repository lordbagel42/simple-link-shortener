/**
 * Types shared by every consumer of the link store — the dashboard, the
 * redirect Worker, and anything else that reads the same D1 database.
 *
 * Only the redirect-path vocabulary lives here. Dashboard-only shapes
 * (`SerializedLink`, the analytics summaries) stay in the app, which is the
 * only thing that renders them.
 */

/* -------------------------------------------------------------------------- */
/*  Targeting                                                                  */
/* -------------------------------------------------------------------------- */

/** What a targeting rule can match on. All are read from the click snapshot. */
export type RuleType =
	| 'country'
	| 'region'
	| 'city'
	| 'continent'
	| 'device'
	| 'os'
	| 'browser'
	| 'language'
	| 'referer'
	| 'asn'
	| 'timezone'
	| 'query';

export const RULE_TYPES: RuleType[] = [
	'country',
	'region',
	'city',
	'continent',
	'device',
	'os',
	'browser',
	'language',
	'referer',
	'asn',
	'timezone',
	'query'
];

/**
 * How the rule's value is compared. Omitted means `contains`, which is what
 * every rule written before operators existed relied on.
 */
export type RuleOperator = 'contains' | 'is' | 'starts_with' | 'ends_with' | 'not';

export const RULE_OPERATORS: RuleOperator[] = ['is', 'contains', 'starts_with', 'ends_with', 'not'];

/** A targeting rule evaluated on the redirect path before the default destination. */
export type LinkRule = {
	type: RuleType;
	/** Defaults to `contains` when absent. */
	op?: RuleOperator;
	/** Case-insensitive. Commas separate alternatives: `US,CA,MX`. */
	value: string;
	/** Where matching visitors go instead of the default destination. */
	destination: string;
};

/* -------------------------------------------------------------------------- */
/*  A/B testing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One arm of a split test. Traffic is divided by `weight` relative to the sum
 * of all weights, and the visitor is pinned to their arm with a cookie so
 * repeat clicks stay consistent.
 */
export type LinkVariant = {
	/** Shown in analytics. Falls back to `A`, `B`, `C`… by position. */
	label?: string | null;
	destination: string;
	/** Relative share. `0` parks an arm without deleting it. */
	weight: number;
};

/* -------------------------------------------------------------------------- */
/*  Deep links                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Mobile app targeting. When the visitor is on a matching platform the redirect
 * path serves a small interstitial that tries the app URL and falls back to the
 * store (or the web destination) if nothing handles it.
 */
export type DeepLinkConfig = {
	/** Custom scheme or universal link, e.g. `myapp://item/12`. */
	iosUrl?: string | null;
	/** Where iOS visitors without the app go. Defaults to the web destination. */
	iosFallback?: string | null;
	androidUrl?: string | null;
	androidFallback?: string | null;
	/** How long to wait for the app to take over. Default 1200ms. */
	timeoutMs?: number | null;
};

export function hasDeepLink(config: DeepLinkConfig | null | undefined): boolean {
	return Boolean(config && (config.iosUrl || config.androidUrl));
}

/* -------------------------------------------------------------------------- */
/*  Cloaking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Keeps the short URL in the address bar by framing the destination. The
 * OpenGraph fields are also used for link previews on links that are not
 * cloaked, which is why they live on the same object.
 */
export type CloakConfig = {
	enabled: boolean;
	title?: string | null;
	description?: string | null;
	image?: string | null;
};

/* -------------------------------------------------------------------------- */
/*  QR codes                                                                   */
/* -------------------------------------------------------------------------- */

export type QrOptions = {
	/** CSS colour for the dark modules. */
	foreground: string;
	/** CSS colour for the background, or `transparent`. */
	background: string;
	/** Quiet-zone width, in modules. */
	margin: number;
	/** Rendered edge length in px. Only affects raster export. */
	size: number;
	errorCorrection: 'L' | 'M' | 'Q' | 'H';
	/** Rounded dots trade a little scanner tolerance for looks. */
	style: 'square' | 'rounded' | 'dots';
	/** Data URL of a logo drawn over the centre. */
	logo?: string | null;
	/** Logo edge length as a fraction of the code. Kept under 0.3 to stay scannable. */
	logoScale?: number | null;
};

export const DEFAULT_QR_OPTIONS: QrOptions = {
	foreground: '#000000',
	background: '#ffffff',
	margin: 2,
	size: 512,
	errorCorrection: 'M',
	style: 'square',
	logo: null,
	logoScale: 0.22
};

export function qrOptions(partial: Partial<QrOptions> | null | undefined): QrOptions {
	return { ...DEFAULT_QR_OPTIONS, ...(partial ?? {}) };
}

/* -------------------------------------------------------------------------- */
/*  Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

export type WebhookEvent =
	| 'link.created'
	| 'link.updated'
	| 'link.deleted'
	| 'link.archived'
	| 'link.clicked'
	| 'link.expired'
	| 'link.limit_reached'
	| 'conversion.recorded';

export const WEBHOOK_EVENTS: WebhookEvent[] = [
	'link.created',
	'link.updated',
	'link.deleted',
	'link.archived',
	'link.clicked',
	'link.expired',
	'link.limit_reached',
	'conversion.recorded'
];

/** The subscriber list published to KV, so the redirect path reads one key. */
export type WebhookSubscriber = {
	id: string;
	url: string;
	secret: string;
	events: WebhookEvent[];
};

/* -------------------------------------------------------------------------- */
/*  Redirect statuses                                                          */
/* -------------------------------------------------------------------------- */

export const REDIRECT_STATUSES = [301, 302, 307, 308] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];
