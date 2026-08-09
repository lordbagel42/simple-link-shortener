# Links

A self-hosted link shortener that runs entirely on Cloudflare: short links are
served from a path on your main domain (`raygen.dev/l/*`) and managed from a
dashboard on its own subdomain (`links.raygen.dev`).

- **Redirects are one KV read.** The hot path is handled in `hooks.server.ts`
  before SvelteKit routing, and analytics are written after the response is
  already on its way to the visitor.
- **Everything Cloudflare tells us about a click is stored** — geo, network,
  ASN, TLS, edge colo, device, browser, referrer, language, and UTM tags.
- **Cloudflare-native throughout**: Workers, D1, KV, and (optionally) Analytics
  Engine. No external services.

Built with SvelteKit 2 + Svelte 5, Tailwind CSS 4, shadcn-svelte, Drizzle ORM,
and better-auth.

## How requests are routed

| Request | Handled by |
| --- | --- |
| `raygen.dev/l/<slug>` | Redirect path — KV lookup, 302, click logged via `waitUntil` |
| `raygen.dev/<anything else>` | 404 (the Worker route only covers `/l/*`) |
| `links.raygen.dev/*` | The management dashboard and REST API |

Both hostnames are the same Worker. `SHORT_HOST` / `SHORT_PREFIX` decide which
requests are treated as short links, so you can serve slugs from the root of a
dedicated domain instead by setting `SHORT_PREFIX` to `/`.

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
location, and network, with a live event feed. Visitors are counted with a
salted per-link hash of IP + user agent; raw IP addresses are never stored.

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
| `SHORT_URL` | Base short links are built on, e.g. `https://raygen.dev/l` |
| `SHORT_HOST` | Hostname that serves short links and nothing else |
| `SHORT_PREFIX` | Path prefix for slugs (`/l`, or `/` to use the host root) |
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
npm run db:migrate      # applies drizzle/ to the remote D1 database
npm run deploy
```

Finally, uncomment the `routes` block in `wrangler.jsonc` and point it at your
zone:

```jsonc
"routes": [
  { "pattern": "links.raygen.dev", "custom_domain": true },
  { "pattern": "raygen.dev/l/*", "zone_name": "raygen.dev" }
]
```

## Local development

```sh
cp .dev.vars.example .dev.vars   # local secrets and origin overrides
npm run db:migrate:local
npm run dev
```

Vite emulates D1, KV, and Analytics Engine from `wrangler.jsonc`, so the
dashboard runs at `http://localhost:5173` and short links resolve at
`http://localhost:5173/l/<slug>`.

Useful scripts:

| Script | Does |
| --- | --- |
| `npm run check` | Typecheck the whole project |
| `npm run db:generate` | Regenerate migrations after editing the schema |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |

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

**Analytics Engine is optional.** When the `CLICKS_AE` binding exists each click
is also written there for cheap long-term retention. The dashboard always reads
from D1; delete the `analytics_engine_datasets` block to turn it off.
