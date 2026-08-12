/**
 * The shared link core.
 *
 * Everything a short link needs between an incoming request and a 302, with no
 * framework attached: KV and D1 access, the click writer, the targeting-rule
 * evaluator, the split-test picker, and the small HTML pages the redirect path
 * can return.
 *
 * Two Workers import this. The dashboard (`simple-link-shortener`) wraps it in
 * SvelteKit; the redirect Worker (`links-agent`) calls it directly. Keeping the
 * hot path here is what stops the two from drifting apart.
 *
 * The Drizzle schema is deliberately *not* re-exported from this barrel — it is
 * the only module with a runtime dependency on `drizzle-orm`, and pulling it in
 * here would drag the ORM into the redirect Worker's bundle for no reason.
 * Import it from `@lordbagel42/links-core/schema` instead.
 */

export type {
	LinkRule,
	LinkVariant,
	RuleType,
	RuleOperator,
	DeepLinkConfig,
	CloakConfig,
	QrOptions,
	WebhookEvent,
	WebhookSubscriber,
	RedirectStatus
} from './types.js';
export {
	RULE_TYPES,
	RULE_OPERATORS,
	WEBHOOK_EVENTS,
	REDIRECT_STATUSES,
	DEFAULT_QR_OPTIONS,
	qrOptions,
	hasDeepLink
} from './types.js';

export type { Env, WaitUntil } from './env.js';
export { shortHosts, shortPrefix, shortBase, shortUrlFor, appBase } from './env.js';

export { hashPassword, verifyPassword, newId, sha256Hex, timingSafeEqual } from './crypto.js';

export type { ParsedUserAgent } from './user-agent.js';
export { parseUserAgent, refererDomain } from './user-agent.js';

export type { LinkRecord, DomainRecord, VisitorContext, Selection } from './link-record.js';
export {
	DEFAULT_HOST_KEY,
	normalizeHost,
	linkKey,
	domainKey,
	buildTargetUrl,
	linkState,
	matchRule,
	pickVariant,
	readLinkRecord,
	readDomainRecord,
	putDomainRecord,
	deleteDomainRecord,
	putLinkRecord,
	toLinkRecord,
	toDomainRecord,
	writeLinkRecord,
	deleteLinkRecord,
	selectDestination
} from './link-record.js';

export type { VisitorSnapshot, ClickOutcome } from './clicks.js';
export { recordClick, snapshotVisitor } from './clicks.js';

export {
	findLinkBySlug,
	findDomainByHost,
	hasSeenVisitor,
	writeClick,
	writeWebhookDelivery,
	disableLink
} from './d1.js';

export type { WebhookPayload } from './webhooks.js';
export { webhookKey, readWebhooks, putWebhooks, dispatchWebhooks, sign } from './webhooks.js';

export { errorPage, passwordPage, cloakPage, hiddenReferrerPage, deepLinkPage } from './pages.js';

export type { RedirectContext } from './redirect.js';
export {
	matchShortLink,
	isShortHost,
	notFoundResponse,
	resolveRequest,
	resolveShortLink
} from './redirect.js';
