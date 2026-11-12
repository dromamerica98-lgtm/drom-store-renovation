# Coach — personal training coach on Garmin data

A mobile-first, installable PWA that turns your Garmin health and activity
data into one clear answer every morning: **how ready are you, and what
should you train today — and why.**

* **Today** — readiness 0–100, sleep, HRV, Body Battery, resting HR, training
  load, yesterday's workout, weekly volume and a structured recommended workout.
* **Health** — sleep, HRV, Body Battery, resting HR, stress and their trends.
* **Training** — weekly/monthly volume, intensity distribution, activity history.
* **Coach** — conversational explanation and modification of workouts.
* **Trends** — long-term recovery, fitness and training load.
* **Settings** — goals, available days, preferred duration, HR/pace zones, Garmin connection.

Recommendations come from a **deterministic engine** that compares today's
values with *your own* historical baseline. The AI layer only explains and
adjusts what the engine produced; it never invents a workout.

> Status: under construction, built in small stages. See
> [CHANGELOG.md](CHANGELOG.md) for what exists today and
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#8-roadmap) for the roadmap.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Preact + Vite, PWA (manifest + service worker), Cloudflare Pages |
| API | Cloudflare Worker with Hono, reached via a Pages service binding |
| Database | Cloudflare D1 (SQLite) |
| Data source | Garmin Connect Personal API (server-side only) |
| Engine | `@coach/engine` — pure TypeScript, unit-tested |

## Repository layout

```
apps/api        Cloudflare Worker: API, Garmin sync, D1 access
apps/web        PWA deployed to Cloudflare Pages
packages/engine Deterministic readiness + recommendation engine
packages/shared API contract types
docs/           Architecture and design documents
```

## Documentation

* [Architecture](docs/ARCHITECTURE.md) — components, flows, security, decisions
* [Database](docs/DATABASE.md) — D1 schema, conventions, migrations
* [Garmin integration](docs/GARMIN_INTEGRATION.md) — Personal API, provider boundary, sync, mock scenarios
* [Engine](docs/ENGINE.md) — baselines, readiness, load, decision rules, workouts, modifications
* [CHANGELOG](CHANGELOG.md)

## Development

Requires Node 22+.

```bash
npm install
```

```bash
npm run check        # typecheck + all tests
```

```bash
npm run dev:api      # API Worker on http://127.0.0.1:8787 (wrangler dev)
```

```bash
npm run dev:web      # PWA on http://localhost:5173, proxies /api to :8787
```

## Security

The Garmin Personal API key is a Worker secret and is never shipped to the
browser. See [docs/ARCHITECTURE.md § Security model](docs/ARCHITECTURE.md#6-security-model).
