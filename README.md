# Links

A self-hosted link shortener that runs entirely on Cloudflare: short links are
served from a path on your main domain (`raygen.dev/l/*`) and from a dedicated
host (`link.raygen.dev/*`), and managed from a dashboard on its own subdomain
(`links.raygen.dev`).

- **Redirects are one KV read.** The hot path is handled in `hooks.server.ts`
  before SvelteKit routing, and analytics are written after the response is
  already on its way to the visitor.
- **Everything Cloudflare tells us about a click is stored** — geo, network,
  ASN, TLS, edge colo, device, browser, referrer, language, and UTM tags.
- **Cloudflare-native throughout**: Workers, D1, KV, and (optionally) Analytics
  Engine. No external services.

Built with SvelteKit 2 + Svelte 5, Tailwind CSS 4, shadcn-svelte, Drizzle ORM,
and better-auth.

## Two Workers

Redirects and the dashboard are deployed as **separate Workers**, because they
want opposite things from Cloudflare.

| | `links-redirect` | `links` |
| --- | --- | --- |
| Serves | `raygen.dev/l/*`, `link.raygen.dev/*` | `links.raygen.dev/*` |
| Placement | **Edge** — nearest the visitor | **Smart** — nearest D1 |
| Contains | KV read, redirect, deferred click write | SvelteKit, better-auth, the REST API |
| Bundle | ~23 KiB (8 KiB gzip) | ~3.4 MiB (620 KiB gzip) |
| Config | `workers/redirect/wrangler.jsonc` | `wrangler.jsonc` |

The dashboard makes several D1 round trips per page, so Smart Placement is a
clear win there. A redirect makes none on the response path — one edge-cached
KV read, then a 302 — so Smart Placement would only add the distance from the
visitor to D1's region. Placement is a per-Worker setting, so the only way to
have both is to have two Workers.

The redirect Worker also skips `nodejs_compat`, static assets, and every
dependency the dashboard needs. It reaches D1 through raw prepared statements
rather than Drizzle, which is what takes it from 203 KiB to 23 KiB — on a path
whose entire job is speed, bundle size is isolate start-up time. Those
statements live in `src/lib/server/d1.ts`; a migration that touches `link` or
`click` needs a matching edit there.

Both Workers import the same matching and resolution logic from
`src/lib/server/redirect.ts`, so the two cannot drift.

## How requests are routed

| Request | Handled by |
| --- | --- |
| `raygen.dev/l/<slug>` | `links-redirect` — KV lookup, 302, click logged via `waitUntil` |
| `link.raygen.dev/<slug>` | `links-redirect`, at the root of a dedicated host |
| `link.raygen.dev/l/<slug>` | Also works — the prefix is accepted everywhere |
| `link.raygen.dev/<anything else>` | 404, except `/` which bounces to the dashboard |
| `links.raygen.dev/*` | `links` — the dashboard and REST API |
| `raygen.dev/<anything else>` | Neither Worker's route — left to whatever else runs on the zone |

Matching is driven by two settings, shared by both Workers:

- **`SHORT_PREFIX`** (`/l`) matches `<prefix>/<slug>` on *any* host. That is what
  makes `raygen.dev/l/abc` work without claiming the rest of the apex, and what
  makes `localhost:5173/l/abc` behave identically in development.
- **`SHORT_HOSTS`** (comma-separated) lists hosts given over entirely to short
  links. On those, every single-segment path is a slug and nothing else is
  served — which is why `link.raygen.dev` can be a bare `/<slug>` domain while
  the apex cannot.

The apex is deliberately **not** in `SHORT_HOSTS`: it only answers under the
prefix, so the rest of `raygen.dev` stays untouched.

## Features

**Links** — custom or generated slugs, titles, tags, notes, enable/disable,
`301`/`302`/`307`/`308` status choice, QR codes (PNG and SVG).

**Rules and limits** — expiry dates, click caps that disable the link when
reached, a fallback URL for expired links, password protection (PBKDF2 via Web
Crypto), query-string forwarding, and UTM tags appended on every redirect.

**Targeting** — route visitors to different destinations by country, continent,
device, OS, language, or referrer. Rules are evaluated at the edge from the same
KV record as the redirect, so targeting costs nothing extra.

**Analytics** — clicks and unique visitors over time, plus breakdowns by
country, city, referrer, device, browser, OS, language, Cloudflare edge
location, and network, with a live event feed showing the raw IP and user agent
behind every click. Unique visitors are counted with a salted per-link hash of
IP + user agent, stored alongside the raw values.

**API** — `/api/v1/links` with bearer-token API keys managed from Settings.

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

Then set the secrets:

```sh
npx wrangler secret put BETTER_AUTH_SECRET   # 32+ random characters
npx wrangler secret put VISITOR_HASH_SALT    # optional, defaults to the auth secret
```

Social login is enabled automatically when the matching pair of secrets exists:
`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET`. Their callback URL is `$APP_URL/api/auth/callback/<provider>`.

### 3. Migrate and deploy

```sh
npm run db:migrate        # applies drizzle/ to the remote D1 database
npm run deploy            # the dashboard Worker
npm run deploy:redirect   # the redirect Worker
```

Both Workers must be deployed — they are separate scripts on Cloudflare, and a
CI job pointed at the repository root only builds the dashboard. Point a second
build at `workers/redirect/wrangler.jsonc`, or run `npm run deploy:redirect`
by hand.

`workers_dev` is off on both, so there is no `*.workers.dev` URL to find:

```jsonc
// workers/redirect/wrangler.jsonc
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

## Local development

```sh
cp .dev.vars.example .dev.vars   # local secrets and origin overrides
npm run db:migrate:local
npm run dev
```

Vite emulates D1, KV, and Analytics Engine from `wrangler.jsonc`, so the
dashboard runs at `http://localhost:5173` and short links resolve at
`http://localhost:5173/l/<slug>` — the dashboard keeps the same matching logic,
so you rarely need both processes. To exercise the real redirect Worker:

```sh
npm run dev:redirect   # wrangler dev on port 5174, same local D1 and KV
```

Useful scripts:

| Script | Does |
| --- | --- |
| `npm run check` | Typecheck the whole project |
| `npm run db:generate` | Regenerate migrations after editing the schema |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |
| `npm run dev:redirect` | Run the redirect Worker against the same local D1 and KV |
| `npm run deploy:redirect` | Deploy the redirect Worker |

## API

Create a key under **Settings → API keys**, then send it as a bearer token.

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
        "utm": { "source": "newsletter" }
      }'
```

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/v1/links` | List links (`search`, `tag`, `sort`, `status`, `limit`, `offset`) |
| `POST` | `/api/v1/links` | Create a link; `slug` is generated when omitted |
| `GET` | `/api/v1/links/:id` | Fetch one link; add `?analytics=1&range=30d` for stats |
| `PATCH` | `/api/v1/links/:id` | Update any subset of fields |
| `DELETE` | `/api/v1/links/:id` | Delete the link and its click history |

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
`click.user_agent`, so the event feed can show exactly who hit a link. That is
personal data under GDPR and similar regimes — if you publish links to visitors
in those jurisdictions, say so in your privacy notice and prune the `click`
table on whatever retention schedule you have committed to.

**Analytics Engine is optional.** When the `CLICKS_AE` binding exists each click
is mirrored there as well. D1 is the source of truth and the only thing the
dashboard reads; Analytics Engine is for ad-hoc SQL over high-cardinality data
that would be slow to aggregate in D1. Note that it keeps data for **three
months**, so it is a query surface, not an archive — D1 is what retains history.
Delete the `analytics_engine_datasets` block to turn it off.
