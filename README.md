# Links

A self-hosted link shortener that runs entirely on Cloudflare: short links are
served from a path on your main domain (`raygen.dev/l/*`) and from a dedicated
host (`link.raygen.dev/*`), and managed from a dashboard on its own subdomain
(`links.raygen.dev`).

- **Redirects are one KV read.** The hot path is handled in `hooks.server.ts`
  before SvelteKit routing, and analytics are written after the response is
  already on its way to the visitor.
- **Everything Cloudflare tells us about a click is stored** — 88 columns per
  click: geo, network, ASN, TLS, JA4, bot score, edge colo, client hints, fetch
  metadata, referrer, UTM and ad-click IDs, plus the routing decision the edge
  made and how long it took.
- **Any number of domains**, each with its own slug namespace, root redirect and
  404 destination.
- **Cloudflare-native throughout**: Workers, D1, KV, and (optionally) Analytics
  Engine. No external services.

Built with SvelteKit 2 + Svelte 5, Tailwind CSS 4, shadcn-svelte, Drizzle ORM,
and better-auth.

## Two Workers, two repositories

Redirects and the dashboard are deployed as **separate Workers**, because they
want opposite things from Cloudflare. The redirect Worker lives in its own
repository, [`lordbagel42/links-agent`](https://github.com/lordbagel42/links-agent).

| | `links-redirect` | `links` |
| --- | --- | --- |
| Repository | `lordbagel42/links-agent` | this one |
| Serves | `raygen.dev/l/*`, `link.raygen.dev/*` | `links.raygen.dev/*` |
| Placement | **Edge** — nearest the visitor | **Smart** — nearest D1 |
| Contains | KV read, redirect, deferred click write | SvelteKit, better-auth, the REST API |
| Bundle | ~23 KiB (8 KiB gzip) | ~3.4 MiB (620 KiB gzip) |

The dashboard makes several D1 round trips per page, so Smart Placement is a
clear win there. A redirect makes none on the response path — one edge-cached
KV read, then a 302 — so Smart Placement would only add the distance from the
visitor to D1's region. Placement is a per-Worker setting, so the only way to
have both is to have two Workers.

The redirect Worker also skips `nodejs_compat`, static assets, and every
dependency the dashboard needs. It reaches D1 through raw prepared statements
rather than Drizzle, which is what takes it from 203 KiB to 23 KiB — on a path
whose entire job is speed, bundle size is isolate start-up time.

## The shared core

Both Workers resolve links with the same code, published from this repository
as **`@lordbagel42/links-core`** on GitHub Packages (`packages/links-core`).
It holds everything between an incoming request and a 302 — KV and D1 access,
the targeting-rule evaluator, the click writer, the Drizzle schema, and the
small HTML pages the redirect path can return — with no framework attached.

The app keeps only the SvelteKit-shaped edges: `getEnv` in
`src/lib/server/env.ts` and `handleShortLink` in `src/lib/server/redirect.ts`.

Because the D1 statements are shared, a migration that touches `link` or
`click` needs a matching edit in `packages/links-core/src/d1.ts` and a new
release of the package.

Releases go out from `.github/workflows/release-core.yml`, which publishes on a
matching tag using the workflow's built-in `GITHUB_TOKEN` — no personal access
token needed to release:

```bash
npm version patch -w @lordbagel42/links-core --no-git-tag-version
git commit -am "release: links-core v0.1.1"
git tag links-core-v0.1.1 && git push --follow-tags
```

Consumers do need a token. GitHub Packages has no anonymous read, even for
public packages, so anything installing this — the
[`links-agent`](https://github.com/lordbagel42/links-agent) repository and its
Workers Builds job — needs `read:packages` exposed as `NODE_AUTH_TOKEN`.

This repository is not one of them: it resolves the package through the npm
workspace, so its own CI needs no registry credentials.

## How requests are routed

| Request | Handled by |
| --- | --- |
| `raygen.dev/l/<slug>` | `links-redirect` — KV lookup, 302, click logged via `waitUntil` |
| `link.raygen.dev/<slug>` | `links-redirect`, at the root of a dedicated host |
| `link.raygen.dev/l/<slug>` | Also works — the prefix is accepted everywhere |
| `link.raygen.dev/<anything else>` | 404, except `/` which bounces to the dashboard |
| `links.raygen.dev/*` | `links` — the dashboard and REST API |
| `raygen.dev/<anything else>` | Neither Worker's route — left to whatever else runs on the zone |

Matching happens in two layers.

The first is driven by two environment settings shared by both Workers, and
costs no lookup at all:

- **`SHORT_PREFIX`** (`/l`) matches `<prefix>/<slug>` on *any* host. That is what
  makes `raygen.dev/l/abc` work without claiming the rest of the apex, and what
  makes `localhost:5173/l/abc` behave identically in development.
- **`SHORT_HOSTS`** (comma-separated) lists hosts given over entirely to short
  links. On those, every single-segment path is a slug and nothing else is
  served — which is why `link.raygen.dev` can be a bare `/<slug>` domain while
  the apex cannot.

The apex is deliberately **not** in `SHORT_HOSTS`: it only answers under the
prefix, so the rest of `raygen.dev` stays untouched.

The second layer is the **domain table**. A domain registered in the dashboard
is published to KV, and the redirect Worker recognises it from there — including
its own path prefix, root redirect and 404 destination. Adding a domain needs a
Cloudflare route and nothing else: no redeploy, no `SHORT_HOSTS` edit.

The two layers exist because they cost different things. The environment
settings are a string comparison; the domain lookup is a KV read, which is why
the dashboard's hook only ever uses the first layer and the redirect Worker —
whose routes are short links and nothing else — pays for the second.

### Domains and slug namespaces

`link.slug` is unique per domain, not globally. The same slug on two domains is
two different links, and moving a link between domains is a slug reservation on
the new one. The user's **default** domain is special twice over: new links land
there when none is named, and its links are published to KV a second time under
a wildcard namespace, which is what makes `<SHORT_PREFIX>/<slug>` resolve on
hosts that are not registered domains — the dashboard's own `/l/*` fallback, and
`localhost:5173/l/*`.

## Features

**Links** — custom or generated slugs, titles, notes, tags, folders, enable and
disable, archive, `301`/`302`/`307`/`308` status choice, and QR codes with
custom colours, dot styles and an embedded logo.

**Domains** — register as many hostnames as you like. Slugs are unique *per
domain*, so `go/launch` and `link.example.com/launch` can point somewhere
different. Each domain has its own generated-slug length, default status code,
root redirect, unknown-slug redirect and expired-link redirect.

**Rules and limits** — expiry dates, click caps that disable the link when
reached, a fallback URL for expired links, password protection (PBKDF2 via Web
Crypto), query-string forwarding, and UTM tags appended on every redirect.

**Targeting** — route visitors by country, region, city, continent, device, OS,
browser, language, referrer, ASN, time zone or query string. Each rule picks its
own operator (`is`, `contains`, `starts with`, `ends with`, `is not`) and accepts
comma-separated alternatives. Rules are evaluated at the edge from the same KV
record as the redirect, so targeting costs nothing extra.

**Split testing** — weighted A/B/n arms, with each visitor pinned to their arm by
cookie so repeat clicks stay consistent. Every click records which arm served it.

**Deep links** — hand iOS and Android visitors to a native app, with a store or
web fallback when nothing opens it.

**Cloaking and privacy** — frame the destination so the short URL stays in the
address bar (with OpenGraph tags for previews), or bounce through a
`no-referrer` document so the destination never learns which link sent the
visitor.

**Conversions** — turn on tracking and the redirect appends `clid=<click id>` to
the destination. Post it back to `/api/v1/conversions` with an event name and a
value, and the outcome is attributed to that exact click — inheriting its
country, device, referrer and A/B arm.

**Webhooks** — HMAC-signed deliveries for `link.created`, `link.updated`,
`link.deleted`, `link.archived`, `link.clicked`, `link.limit_reached` and
`conversion.recorded`, fired after the response has already gone out.

**Analytics** — clicks, unique visitors, conversions and revenue over any window
(presets or an arbitrary `from`/`to`), bucketed hourly, daily, weekly or monthly,
with every metric compared against the preceding period. Thirty-seven breakdown
dimensions, a weekday-by-hour heatmap, a live event feed showing the raw IP and
user agent behind every click, and CSV export of the raw rows. Bots can be
included, excluded or isolated.

**API** — a REST API over links, bulk operations, CSV import and export,
domains, folders, webhooks, conversions, QR rendering and analytics, with bearer
tokens managed from Settings.

## Setup

### 1. Install and create the resources

```sh
npm install

npx wrangler d1 create link-shortener
npx wrangler kv namespace create LINKS
```

Copy the returned `database_id` and KV `id` into `wrangler.jsonc`, replacing the
`REPLACE_WITH_YOUR_…` placeholders, then regenerate the binding types:

```sh
npm run cf-typegen
```

### 2. Configure

Edit the `vars` block in `wrangler.jsonc`:

| Variable | Meaning |
| --- | --- |
| `APP_URL` | Public origin of the dashboard, e.g. `https://links.raygen.dev` |
| `SHORT_URL` | Base that generated links are built on, e.g. `https://raygen.dev/l` or `https://link.raygen.dev` |
| `SHORT_HOSTS` | Comma-separated hosts that serve slugs at their root and nothing else |
| `SHORT_PREFIX` | Path prefix that serves slugs on every host (`/l`) |
| `SIGNUP_MODE` | `open`, `invite`, or `closed` |
| `SIGNUP_ALLOWLIST` | Comma-separated emails or `@domain` suffixes for `invite` |

`SHORT_URL` seeds the first domain: on first sign-in the dashboard creates a
default domain from its hostname and path, and everything after that is managed
under **Settings → Domains**.

Then set the secrets:

```sh
npx wrangler secret put BETTER_AUTH_SECRET   # 32+ random characters
npx wrangler secret put VISITOR_HASH_SALT    # optional, defaults to the auth secret
```

**Set `VISITOR_HASH_SALT` on the redirect Worker too**, to the same value. Both
Workers hash visitors, and each falls back to `BETTER_AUTH_SECRET` and then to a
built-in constant — so if only one of them has a salt, the two disagree about
which visitors are new and unique counts drift.

Social login is enabled automatically when the matching pair of secrets exists:
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET`. Their callback URL is `$APP_URL/api/auth/callback/<provider>`.

### 3. Migrate and deploy

```sh
npm run db:migrate        # applies drizzle/ to the remote D1 database
npm run deploy            # the dashboard Worker
```

Upgrading an existing instance runs `0002_link_platform`, which adds the domain,
folder, conversion and webhook tables, widens `click` to 88 columns, and moves
slug uniqueness from global to per-domain. It backfills a default domain per user
with a placeholder hostname; the first dashboard page view after the migration
rewrites that placeholder from `SHORT_URL` and republishes every KV record, so
there is nothing to do by hand. Links keep resolving throughout — the redirect
path falls back to the default domain for any host it does not recognise.

The redirect Worker deploys from its own repository — see
[`lordbagel42/links-agent`](https://github.com/lordbagel42/links-agent). Both
must be deployed: they are separate scripts on Cloudflare, and this repository's
CI only builds the dashboard.

`workers_dev` is off on both, so there is no `*.workers.dev` URL to find:

```jsonc
// links-agent/wrangler.jsonc
"routes": [
  { "pattern": "link.raygen.dev", "custom_domain": true },
  { "pattern": "raygen.dev/l/*", "zone_name": "raygen.dev" }
]

// wrangler.jsonc
"routes": [
  { "pattern": "links.raygen.dev", "custom_domain": true }
]
```

**This will not disturb another Worker already serving `raygen.dev`.** The apex
entry is a zone route scoped to one path, not a custom domain — a custom domain
would claim the entire hostname. Cloudflare dispatches to the most specific
matching route, so an existing `raygen.dev/*` route keeps every path except
`/l/*`. The subdomains are custom domains, which is fine because nothing else
answers on them.

All three require `raygen.dev` to be an active zone **on the same Cloudflare
account as the Worker** — custom domains cannot cross accounts. The two
subdomain DNS records are created for you on first deploy. The `raygen.dev/l/*`
route is a zone route, so it only fires if the apex already resolves through
Cloudflare (an orange-clouded `A`/`AAAA`/`CNAME` record); since a Worker is
already serving the apex, that record exists.

### 4. Adding another domain later

Two steps, in either order:

1. Add a route to `links-agent/wrangler.jsonc` — a `custom_domain` entry for a
   host given over entirely to short links, or a `zone_name` path route to serve
   them under a prefix — and redeploy that Worker.
2. Register the hostname under **Settings → Domains**.

The second step is what creates the slug namespace and publishes the domain's
settings to KV. Nothing in this repository needs redeploying for it.

## Local development

```sh
cp .dev.vars.example .dev.vars   # local secrets and origin overrides
npm run db:migrate:local
npm run dev
```

Vite emulates D1, KV, and Analytics Engine from `wrangler.jsonc`, so the
dashboard runs at `http://localhost:5173` and short links resolve at
`http://localhost:5173/l/<slug>` — the dashboard keeps the same matching logic,
so you rarely need both processes. To exercise the real redirect Worker, run
`npm run dev` in a [`links-agent`](https://github.com/lordbagel42/links-agent)
checkout alongside this one.

Useful scripts:

| Script | Does |
| --- | --- |
| `npm run check` | Typecheck the whole project |
| `npm run db:generate` | Regenerate migrations after editing the schema |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |
| `npm run build -w @lordbagel42/links-core` | Compile the shared core |
| `npm publish -w @lordbagel42/links-core` | Release the shared core to GitHub Packages |

## API

Create a key under **Settings → API keys**, then send it as a bearer token.
Session cookies work too, which is what the dashboard's own import dialog uses.

```sh
curl https://links.raygen.dev/api/v1/links \
  -H "Authorization: Bearer lnk_…"

curl -X POST https://links.raygen.dev/api/v1/links \
  -H "Authorization: Bearer lnk_…" \
  -H "content-type: application/json" \
  -d '{
        "destination": "https://example.com/a/very/long/path",
        "slug": "launch",
        "tags": ["marketing"],
        "expiresAt": "2026-12-31T00:00:00Z",
        "trackConversions": true,
        "utm": { "source": "newsletter" },
        "rules": [
          { "type": "country", "op": "is", "value": "DE,AT,CH",
            "destination": "https://example.com/de" }
        ],
        "variants": [
          { "label": "A", "destination": "https://example.com/a", "weight": 50 },
          { "label": "B", "destination": "https://example.com/b", "weight": 50 }
        ]
      }'
```

### Links

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/v1/links` | List links (`search`, `tag`, `folder`, `domain`, `sort`, `status`, `limit`, `offset`) |
| `POST` | `/api/v1/links` | Create a link; `slug` is generated when omitted |
| `GET` | `/api/v1/links/:id` | Fetch one link; add `?analytics=1&range=30d` for stats |
| `PATCH` | `/api/v1/links/:id` | Update any subset of fields |
| `DELETE` | `/api/v1/links/:id` | Delete the link, its clicks and its conversions |
| `GET` | `/api/v1/links/:id/qr` | Render the QR as SVG (`fg`, `bg`, `style`, `margin`, `size`, `ec`, `track`) |
| `POST` | `/api/v1/links/bulk` | `action`: `create` (up to 1000), `delete`, `archive`, `tag` |
| `GET` | `/api/v1/links/export` | Every link as CSV, honouring the list filters |
| `POST` | `/api/v1/links/import` | Import `text/csv` or JSON; header names are matched loosely |

```sh
# 1000 links in one call
curl -X POST https://links.raygen.dev/api/v1/links/bulk \
  -H "Authorization: Bearer lnk_…" -H "content-type: application/json" \
  -d '{"action":"create","links":[{"destination":"https://example.com/1"}]}'

# an export is a valid import, which is how you move between instances
curl https://links.raygen.dev/api/v1/links/export -H "Authorization: Bearer lnk_…" > links.csv
curl -X POST https://links.raygen.dev/api/v1/links/import \
  -H "Authorization: Bearer lnk_…" -H "content-type: text/csv" --data-binary @links.csv
```

### Domains, folders, webhooks, conversions

| Method | Path | Does |
| --- | --- | --- |
| `GET` `POST` | `/api/v1/domains` | List and register domains |
| `GET` `PATCH` `DELETE` | `/api/v1/domains/:id` | Read, update, remove (removing takes its links with it) |
| `GET` `POST` | `/api/v1/folders` | List and create folders |
| `PATCH` `DELETE` | `/api/v1/folders/:id` | Rename, recolour, delete (links survive) |
| `GET` `POST` | `/api/v1/webhooks` | List and create; the secret is returned exactly once |
| `PATCH` `POST` `DELETE` | `/api/v1/webhooks/:id` | Update, send a test delivery, remove |
| `GET` `POST` | `/api/v1/conversions` | List and report conversions |

### Analytics

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/v1/analytics` | Totals, previous-period totals, time series, heatmap and every breakdown |
| `GET` | `/api/v1/analytics/export` | Every click in the window as CSV — all 88 columns |

Both accept the same scope and window parameters:

| Parameter | Meaning |
| --- | --- |
| `link`, `domain`, `folder` | Narrow the scope |
| `range` | `today`, `24h`, `7d`, `30d`, `90d`, `12m`, `all` |
| `from`, `to` | An arbitrary window; anything `Date.parse` understands, or epoch ms |
| `interval` | `hour`, `day`, `week`, `month` — otherwise chosen from the window |
| `bots` | `all` (default), `exclude`, `only` |
| `include` | `clicks` adds the raw event feed, `top` adds the per-link rollup |

### Webhooks

Every delivery is a `POST` with a JSON body and an
`X-Links-Signature: t=<unix seconds>,v1=<hex>` header. The HMAC-SHA256 covers
`<t>.<body>` using the secret shown when the webhook was created, so a captured
delivery cannot be replayed against a different payload or timestamp:

```js
const [t, v1] = signature.split(',').map((part) => part.split('=')[1]);
const expected = hmacSha256Hex(secret, `${t}.${rawBody}`);
// then compare `expected` with `v1` in constant time
```

### Conversions

Turn on **Track conversions** for a link and every redirect gains a `clid`
parameter. Capture it on your side — usually into a cookie at the landing page —
and report the outcome when it happens:

```sh
curl -X POST https://links.raygen.dev/api/v1/conversions \
  -H "Authorization: Bearer lnk_…" -H "content-type: application/json" \
  -d '{"clid":"…","event":"purchase","value":49.5,"currency":"USD"}'
```

## Analytics Engine

There is nothing to provision. The dataset is created the first time the Worker
writes to it, so the `analytics_engine_datasets` binding in `wrangler.jsonc` is
the entire setup. `binding` is the name the Worker code uses; `dataset` is the
table name you `SELECT ... FROM` — here they are deliberately the same:

```jsonc
"analytics_engine_datasets": [
  { "binding": "CLICKS_AE", "dataset": "CLICKS_AE" }
]
```

`recordClick()` writes one data point per click, skipping the call entirely when
the binding is absent. Each point carries one index (the link id) plus:

| Field | Contents |
| --- | --- |
| `blob1`–`blob10` | slug, user id, country, city, device, OS, browser, referrer domain, colo, destination |
| `double1` | always `1`, so `sum(double1)` counts clicks |
| `double2` | `1` for bot traffic, `0` otherwise |
| `double3` | ASN |

Reading is a separate step, because querying is not part of the binding. Create
an API token with the **Account Analytics Read** permission, then POST SQL to
the account endpoint:

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" \
  --data "SELECT blob1 AS slug, blob3 AS country, sum(double1) AS clicks
          FROM CLICKS_AE
          WHERE timestamp > NOW() - INTERVAL '7' DAY
          GROUP BY slug, country
          ORDER BY clicks DESC"
```

Worth knowing before you lean on it: **data is retained for three months**, a
data point allows at most 20 blobs, 20 doubles, and 1 index, and sampling kicks
in at high volume — `sum(_sample_interval)` rather than `count()` is the honest
row count once that happens. The dashboard deliberately does not read from here;
it queries D1, which keeps everything and needs no extra token.

One thing I could not confirm from Cloudflare's docs: whether Analytics Engine
requires a paid Workers plan. If `writeDataPoint` silently drops everything on a
free account, that is the first thing to check.

## Design notes

**KV is a cache, D1 is the truth.** Every write republishes the link's KV
record. A KV miss falls back to D1 and repopulates the cache, so the system
heals itself after an eviction or a restored database. Settings has a **Resync
edge cache** button that republishes everything.

**Edits take up to a minute to propagate.** KV records are read with a 60-second
edge TTL, which is KV's own floor.

**Click caps overshoot slightly.** The cap is enforced against the D1 counter
after each click, then pushed back into KV — a handful of clicks can land in the
window before every colo sees the update.

**Permanent redirects hide repeat clicks.** `301`/`308` are cached by browsers,
so those visitors never hit the Worker again. `302` is the default for that
reason.

**Raw IPs are stored.** Every click keeps the client address from
`cf-connecting-ip` and the full user-agent string in `click.ip` /
`click.user_agent`, so the event feed can show exactly who hit a link. Alongside
them sit client hints, a JA3/JA4 TLS fingerprint, and coarse coordinates. That
is a lot of personal data under GDPR and similar regimes — if you publish links
to visitors in those jurisdictions, say so in your privacy notice and prune the
`click` table on whatever retention schedule you have committed to. `dnt` and
`sec-gpc` are recorded rather than honoured; acting on them is your call, and
the columns are there so you can.

**Cloaking depends on the destination.** Framing only works if the destination
does not send `X-Frame-Options` or a framing CSP — plenty of sites do, and there
is nothing a shortener can do about it. The cloak page carries an "open
directly" link so a blocked frame is not a dead end.

**Split tests are sticky per browser, not per person.** The arm is pinned with a
30-day cookie keyed on the link id, so a visitor who clears cookies or switches
device can land on the other arm. The roll itself is stored rather than the arm
index, which means re-weighting a live test moves the boundary without
reshuffling everyone already in it.

**Conversions are exact, not modelled.** `clid` is the click's own primary key,
so an attributed conversion inherits that click's country, device, referrer and
A/B arm with no join and no guesswork. The trade is that it only works if your
destination actually keeps the parameter.

**Webhooks cost nothing when unused.** The subscriber list lives in one KV key
per user, read inside `waitUntil` after the response has gone out, and a user
with no webhooks has no key at all.

**Analytics is 37 queries in one batch.** Each breakdown dimension is its own
`GROUP BY` against `click`, sent to D1 as a single batch. The obvious
alternative — one `UNION ALL` over every dimension — is not available: workerd's
SQLite is built with a small `SQLITE_MAX_COMPOUND_SELECT` and rejects a union of
even eight branches.

**Analytics Engine is optional.** When the `CLICKS_AE` binding exists each click
is mirrored there as well. D1 is the source of truth and the only thing the
dashboard reads; Analytics Engine is for ad-hoc SQL over high-cardinality data
that would be slow to aggregate in D1. Note that it keeps data for **three
months**, so it is a query surface, not an archive — D1 is what retains history.
Delete the `analytics_engine_datasets` block to turn it off.
