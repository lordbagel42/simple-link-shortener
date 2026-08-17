# Links

A self-hosted link shortener on Cloudflare Workers, D1 and KV. A redirect is one
KV read and a 302; the click is written after the visitor is already on their way.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lordbagel42/simple-link-shortener)

This repository is the dashboard and API. The redirect Worker is
[`links-agent`](https://github.com/lordbagel42/links-agent), and shares this
repository's resolution code as `@lordbagel42/links-core` (`packages/links-core`).
It's an optimisation — the dashboard resolves short links on its own too.

SvelteKit 2, Svelte 5, Tailwind 4, shadcn-svelte, Drizzle, better-auth.

## Features

**Links** — custom or generated slugs, titles, notes, up to 12 tags,
enable/disable, `301`/`302`/`307`/`308` per link, QR codes as PNG or SVG, and a
duplicate action that opens the create dialog prefilled from an existing link.
Generated slugs skip `0`, `1`, `i`, `l` and `o`. Reserved words like `api` and
`login` are refused.

**Several slugs per link** — one link can answer to any number of slugs, all
reaching the same destination and sharing one set of analytics. Each is its own
KV key, so an alias resolves in the same single read as the primary. `link.slug`
is the primary, which is what the dashboard shows and what QR codes point at.

**Pattern slugs** — `f/:form` matches `/f/anything` and passes what it captured
to the destination, `https://forms.example.com/form/:form`. A trailing `*` takes
the rest of the path. Patterns always start with a literal segment, so a plain
one-segment link can never be shadowed by one — or pay for the lookup. They live
in a single KV value, read only when an exact lookup misses on a multi-segment
path.

**Link previews** — what Slack, Discord and iMessage unfurl. Per link: the
destination's own Open Graph card, fetched once and re-served under the short
URL, or a branded card built from the link's title, notes and an image. Password
links always unfurl as a card that gives nothing away. Anything unresolvable
falls back to the redirect, and previews aren't counted as clicks.

**Rules and limits**

| | |
| --- | --- |
| Expiry | Stops resolving on a date. The KV record gets a matching TTL. |
| Click cap | Disables the link once it's hit. |
| Fallback URL | Where expired, capped or disabled visitors go. Otherwise a 410 page. |
| Password | PBKDF2-SHA256, 100k iterations. The form is served from the edge, no app bundle. |
| Query forwarding | Passes the short link's parameters to the destination. The destination's own win. |
| UTM tags | Appended on every redirect. |

**Targeting** — send visitors to different destinations by country, continent,
device, OS, language or referrer. First match wins, 20 rules per link.
Evaluated at the edge from the same KV record as the redirect.

**Analytics** — clicks, unique visitors and bot share over 24h / 7d / 30d / 90d
/ all time, with breakdowns by country, city, referrer, device, browser, OS,
language, Cloudflare colo, network and destination served. Plus a live feed of
the last 50 clicks showing the raw IP and user agent.

Every field Cloudflare gives us is stored: geo, ASN, TLS, colo, bot score,
protocol, TCP RTT, language, referrer, UTM tags and the incoming query string.
Unique visitors are a salted per-link hash of IP + user agent.

**Accounts** — email and password via better-auth, plus GitHub and Google when
their client secrets are set. `SIGNUP_MODE` is `open`, `invite` (against an
allowlist of emails or `@domain` suffixes) or `closed`. Defaults to `invite`.

**Passkeys** — Touch ID, Windows Hello, Android, or a security key, added and
named in Settings. The login page offers them from the email field where the
browser supports it, and from a button where it doesn't. Only public keys are
stored, so this table is worth nothing to anyone who reads it. Passkeys are
bound to `APP_URL`'s hostname: change the dashboard's domain and the ones
already registered stop resolving.

**API** — `/api/v1/links` with bearer-token keys, managed in Settings.

## Setup

The button forks the repo, provisions D1 and KV, and connects Workers Builds.
Three things it can't do: point `wrangler.jsonc` at your domain, set
`BETTER_AUTH_SECRET`, and run the migrations. To do all of it by hand:

```sh
npm install
npx wrangler d1 create link-shortener
npx wrangler kv namespace create LINKS
```

Put the returned `database_id` and KV `id` into `wrangler.jsonc`, then
`npm run cf-typegen`.

Edit the `vars` block:

| Variable | Meaning |
| --- | --- |
| `APP_URL` | Dashboard origin, e.g. `https://links.example.com` |
| `SHORT_URL` | Base for generated links, e.g. `https://example.com/l` |
| `SHORT_HOSTS` | Comma-separated hosts serving slugs at their root and nothing else |
| `SHORT_PREFIX` | Path prefix serving slugs on every host (`/l`) |
| `SIGNUP_MODE` | `open`, `invite` or `closed` |
| `SIGNUP_ALLOWLIST` | Emails or `@domain` suffixes for `invite` mode |

Set the secrets, migrate, deploy:

```sh
npx wrangler secret put BETTER_AUTH_SECRET   # 32+ random characters
npx wrangler secret put VISITOR_HASH_SALT    # optional, defaults to the auth secret
npm run db:migrate
npm run deploy
```

Social login turns on when a pair exists: `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Callback
URL is `$APP_URL/api/auth/callback/<provider>`.

Deploy [`links-agent`](https://github.com/lordbagel42/links-agent) too, against
the same D1 and KV.

## Routing

| Request | Handled by |
| --- | --- |
| `example.com/l/<slug>` | `links-agent` |
| `go.example.com/<slug>` | `links-agent`, at the root of a dedicated host |
| `go.example.com/f/<anything>` | A pattern slug, if one claims the path |
| `go.example.com/` | Bounces to the dashboard; anything else 404s |
| `links.example.com/*` | This Worker |
| `example.com/<anything else>` | Neither route — left alone |

`SHORT_PREFIX` matches `<prefix>/<slug>` on any host, which is what makes
`example.com/l/abc` work without claiming the apex. `SHORT_HOSTS` lists hosts
given over entirely to slugs. Keep the apex out of it.

A slug is normally one segment and one KV read. Multi-segment paths are accepted
too, since patterns span more than one, and resolve to nothing unless a pattern
claims them.

```jsonc
// wrangler.jsonc
"routes": [{ "pattern": "links.example.com", "custom_domain": true }]

// links-agent/wrangler.jsonc
"routes": [
  { "pattern": "go.example.com", "custom_domain": true },
  { "pattern": "example.com/l/*", "zone_name": "example.com" }
]
```

The apex entry is a zone route scoped to one path, so it won't disturb another
Worker already on `example.com/*` — Cloudflare dispatches to the most specific
match. All of it needs the zone on the same Cloudflare account as the Worker.

## Development

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Vite emulates D1, KV and Analytics Engine, so the dashboard runs at
`localhost:5173` and short links resolve at `localhost:5173/l/<slug>`. Passkeys
work there too — `localhost` counts as a secure origin — but one registered
against it is useless anywhere else.

| Script | Does |
| --- | --- |
| `npm run check` | Typecheck |
| `npm run db:generate` | Regenerate migrations after a schema edit |
| `npm run cf-typegen` | Regenerate binding types after a `wrangler.jsonc` edit |
| `npm run build -w @lordbagel42/links-core` | Compile the shared core |

```
src/lib/server/       auth, links, analytics, API keys
src/routes/(app)/     dashboard, link pages, analytics, settings
src/routes/api/v1/    the REST API
packages/links-core/  everything both Workers share
drizzle/              migrations
```

Both Workers run the same D1 statements, so a migration touching `link`,
`link_slug` or `click` needs a matching edit in `packages/links-core/src/d1.ts`
and a new release of the package. Releasing is a tag push:

```sh
npm version patch -w @lordbagel42/links-core --no-git-tag-version
git commit -am "release: links-core v0.2.1"
git tag links-core-v0.2.1 && git push --follow-tags
```

Consumers need a `read:packages` token as `NODE_AUTH_TOKEN` — GitHub Packages
has no anonymous read, even for public packages. This repo resolves the package
through the npm workspace, so its own CI doesn't.

## API

Create a key under **Settings → API keys** and send it as a bearer token.

```sh
curl https://links.example.com/api/v1/links -H "Authorization: Bearer lnk_…"

curl -X POST https://links.example.com/api/v1/links \
  -H "Authorization: Bearer lnk_…" \
  -H "content-type: application/json" \
  -d '{
        "destination": "https://example.com/long/path",
        "slug": "launch",
        "aliases": ["launch-2026", "go/launch"],
        "preview": { "mode": "branded" }
      }'
```

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/v1/links` | List (`search`, `tag`, `sort`, `status`, `limit`, `offset`) |
| `POST` | `/api/v1/links` | Create; `slug` is generated when omitted |
| `GET` | `/api/v1/links/:id` | Fetch one; `?analytics=1&range=30d` for stats |
| `PATCH` | `/api/v1/links/:id` | Update any subset of fields |
| `DELETE` | `/api/v1/links/:id` | Delete the link and its clicks |

Accepts everything the dashboard form does: `destination`, `slug`, `aliases`,
`title`, `description`, `tags`, `enabled`, `password`, `expiresAt`, `maxClicks`,
`fallbackUrl`, `forwardQuery`, `redirectStatus`, `rules`, and nested `preview`
and `utm` objects. `preview.mode` is `target` (the default), `branded` or `off`;
`preview.image` sets the card image for `branded`. Responses carry `aliases`
back alongside `shortUrls`, one per slug. Timestamps take epoch ms or anything
`Date.parse` handles.

## Analytics Engine

Optional, and there's nothing to provision — the dataset is created on first
write, so the binding is the whole setup. Each click is one data point: link id
as the index, slug / user / country / city / device / OS / browser / referrer /
colo / destination in `blob1`–`blob10`, and `1` / bot flag / ASN in
`double1`–`double3`. Query it with an **Account Analytics Read** token:

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" \
  --data "SELECT blob1 AS slug, sum(double1) AS clicks FROM CLICKS_AE
          WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY slug"
```

It keeps three months and samples at high volume, so it's a query surface, not
an archive. The dashboard reads D1 instead. Delete the
`analytics_engine_datasets` block to turn it off.

## Notes

- **KV is a cache, D1 is the truth.** A KV miss falls back to D1 and repopulates,
  so the cache heals itself. **Resync edge cache** in Settings republishes
  everything.
- **Edits take up to a minute** to reach every colo. KV's edge TTL floor is 60s.
- **Every slug is a full KV record.** Four slugs is four writes on save and still
  one read on resolve. Patterns are the exception — they can't be found by key,
  so they live in one index value republished whenever a pattern changes.
- **A `target` preview costs one subrequest, once.** It fetches the
  destination's `<head>` with a 2.5s timeout and caches the tags for an hour,
  keyed by destination, so links sharing one share the fetch. Failures cache
  briefly and fall back to the redirect.
- **Click caps overshoot slightly** — a few clicks can land while KV catches up.
- **`301` and `308` hide repeat clicks**, since browsers cache them. Hence the
  `302` default.
- **Raw IPs are stored** in `click.ip`, along with the full user agent. That's
  personal data under GDPR — say so in your privacy notice and prune the table
  on whatever retention you've committed to.
