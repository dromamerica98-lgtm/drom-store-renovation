# API

The Worker (`apps/api`, Hono) serves JSON under `/api` on the same origin as
the PWA (Vite proxies `/api` to `wrangler dev` in development). Request/response
types live in `@coach/shared` and are imported by both sides.

**Authentication:** every `/api/*` request needs a valid Cloudflare Access JWT
for the owner (`Cf-Access-Jwt-Assertion`, added by Access). Without it:
`401 {"error":{"code":"unauthorized","message":"Sign in required"}}` — for
every path, so unauthenticated callers cannot discover routes. All responses
carry `Cache-Control: no-store, private`.

## Conventions

* JSON in, JSON out. Errors: `{ "error": { "code": "...", "message": "..." } }`.
* Requests that change data must send `content-type: application/json`
  (CSRF guard; anything else gets `415`).
* Dates are the user's local calendar date (`YYYY-MM-DD`, timezone from
  settings); timestamps are ISO-8601 UTC; units are SI.
* No endpoint ever returns the Garmin key or access token.

## Endpoints

| Method & path | Purpose | Stage |
| --- | --- | --- |
| `GET /api/status` | Liveness, engine version, Garmin mode | 1 |
| `GET /api/today` | Everything the Today screen shows (see below) | 5 |
| `POST /api/today/modify` | Apply a guarded modification to today's workout | 5 |
| `POST /api/today/reset` | Drop modifications; back to the engine's recommendation | 5 |
| `POST /api/sync` | Incremental Garmin sync now (same as the hourly cron) | 3 |
| `GET /api/sync/status` | Per-domain sync window and errors, recent runs | 3 |
| `POST /api/dev/mock/reset` | **Mock mode only**: wipe and re-seed 120 days for a scenario | 3 |

Planned (later stages): `GET /api/health/daily?from&to`,
`GET /api/health/intraday/:date`, `GET /api/training/summary?period=week|month`,
`GET /api/activities`, `GET /api/activities/:id`, `GET /api/trends?metric&range`,
`GET|PUT /api/settings`, `PUT /api/settings/zones`, `GET|POST /api/coach/messages`.

### `GET /api/today` → `TodayResponse`

Loads ~120 days of history from D1, runs the engine, persists the assessment
and (if the inputs changed) a new recommendation, and returns:

```jsonc
{
  "date": "2026-11-12",
  "engineVersion": "1.0.0",
  "garminMode": "mock",
  "lastSyncAt": "2026-11-12T07:00:05Z",
  "today": { "sleepDurationSec": 26556, "sleepScore": 87, "hrvLastNightMs": 58, "bodyBatteryWake": 70, "restingHr": 49, ... },
  "readiness": {
    "score": 69, "band": "good", "confidence": 1,
    "components": [
      { "key": "hrv", "value": 58, "baseline": 60.1, "z": -0.6, "score": 58, "status": "worse", "note": "HRV 58 ms, 3% below …" },
      ...
    ]
  },
  "flags": [ { "code": "load_low", "severity": "info", "message": "…" } ],
  "load": { "atl": 80, "ctl": 83, "tsb": 2, "acwr": 0.97, "status": "balanced", "sufficientHistory": true },
  "yesterday": { "date": "2026-11-11", "dayClass": "easy", "activities": [ { "name": "Easy Run", "durationSec": 2940, "load": 93, ... } ] },
  "week": { "last7": { ... }, "previous7": { ... }, "avgWeek28": { ... }, "intensity28": { "low": 0.8, "moderate": 0.13, "high": 0.07 } },
  "recommendation": {
    "id": 17,
    "ruleId": "R8_QUALITY_DAY",
    "workout": {
      "type": "tempo", "title": "Tempo run", "durationSec": 2700, "intensity": "hard", "primaryZone": 3,
      "blocks": [
        { "kind": "warmup", "label": "Warm up …", "durationSec": 900,
          "target": { "zone": 1, "hrBpm": [94, 112], "paceSecPerKm": [371, 428], "rpe": [2, 3], "cue": "Very easy — …" } },
        { "kind": "work", "label": "Continuous tempo", "durationSec": 1200, "target": { "zone": 3, ... } },
        { "kind": "cooldown", ... }
      ],
      "notes": []
    },
    "reasons": [ { "code": "QUALITY_DUE", "tone": "positive", "message": "You're recovered (readiness 69) …" }, ... ],
    "summary": "Readiness 69/100 (good). You're recovered … Today: 20 min continuous tempo …",
    "harder": { "qualityAllowed": true, "easyAllowed": true, "blockedBy": [] },
    "modifications": [],
    "original": null
  }
}
```

Interval sessions use a repeat block:
`{ "kind": "repeat", "times": 4, "steps": [ {work}, {recovery} ] }`.

Recommendation stability: the engine's `inputsHash` covers everything that
can change the decision. Same hash → the stored current recommendation
(including any modification) is returned unchanged. New data → a fresh engine
recommendation replaces it (the old one stays in history).

### `POST /api/today/modify`

```json
{ "kind": "shorter" | "easier" | "harder" | "time_limit" | "rest" | "alternative", "minutes": 30 }
```

`minutes` is required for `time_limit` (integer 5–600). Returns a
`TodayResponse` plus:

```json
"modificationResult": { "applied": false, "reasons": [
  { "code": "MOD_HARDER_REFUSED", "message": "Not today — …" },
  { "code": "READINESS_TOO_LOW", "message": "Readiness 40 is below the 65 needed for a hard session." }
] }
```

Applied modifications are stored with `parent_id` lineage and become current;
`recommendation.modifications` lists them oldest first and
`recommendation.original` names the engine's original workout. Refusals change
nothing.

### `POST /api/sync` → `SyncResultResponse`

```json
{ "runId": 12, "status": "success" | "partial" | "error",
  "counts": { "sleep": 4, "hrv": 4, "activities": 1, "activity_details": 1, "intraday": 6, ... },
  "errors": [ { "domain": "hrv", "message": "HTTP 503 …" } ] }
```

`502` when every domain failed; `503` with `garmin_unavailable` when the
provider cannot be created (e.g. live mode before Stage 6).

### `POST /api/dev/mock/reset`

`{ "scenario": "normal" | "well_rested" | "fatigued" | "illness" | "calibrating" }`
— mock mode only (`403` otherwise). Clears Garmin and engine data, stores the
scenario in `app_state` so later syncs stay consistent, fills in a demo athlete
profile for settings you have not set (max HR 188, threshold pace 4:45 /km,
long run on Sunday), and seeds 120 days.
