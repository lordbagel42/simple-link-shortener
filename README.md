# Links

A link shortener you run yourself, on Cloudflare, with nothing else in the
stack. Workers serve it, D1 stores it, KV caches it. A redirect is one KV read
and a 302; the click is written to the database afterwards, once the visitor is
already on their way.

A deployment is two Workers. This repository is the dashboard and the REST API.
The redirect Worker lives in
[`lordbagel42/links-agent`](https://github.com/lordbagel42/links-agent) and
shares this repository's link-resolution code as a published package.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lordbagel42/simple-link-shortener)

That button forks this repository into your GitHub account, creates a D1
database and a KV namespace, and wires up Workers Builds so every push
redeploys. It does not know your domain or your secrets, so there are three
things to do afterwards — see [Deploy](#deploy).

Built with SvelteKit 2 and Svelte 5, Tailwind CSS 4, shadcn-svelte, Drizzle ORM,
and better-auth.

---

## What it does

### Links

Give it a destination and it gives you a short link. The slug is yours to pick
or it generates one: six characters from an alphabet with `0`, `1`, `i`, `l`
and `o` left out, so nobody has to guess whether that was a one or an ell.
Custom slugs can be 1–64 characters of letters, numbers and `. _ ~ -`, and a
list of reserved words (`api`, `login`, `settings`, `analytics`, and friends)
is refused so a link can never shadow the app itself.

Each link also carries a title, private notes, and up to twelve tags. Any link
can be switched off without deleting it, and you choose the redirect status per
link — `301`, `302`, `307` or `308`, defaulting to `302`.

Every link has a QR code, downloadable as PNG or SVG. The QR library is
imported only when you open the dialog, so it never lands in the dashboard's
initial bundle.

### Rules and limits

| | |
| --- | --- |
| **Expiry** | The link stops resolving at a date you set. Its KV record is given a matching TTL, so a stale copy can never outlive it. |
| **Click cap** | The link disables itself once it hits the limit. |
| **Fallback URL** | Where visitors go when a link is expired, capped or switched off. Without one they get a 410 page. |
| **Password** | PBKDF2-SHA256, 100,000 iterations, via Web Crypto. Visitors get a small self-contained form served straight from the edge — no app bundle, no framework. |
| **Query forwarding** | Parameters on the short link are passed to the destination. Anything already on the destination wins. |
| **UTM tags** | `utm_source` and the rest are appended on every redirect. |

### Targeting

One link, several destinations. Rules match on country, continent, device
type, OS, language, or referring domain; the first match wins, and the link's
default destination catches everything else. Twenty rules per link.

Matching is case-insensitive and substring-based, so a `country` rule of `US`
matches `US`, and a `referer` rule of `github` matches `gist.github.com`.

Rules travel in the same KV record as the destination, so targeting is
evaluated at the edge and costs a redirect nothing extra.

### Analytics

Every field Cloudflare hands the Worker about a request is kept: country,
region, city, postal code, continent, latitude and longitude, timezone, EU
flag, edge colo, ASN and network name, HTTP protocol, TLS version and cipher,
TCP round-trip time, bot score and verified-bot category. Plus the parsed user
agent, `Accept-Language`, referrer, UTM tags, the raw query string, and which
destination that particular visitor was actually sent to.

The dashboard reads it back per link or across your whole account, over the
last 24 hours, 7, 30 or 90 days, or all time — hourly buckets for the day
view, daily for the rest, with empty buckets filled in so the chart has a
continuous axis.

- **Totals**: clicks, unique visitors, the human share of traffic, and how many
  countries you have been seen from.
- **Audience**: countries (with flags and real names, not codes), cities,
  referrers.
- **Technology**: devices, browsers, operating systems, languages, and which
  destinations were served — useful once targeting rules are in play.
- **Network**: Cloudflare edge locations and the networks visitors came from.
- **Events**: the last fifty clicks in full, with IP address, user agent, city,
  colo, network, and whether it was a first visit or a bot.

Unique visitors are counted with a salted SHA-256 of IP plus user agent,
scoped per link and truncated to 32 characters.

Bot detection is a built-in user-agent parser rather than a dependency, because
a dependency here would sit on the redirect hot path. It knows the usual
crawlers, plus link-preview fetchers from WhatsApp, Telegram, Discord, Slack
and the rest.

### Accounts and access

Email and password sign-in with a 10-character minimum, through better-auth.
GitHub and Google sign-in turn themselves on when you set the matching pair of
client credentials, and stay hidden when you don't. Sessions last 30 days.

A shortener on your own domain is not usually meant to be open to the world, so
sign-up is gated by `SIGNUP_MODE`: `open`, `closed`, or `invite` against a list
of addresses and `@domain` suffixes. It defaults to `invite`, so a fresh
deployment lets nobody in until you say who.

Links, clicks and API keys are all scoped to the user who owns them.

### API

Bearer-token API keys, created under **Settings → API keys**. The token is
shown once and only its SHA-256 is stored; the dashboard keeps the first few
characters so you can tell keys apart, and records when each was last used.
Keys can be given an expiry. Full reference in [API](#api-1).

### The dashboard itself

Search across slugs, destinations and titles; filter by tag or by
enabled/disabled; sort by newest, most clicked, or slug. Counts for links,
total clicks, unique visitors and clicks this week sit at the top. Dark and
light themes, dark by default.

Settings also shows how the instance is configured — short-link base,
dashboard origin, sign-up mode, whether Analytics Engine is bound — and has a
**Resync edge cache** button that republishes every link into KV.

---

## Architecture

### Two Workers

Redirects and the dashboard want opposite things from Cloudflare, and placement
is a per-Worker setting. The only way to have both is to have two Workers.

| | `links-redirect` | `links` |
| --- | --- | --- |
| Repository | [`links-agent`](https://github.com/lordbagel42/links-agent) | this one |
| Serves | `example.com/l/*`, `go.example.com/*` | `links.example.com/*` |
| Placement | **Edge** — nearest the visitor | **Smart** — nearest D1 |
| Contains | KV read, redirect, deferred click write | SvelteKit, better-auth, the REST API |
| Bundle | ~23 KiB (8 KiB gzip) | ~3.4 MiB (620 KiB gzip) |

The dashboard makes several D1 round trips per page, so Smart Placement is a
clear win there. A redirect makes none on the response path — one edge-cached
KV read, then a 302 — so Smart Placement would only add the distance from the
visitor to D1's region.

The redirect Worker also skips `nodejs_compat`, static assets, and every
dependency the dashboard needs. It reaches D1 through raw prepared statements
rather than Drizzle, which is what takes it from 203 KiB to 23 KiB. On a path
whose whole job is speed, bundle size is isolate start-up time.

You can run the dashboard on its own — it resolves short links too, through the
same code, in `hooks.server.ts` before SvelteKit routing. The second Worker is
an optimisation, not a requirement.

### The shared core

Both Workers resolve links with the same code, published from this repository
as **`@lordbagel42/links-core`** (`packages/links-core`). It holds everything
between an incoming request and a 302 — KV and D1 access, the targeting-rule
evaluator, the click writer, the Drizzle schema, and the small HTML pages the
redirect path can return — with no framework attached.

The app keeps only the SvelteKit-shaped edges: `getEnv` in
`src/lib/server/env.ts` and `handleShortLink` in `src/lib/server/redirect.ts`.

Because the D1 statements are shared, a migration touching `link` or `click`
needs a matching edit in `packages/links-core/src/d1.ts` and a new release of
the package.

Releases go out from `.github/workflows/release-core.yml` on a matching tag,
using the workflow's built-in `GITHUB_TOKEN`:

```sh
npm version patch -w @lordbagel42/links-core --no-git-tag-version
git commit -am "release: links-core v0.1.1"
git tag links-core-v0.1.1 && git push --follow-tags
```

Consumers do need a token of their own. GitHub Packages has no anonymous read,
even for public packages, so anything installing the package — the
`links-agent` repository and its Workers Builds job — needs `read:packages`
exposed as `NODE_AUTH_TOKEN`. This repository is not one of them: it resolves
the package through the npm workspace, so its own CI needs no credentials.

### How requests are routed

| Request | Handled by |
| --- | --- |
| `example.com/l/<slug>` | `links-redirect` — KV lookup, 302, click logged via `waitUntil` |
| `go.example.com/<slug>` | `links-redirect`, at the root of a dedicated host |
| `go.example.com/l/<slug>` | Also works — the prefix is accepted everywhere |
| `go.example.com/<anything else>` | 404, except `/` which bounces to the dashboard |
| `links.example.com/*` | `links` — the dashboard and REST API |
| `example.com/<anything else>` | Neither Worker's route — left to whatever else runs on the zone |

Two settings drive the matching, and both Workers read them:

- **`SHORT_PREFIX`** (`/l`) matches `<prefix>/<slug>` on *any* host. That is
  what makes `example.com/l/abc` work without claiming the rest of the apex,
  and what makes `localhost:5173/l/abc` behave identically in development.
- **`SHORT_HOSTS`** (comma-separated) lists hosts given over entirely to short
  links. On those, every single-segment path is a slug and nothing else is
  served — which is why a dedicated subdomain can serve bare `/<slug>` while
  the apex cannot.

Keep the apex out of `SHORT_HOSTS`. It then only answers under the prefix, and
the rest of your site is untouched.

---

## Deploy

### With the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lordbagel42/simple-link-shortener)

Cloudflare clones this repository into your account, provisions the D1 database
and KV namespace, builds, and connects Workers Builds for future pushes. Three
things are still on you, in your new repository:

1. **Point it at your domain.** `wrangler.jsonc` ships with routes and `vars`
   for `raygen.dev`. Replace the `routes` block with your own hostname and edit
   the `vars` below — the first deploy fails on a zone you don't own.
2. **Set the secrets.** `wrangler secret put BETTER_AUTH_SECRET` at minimum.
   Without a stable one, better-auth invents a new key per isolate and signs
   people out at random.
3. **Run the migrations.** `npx wrangler d1 migrations apply <your-db> --remote`.
   The button creates the database but leaves it empty.

Then deploy the redirect Worker from
[`links-agent`](https://github.com/lordbagel42/links-agent), pointed at the same
D1 and KV. It has its own button and its own caveats.

### By hand

```sh
npm install

npx wrangler d1 create link-shortener
npx wrangler kv namespace create LINKS
```

Copy the returned `database_id` and KV `id` into `wrangler.jsonc`, then
regenerate the binding types:

```sh
npm run cf-typegen
```

Edit the `vars` block:

| Variable | Meaning |
| --- | --- |
| `APP_URL` | Public origin of the dashboard, e.g. `https://links.example.com` |
| `SHORT_URL` | Base that generated links are built on, e.g. `https://example.com/l` or `https://go.example.com` |
| `SHORT_HOSTS` | Comma-separated hosts that serve slugs at their root and nothing else |
| `SHORT_PREFIX` | Path prefix that serves slugs on every host (`/l`) |
| `SIGNUP_MODE` | `open`, `invite`, or `closed` |
| `SIGNUP_ALLOWLIST` | Comma-separated emails or `@domain` suffixes for `invite` mode |

Set the secrets:

```sh
npx wrangler secret put BETTER_AUTH_SECRET   # 32+ random characters
npx wrangler secret put VISITOR_HASH_SALT    # optional, defaults to the auth secret
```

Social login switches on when a matching pair exists: `GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The
callback URL is `$APP_URL/api/auth/callback/<provider>`.

`SIGNUP_ALLOWLIST` can be a secret instead of a var, which keeps your email out
of a public repository — a secret of the same name wins.

Then migrate and ship:

```sh
npm run db:migrate        # applies drizzle/ to the remote D1 database
npm run deploy
```

### Routes without breaking your site

`workers_dev` is off on both Workers, so there is no `*.workers.dev` URL:

```jsonc
// wrangler.jsonc
"routes": [
  { "pattern": "links.example.com", "custom_domain": true }
]

// links-agent/wrangler.jsonc
"routes": [
  { "pattern": "go.example.com", "custom_domain": true },
  { "pattern": "example.com/l/*", "zone_name": "example.com" }
]
```

**This will not disturb another Worker already serving your apex.** The apex
entry is a zone route scoped to one path, not a custom domain — a custom domain
would claim the entire hostname. Cloudflare dispatches to the most specific
matching route, so an existing `example.com/*` route keeps every path except
`/l/*`. The subdomains are custom domains, which is fine because nothing else
answers on them.

All three need the zone to be active **on the same Cloudflare account as the
Worker** — custom domains cannot cross accounts. The two subdomain DNS records
are created on first deploy. The `example.com/l/*` route only fires if the apex
already resolves through Cloudflare, so there has to be an orange-clouded
`A`/`AAAA`/`CNAME` record there.

---

## Local development

```sh
cp .dev.vars.example .dev.vars   # local secrets and origin overrides
npm run db:migrate:local
npm run dev
```

Vite emulates D1, KV and Analytics Engine from `wrangler.jsonc`, so the
dashboard runs at `http://localhost:5173` and short links resolve at
`http://localhost:5173/l/<slug>`. The dashboard uses the same matching logic as
the redirect Worker, so you rarely need both processes running. To exercise the
real one, run `npm run dev` in a
[`links-agent`](https://github.com/lordbagel42/links-agent) checkout alongside
this repository.

| Script | Does |
| --- | --- |
| `npm run dev` | Dashboard at `localhost:5173`, local D1 and KV |
| `npm run check` | Typecheck the whole project |
| `npm run db:generate` | Regenerate migrations after editing the schema |
| `npm run db:migrate` / `db:migrate:local` | Apply migrations, remote or local |
| `npm run cf-typegen` | Regenerate binding types after editing `wrangler.jsonc` |
| `npm run build -w @lordbagel42/links-core` | Compile the shared core |
| `npm run deploy` | Build and deploy the dashboard Worker |

### Layout

```
src/lib/server/       auth, links, analytics, API keys — the dashboard's own logic
src/routes/(app)/     dashboard, per-link pages, analytics, settings
src/routes/(auth)/    login and sign-up
src/routes/api/v1/    the REST API
packages/links-core/  everything both Workers share
drizzle/              migrations
```

---

## API

Create a key under **Settings → API keys**, then send it as a bearer token. A
dashboard session cookie authenticates the same endpoints, so you can poke at
them from the browser too.

```sh
curl https://links.example.com/api/v1/links \
  -H "Authorization: Bearer lnk_…"

curl -X POST https://links.example.com/api/v1/links \
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

`POST` and `PATCH` accept everything the dashboard form does: `destination`,
`slug`, `title`, `description`, `tags`, `enabled`, `password`, `expiresAt`,
`maxClicks`, `fallbackUrl`, `forwardQuery`, `redirectStatus`, `rules`, and a
nested `utm` object. Timestamps can be epoch milliseconds or anything
`Date.parse` understands. Validation errors come back as
`400 {"error":"invalid_request","message":…,"field":…}`.

---

## Analytics Engine

Optional, and there is nothing to provision — the dataset is created the first
time the Worker writes to it, so the binding in `wrangler.jsonc` is the entire
setup. `binding` is the name the code uses; `dataset` is the table you
`SELECT ... FROM`. Here they are deliberately the same:

```jsonc
"analytics_engine_datasets": [
  { "binding": "CLICKS_AE", "dataset": "CLICKS_AE" }
]
```

Each click becomes one data point, with the link id as its index:

| Field | Contents |
| --- | --- |
| `blob1`–`blob10` | slug, user id, country, city, device, OS, browser, referrer domain, colo, destination |
| `double1` | always `1`, so `sum(double1)` counts clicks |
| `double2` | `1` for bot traffic, `0` otherwise |
| `double3` | ASN |

Reading is a separate step — querying is not part of the binding. Create an API
token with **Account Analytics Read**, then POST SQL to the account endpoint:

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
data point allows at most 20 blobs, 20 doubles and 1 index, and sampling kicks
in at high volume — once it does, `sum(_sample_interval)` is the honest row
count, not `count()`. The dashboard deliberately does not read from here; it
queries D1, which keeps everything and needs no extra token. Delete the
`analytics_engine_datasets` block to turn it off.

One thing I could not confirm from Cloudflare's docs: whether Analytics Engine
needs a paid Workers plan. If `writeDataPoint` silently drops everything on a
free account, that is the first thing to check.

---

## Things worth knowing

**KV is a cache, D1 is the truth.** Every write republishes the link's KV
record. A KV miss falls back to D1 and repopulates the cache, so the system
heals itself after an eviction or a restored database. **Resync edge cache** in
Settings republishes everything at once.

**Edits take up to a minute to propagate.** KV records are read with a
60-second edge TTL, which is KV's own floor.

**Click caps overshoot slightly.** The cap is checked against the D1 counter
after each click and then pushed back into KV, so a handful of clicks can land
in the window before every colo sees the update.

**Permanent redirects hide repeat clicks.** `301` and `308` are cached by
browsers, so those visitors never hit the Worker again. That is why `302` is
the default.

**Raw IPs are stored.** Every click keeps the client address from
`cf-connecting-ip` and the full user-agent string, so the event feed can show
exactly who hit a link. That is personal data under GDPR and similar regimes —
if you publish links to visitors in those jurisdictions, say so in your privacy
notice and prune the `click` table on whatever retention schedule you have
committed to.

**Deleting a link deletes its clicks.** D1 does not enforce
`on delete cascade` unless foreign keys are enabled for the session, so the
rows are removed explicitly.
