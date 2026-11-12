# Coach — personal training coach on Garmin data

A mobile-first, installable PWA that turns your Garmin health and activity
data into one clear answer every morning: **how ready are you, what should
you train today, and why.**

Recommendations come from a **deterministic engine** that compares today's
values with *your own* historical baseline. The AI layer (a later stage) only
explains and adjusts what the engine produced — it never invents a workout.

| Phone | Desktop |
| --- | --- |
| <img src="docs/images/today-phone.png" width="260" alt="Today screen on a phone: readiness 69 (good) and a 45-minute tempo run"> | <img src="docs/images/today-desktop.png" width="520" alt="Today screen on desktop: recovery metrics on the left, structured workout and reasons on the right"> |

## Status

Built in small, tested stages — see [CHANGELOG.md](CHANGELOG.md).

| Stage | What | Status |
| --- | --- | --- |
| 1 | Architecture, monorepo, tooling, CI | ✅ |
| 2 | D1 schema, migrations, repositories | ✅ |
| 3 | Garmin integration service (provider boundary, mock provider, sync) | ✅ |
| 4 | Deterministic readiness + recommendation engine | ✅ |
| 5 | PWA shell + **Today** screen on mock data | ✅ |
| 6 | Live Garmin Personal API | next |
| 7–11 | Health, Training, Trends, Settings, Coach (AI) | planned |

**Today** shows readiness 0–100, sleep, HRV, Body Battery, resting HR,
training load and form, yesterday's workout, weekly volume, and a structured
workout (warm-up, main set / intervals with recoveries, cool-down, duration,
HR zone + bpm, pace, RPE) with the reasons behind it. You can make it
shorter, easier, harder (guarded), fit it into *X* minutes, swap to a rest day
or an alternative — every change goes through the engine.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Preact + Vite, PWA (manifest + service worker), Cloudflare Pages |
| API | Cloudflare Worker with Hono, reached via a Pages service binding (no public URL) |
| Database | Cloudflare D1 (SQLite) |
| Data source | Garmin Connect Personal API — server-side only (Stage 6); mock provider until then |
| Engine | `@coach/engine` — pure TypeScript, 75 unit tests |

```
apps/api         Cloudflare Worker: API, Garmin sync (cron), D1 access
apps/web         PWA deployed to Cloudflare Pages (+ /api proxy function)
packages/engine  Deterministic readiness + recommendation engine
packages/shared  API contract types
docs/            Design documents
```

## Documentation

* [Architecture](docs/ARCHITECTURE.md) — components, flows, security, roadmap, decisions
* [Database](docs/DATABASE.md) — D1 schema, conventions, migrations
* [Garmin integration](docs/GARMIN_INTEGRATION.md) — Personal API, provider boundary, sync, mock scenarios
* [Engine](docs/ENGINE.md) — baselines, readiness, load, decision rules, workouts, modifications, AI contract
* [API](docs/API.md) — endpoints and payloads
* [CHANGELOG](CHANGELOG.md)

## Run it locally

Requires Node 22+. Runs entirely on mock data; no Garmin account needed.

```bash
npm install
```

```bash
npm run db:migrate:local -w @coach/api
```

In one terminal, the API Worker (local D1, on http://127.0.0.1:8787):

```bash
npm run dev:api
```

In another, the PWA (http://localhost:5173, proxies `/api` to the Worker):

```bash
npm run dev:web
```

The first load seeds 120 days of synthetic history. Use **Demo data** at the
bottom of Today to switch scenarios (normal, well rested, fatigued, illness,
calibrating), or:

```bash
curl -X POST http://127.0.0.1:8787/api/dev/mock/reset -H 'content-type: application/json' -d '{"scenario":"fatigued"}'
```

### Checks

```bash
npm run check        # typecheck + all tests (engine, API against real local D1, web)
```

```bash
npm run build        # production build of the PWA
```

## Deploy to Cloudflare

One-time setup (Wrangler will ask you to log in):

1. Create the database and put its id into `apps/api/wrangler.jsonc`
   (`d1_databases[0].database_id`):

   ```bash
   npx wrangler d1 create coach-db
   ```

2. Apply migrations to the remote database:

   ```bash
   npm run db:migrate:remote -w @coach/api
   ```

3. Deploy the API Worker (it has no public URL by design):

   ```bash
   npm run deploy -w @coach/api
   ```

4. Create the Pages project and deploy the PWA. `apps/web/wrangler.jsonc`
   binds `/api/*` to the `coach-api` Worker:

   ```bash
   npx wrangler pages project create coach-web --production-branch main
   ```

   ```bash
   npm run deploy -w @coach/web
   ```

5. Protect the site with **Cloudflare Access** (Zero Trust → Access →
   Applications → Self-hosted): add `coach-web.pages.dev` (and any custom
   domain / preview subdomains) with a policy that allows only your email.
   This is the app's login; the API is only reachable through it.

6. On the iPhone: open the site in Safari → Share → **Add to Home Screen**.

The Garmin key is not needed until Stage 6. When it is, it goes in as a Worker
secret — never in code, config or the browser:

```bash
npx wrangler secret put GARMIN_PERSONAL_API_KEY --name coach-api
```

## Security

* The Garmin Personal API key is a Worker secret; only the API Worker talks
  to Garmin. No endpoint returns the key or token.
* The API Worker has no public route; the browser reaches it only through the
  Access-protected Pages origin (same origin, no CORS).
* State-changing requests must be JSON (CSRF guard).

See [docs/ARCHITECTURE.md § Security model](docs/ARCHITECTURE.md#6-security-model).

## Not medical advice

The engine uses conservative, widely used training heuristics against your own
baselines. If you feel unwell, rest — whatever the score says.
