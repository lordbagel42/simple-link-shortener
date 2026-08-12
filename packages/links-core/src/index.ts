/**
 * The shared link core.
 *
 * Everything a short link needs between an incoming request and a 302, with no
 * framework attached: KV and D1 access, the click writer, the targeting-rule
 * evaluator, and the small HTML pages the redirect path can return.
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

export type { LinkRule } from './types.js';
export { RULE_TYPES } from './types.js';

export type { Env, WaitUntil } from './env.js';
export { shortHosts, shortPrefix, shortBase, shortUrlFor, appBase } from './env.js';

export { hashPassword, verifyPassword, newId, sha256Hex } from './crypto.js';

export type { ParsedUserAgent } from './user-agent.js';
export { parseUserAgent, refererDomain } from './user-agent.js';

export type { LinkRecord } from './link-record.js';
export {
	buildTargetUrl,
	linkState,
	readLinkRecord,
	putLinkRecord,
	writeLinkRecord,
	deleteLinkRecord,
	selectDestination
} from './link-record.js';

export type { VisitorSnapshot } from './clicks.js';
export { recordClick, snapshotVisitor } from './clicks.js';

export { findLinkBySlug, hasSeenVisitor, writeClick, disableLink } from './d1.js';

export { errorPage, passwordPage } from './pages.js';

export type { RedirectContext } from './redirect.js';
export { matchShortLink, isShortHost, notFoundResponse, resolveShortLink } from './redirect.js';
