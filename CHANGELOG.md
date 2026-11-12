# Changelog

All notable changes to this project are documented here. The project is
built in small stages; each stage is one entry.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Stage 4 — Deterministic readiness & recommendation engine
#### Added
- `@coach/engine` 1.0.0, pure and deterministic (no I/O, clock or randomness):
  - Personal baselines: 42-day window, ≥ 14 days to trust, log-HRV, SD floors.
  - Readiness 0–100 from HRV, sleep, resting HR, Body Battery and stress
    z-scores vs. your baseline; confidence; bands; fallbacks while calibrating.
  - Flags: illness pattern, elevated RHR, suppressed/trending-low HRV, short
    sleep, low Body Battery, high stress, load spike/high/low, hard-day streaks,
    rest overdue, missing overnight data, calibrating.
  - Training load: Edwards/Banister TRIMP, ATL/CTL/TSB/ACWR, weekly volume,
    28-day intensity distribution, streaks and quality-type history.
  - Ordered decision rules R1–R9 with a low-confidence guard; goal-based
    quality rotation; duration rules incl. ~10 % long-run progression.
  - Structured workouts: warm-up, main set, repeat blocks with recoveries,
    cool-down; HR zone + bpm, pace (running), RPE and effort cues.
  - Modifications: shorter, easier, harder (guarded), "I only have X minutes",
    rest day, alternative modality — chainable, with reasons on refusal.
  - Machine-readable reason codes + deterministic sentences and summary;
    `inputsHash` and `ENGINE_VERSION` for auditability.
- 75 engine unit tests covering every rule and modification.
- `docs/ENGINE.md` incl. the contract for the future AI layer.

#### Changed
- Mock `fatigued` scenario softened so it demonstrates the recovery path
  rather than the illness path.

### Stage 3 — Garmin integration service
#### Added
- `GarminProvider` interface: the only boundary between Garmin and the rest
  of the app; returns normalised records with the raw payload attached.
- `MockGarminProvider`: deterministic simulated athlete (weekly training
  pattern, physiological response to load) with scenarios `normal`,
  `well_rested`, `fatigued`, `illness`, `calibrating`.
- `SyncService`: per-domain recent window with 3-day overlap, chunked
  backfill toward 180 days, bounded activity-detail fetches, intraday curves,
  per-domain error isolation, run log.
- Routes: `POST /api/sync`, `GET /api/sync/status`, and (mock mode only)
  `POST /api/dev/mock/reset` to re-seed a scenario.
- Hourly cron trigger running the same sync.
- CSRF guard: state-changing requests must be `application/json`.
- Calendar-date utilities in `@coach/engine` (DST-safe, timezone-aware today).
- `docs/GARMIN_INTEGRATION.md`: Personal API facts (key → 24 h token, GET-only),
  endpoint catalogue to verify, sync strategy, error handling, Stage 6 plan.

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
