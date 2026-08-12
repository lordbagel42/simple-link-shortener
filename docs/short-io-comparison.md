# Short.io feature comparison

A feature-by-feature audit of [Short.io](https://short.io) against this project
(the `links` dashboard + `links-agent` redirect Worker + `@lordbagel42/links-core`).

Short.io's side is drawn from its [feature list](https://short.io/features/),
[pricing page](https://short.io/pricing/), [integrations page](https://short.io/integrations/)
and [developer docs](https://developers.short.io/), as of August 2026. This
project's side is drawn from the code, not the README — where the two disagree
the code wins.

Legend: ✅ present · ⚠️ partial or different in kind · ❌ absent

---

## 1. Link creation and organisation

| Feature | Short.io | Here | Notes |
| --- | --- | --- | --- |
| Custom slug | ✅ | ✅ | `validateSlug` in `src/lib/slug.ts` |
| Auto-generated slug | ✅ | ✅ | Short.io lets you pick the generator per domain; here it is one fixed algorithm |
| AI slug generation | ✅ | ❌ | Metered against a per-plan AI budget |
| Edit destination without changing the short URL | ✅ | ✅ | |
| Title | ✅ | ✅ | |
| Description / notes | ⚠️ | ✅ | Short.io exposes OpenGraph fields instead of a free-text note |
| Tags | ✅ | ✅ | Short.io also has a bulk "append tag to N links" endpoint |
| Folders | ✅ | ❌ | 3–unlimited by plan; here tags are the only grouping |
| Archive (hidden from dashboard, still resolves) | ✅ | ❌ | |
| Enable / disable (stops resolving) | ❌ | ✅ | Different semantics from archive — this is a kill switch |
| Duplicate detection on create | ✅ | ❌ | Short.io returns the existing link, or `409` on a slug collision with a different target |
| OpenGraph override per link | ✅ | ❌ | `GET`/`PUT /links/opengraph/{domainId}/{linkId}` |
| Link bundles (link-in-bio page) | ✅ | ❌ | |
| Bulk import / export of links | ✅ | ❌ | Includes a Bitly importer |

## 2. Redirect behaviour

| Feature | Short.io | Here | Notes |
| --- | --- | --- | --- |
| Per-link status code (301/302/307/308) | ⚠️ | ✅ | Short.io exposes "301 redirect optimization"; here it is an explicit per-link field |
| Query-string forwarding | ✅ | ✅ | `forwardQuery` |
| UTM tags appended on redirect | ✅ | ✅ | Short.io ships a UTM builder UI |
| Expiration date | ✅ | ✅ | Pro on Short.io; `expiresAt` here |
| Click-limit expiration | ✅ | ✅ | Pro on Short.io; `maxClicks` here, which disables the link |
| Custom destination for expired links | ✅ | ✅ | `fallbackUrl`, otherwise a 410 page |
| Password protection | ✅ | ✅ | Pro on Short.io, with a branded gateway page; PBKDF2 via Web Crypto here |
| Link cloaking (destination hidden in the address bar) | ✅ | ❌ | Pro |
| Referrer hiding | ✅ | ❌ | Hobby+ |
| Deep links (open the native app when installed) | ✅ | ❌ | Team |
| A/B testing / split traffic | ✅ | ❌ | |
| End-to-end encrypted links | ✅ | ❌ | Team |
| Main-page redirect (root of a short domain) | ✅ | ⚠️ | Here `/` on a short host bounces to the dashboard; not configurable |
| Configurable 404 destination | ✅ | ❌ | Here a 404 is a fixed page |

## 3. Targeting

| Rule type | Short.io | Here |
| --- | --- | --- |
| Country | ✅ | ✅ |
| Region / state | ✅ (Team) | ❌ |
| Continent | ❌ | ✅ |
| Device type | ✅ | ✅ |
| OS (iOS / Android) | ✅ | ✅ |
| Browser language | ❌ | ✅ |
| Referrer | ❌ | ✅ |

Both evaluate rules before falling through to the default destination. Here the
rules ride in the same KV record as the redirect (`selectDestination` in
`packages/links-core/src/link-record.ts`), so targeting costs no extra I/O;
Short.io models them as separate `link-country` / `link-region` resources with
their own endpoints, including bulk creation.

## 4. QR codes

| Feature | Short.io | Here |
| --- | --- | --- |
| Generate a QR for any link | ✅ | ✅ |
| PNG export | ✅ | ✅ |
| SVG export | ✅ | ✅ |
| Custom colours | ✅ | ❌ |
| Embedded logo | ✅ | ❌ |
| Additional export formats (PDF/EPS) | ✅ | ❌ |
| Bulk QR generation via API | ✅ | ❌ |

Both are "dynamic" in the sense that matters — the QR encodes the short link, so
editing the destination does not invalidate printed codes.

## 5. Analytics

| Metric / capability | Short.io | Here |
| --- | --- | --- |
| Clicks over time | ✅ | ✅ |
| Unique visitors | ✅ | ✅ (salted hash of IP + user agent) |
| Country | ✅ | ✅ |
| City | ✅ | ✅ |
| Region | ✅ | ⚠️ stored, not charted |
| Referrer | ✅ | ✅ |
| Device / browser / OS | ✅ | ✅ |
| Browser language | ❌ | ✅ |
| Cloudflare edge colo | ❌ | ✅ |
| ASN / network operator | ❌ | ✅ |
| TLS version, cipher, HTTP protocol, TCP RTT | ❌ | ⚠️ stored, not charted |
| Bot classification | ⚠️ | ✅ (`isBot`, `botScore`, `verifiedBotCategory`) |
| Raw click feed with IP and user agent | ✅ ("clickstream") | ✅ |
| Arbitrary date ranges | ✅ | ❌ — fixed presets: 24h / 7d / 30d / 90d / all |
| Domain-level statistics | ✅ | ❌ |
| Conversion tracking (`clid` param + conversion API) | ✅ | ❌ |
| Real-time conversion streaming | ✅ | ❌ |
| Retargeting pixels (Meta Pixel, AdRoll, GTM) | ✅ | ❌ |
| Google Analytics passthrough | ✅ | ❌ |
| CSV export | ✅ | ❌ |
| Raw S3 data export | ✅ (Enterprise) | ❌ — but you own the D1 database |
| Clear statistics | ✅ | ❌ |
| Retention | by plan | unlimited in D1; 3 months in Analytics Engine |

The shape of the difference: Short.io is deeper on *marketing* analytics
(conversions, pixels, ad platforms), this is deeper on *request* analytics
(everything `request.cf` knows — ASN, colo, TLS, bot score, TCP RTT).

## 6. Domains

| Feature | Short.io | Here |
| --- | --- | --- |
| Multiple custom domains per account | ✅ (5 → unlimited) | ❌ |
| Per-domain settings | ✅ | ❌ |
| Per-domain slug-generation algorithm | ✅ | ❌ |
| Free SSL | ✅ (Let's Encrypt) | ✅ (Cloudflare) |
| Subdomains | ✅ | ✅ |
| Path-prefix links on an existing site | ❌ | ✅ (`SHORT_PREFIX`, e.g. `raygen.dev/l/*`) |
| Domain statistics | ✅ | ❌ |

This is the largest structural gap. `SHORT_HOSTS` / `SHORT_PREFIX` are
instance-wide environment variables and `link.slug` has a global unique index —
there is no `domain` table, so every link in an instance lives in one namespace.
Multi-domain support would be a schema change, not a setting.

## 7. Teams, accounts and permissions

| Feature | Short.io | Here |
| --- | --- | --- |
| Multiple users | ✅ | ⚠️ users exist but each one's links are a private silo |
| Shared workspace | ✅ | ❌ |
| Roles (Admin / User / Read-only) | ✅ | ❌ |
| Per-link permissions | ✅ | ❌ |
| Multiple teams | ✅ (Enterprise) | ❌ |
| SSO | ✅ (Enterprise) | ❌ |
| Social login (GitHub / Google) | ✅ | ✅ |
| Signup gating (open / invite / closed) | n/a | ✅ |

## 8. API

| Feature | Short.io | Here |
| --- | --- | --- |
| REST API | ✅ ~40 endpoints | ✅ 5 endpoints |
| Create / read / update / delete a link | ✅ | ✅ |
| List with search, filter, sort, paging | ✅ | ✅ |
| Per-link analytics | ✅ | ✅ (`?analytics=1&range=30d`) |
| Bulk create (up to 1000 per call) | ✅ | ❌ |
| Bulk delete / archive / tag / QR | ✅ | ❌ |
| Lookup by original URL | ✅ | ❌ |
| Lookup by path | ✅ | ⚠️ only by id |
| Folder endpoints | ✅ | ❌ |
| Domain endpoints | ✅ | ❌ |
| Statistics endpoints (top-N by column, by interval, last clicks) | ✅ | ⚠️ one aggregate summary |
| Public (client-side-safe) API key | ✅ | ❌ |
| Documented rate limits | ✅ (20–50/s per endpoint) | ❌ none enforced |
| Webhooks | ✅ | ❌ |
| GET-only creation endpoint (address-bar / Tweetbot style) | ✅ | ❌ |

## 9. Integrations

Short.io ships Zapier, Make, Slack (`/shorten`), Segment, WordPress, Google
Analytics, Google Ads, Meta Pixel, Mailchimp, a Chrome extension, a Firefox
extension, iOS / macOS / Android apps, and a Bitly importer.

This project ships none of them. The REST API is the whole integration surface —
which is enough to build a Zap or a Slack command against, but nothing is
pre-built.

## 10. Platform and operations

| | Short.io | Here |
| --- | --- | --- |
| Hosting | SaaS | self-hosted on Cloudflare |
| Data ownership | Short.io's database | your D1 |
| Cost | $0 / $5 / $18 / $48 / $148 per month | Cloudflare usage only |
| Link cap | 1,000 free → unlimited on Pro | none |
| Tracked-click cap | 50,000/mo free → unlimited on Pro | none |
| Conversions cap | 50/mo free → unlimited on Pro | n/a |
| Storage quota | 10 MB → 200 GB | n/a |
| Uptime SLA | 99.9% (Team+) | none |
| Support | chat, all plans | none |
| Redirect latency | their edge | one edge-cached KV read, Worker on Edge placement |
| GDPR posture | compliance advertised | raw IPs are stored — your notice, your retention policy |

---

## Where this project already wins

1. **You own the data.** Every click row is in your D1 database, retained
   forever, queryable with SQL. Short.io sells raw export as an Enterprise
   feature.
2. **No caps.** Unlimited links, unlimited tracked clicks, no per-seat pricing.
   Short.io's free tier stops at 1,000 links and 50,000 clicks a month, and
   password protection, expiration and cloaking are all paid.
3. **Deeper request telemetry.** ASN, AS organisation, Cloudflare colo, TLS
   version and cipher, HTTP protocol, TCP RTT, bot score and verified-bot
   category are all captured per click. Short.io exposes none of these.
4. **Targeting dimensions Short.io does not have**: continent, browser language,
   and referrer.
5. **Explicit per-link redirect status.** 301/302/307/308 is a field, not a
   domain-wide optimisation toggle.
6. **Path-prefix deployment.** `raygen.dev/l/*` works without giving the apex
   over to the shortener. Short.io needs a domain or subdomain.
7. **An enable/disable kill switch** with a fallback URL, which is not the same
   thing as Short.io's archive.

## The gaps worth ranking

Ordered by how much they constrain the product, not by how hard they are:

1. **Multiple domains.** Schema-level. Everything else on this list is additive;
   this one is not, and it is the difference between "my shortener" and
   "a shortener".
2. **Bulk API operations.** Bulk create is the single most-used Short.io API
   feature and the cheapest of these to add.
3. **Folders and archive.** Tags plus a global list stops scaling somewhere
   around a few hundred links.
4. **CSV export and arbitrary date ranges.** The data is already in D1; this is
   a query and a download handler.
5. **Webhooks.** The redirect Worker already has a `waitUntil` hook where a POST
   would fit.
6. **Conversion tracking.** A `clid` parameter, a conversions table, and one
   ingest endpoint. This is the feature Short.io leads with and the largest
   analytics gap.
7. **Teams and shared links.** `link.userId` is a foreign key to `user`; making
   it a workspace is a migration plus permission checks in `links.ts`.
8. **Link cloaking, deep links, A/B testing.** All redirect-path features, all
   implementable in `selectDestination` / `resolveShortLink`, none of them
   structural.
9. **QR customisation.** Colours and a logo, client-side, in `qr-dialog.svelte`.
10. **Pre-built integrations.** Chrome extension, Slack command, Zapier app.
    Pure surface area — the API already supports all of it.

## Sources

- <https://short.io/features/>
- <https://short.io/pricing/>
- <https://short.io/integrations/>
- <https://developers.short.io/> and <https://developers.short.io/llms.txt>
- <https://docs.short.io/>
