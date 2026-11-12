# Changelog

All notable changes to this project are documented here. The project is
built in small stages; each stage is one entry.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Stage 2 — D1 database schema
#### Added
- Migration `0001_initial.sql`: settings + training zones; one source table per
  Garmin domain (daily summary, sleep, HRV, Body Battery, stress) keyed by local
  date; intraday series (one JSON row per day per metric); activities with time
  in HR zones; activity details; engine output (`daily_assessments`,
  `recommendations` with modification lineage); Garmin credentials cache, sync
  state and sync run log; coach messages; `v_daily_metrics` view for the engine.
- Repository layer (`apps/api/src/db`): settings, health, activities, sync.
  All writes are idempotent upserts; app-owned columns (RPE, detail flag)
  survive provider re-syncs.
- Domain types in `@coach/engine` (`DailyMetrics`, `ActivitySummary`,
  `AthleteSettings`, …) and normalised record types in the API.
- Test harness running a real local D1 via wrangler `getPlatformProxy`;
  schema-constraint and repository tests.
- `docs/DATABASE.md`.

### Stage 1 — Project architecture
#### Added
- npm-workspaces monorepo: `apps/api` (Worker), `apps/web` (Pages PWA),
  `packages/engine` (deterministic engine), `packages/shared` (API types).
- `docs/ARCHITECTURE.md`: system overview, request flows, security model,
  roadmap and decision log.
- API Worker skeleton (Hono) with `GET /api/status` and JSON 404/500 handlers.
- Pages Function that forwards `/api/*` to the API Worker over a service
  binding; the API Worker has no public URL.
- Vite + Preact web skeleton with dev proxy to the local Worker.
- TypeScript (strict) and Vitest across all workspaces; GitHub Actions CI.
