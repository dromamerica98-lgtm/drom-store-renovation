# Garmin integration

All Garmin access happens in the API Worker. The browser never sees the key,
the access token, or a Garmin URL. It only reads normalised data from D1.

## 1. The Garmin Connect Personal API

Garmin opened a self-serve **Personal API key** on 21 October 2026. What
matters for this design:

| Fact | Consequence here |
| --- | --- |
| You create the key yourself in Garmin Connect (web) → *Personal API Key*. No application or approval. Expiry: 30, 90, 180 days or 1 year. Shown once. | Stored as a Worker secret. Settings records the expiry date and warns before it lapses. |
| The key is exchanged for an **access token valid 24 h** (or until the key expires). **No refresh tokens**: just ask for a new one. | `TokenManager` (Stage 6) caches the token, encrypted, in `garmin_credentials` and renews it shortly before expiry or after a 401. About one token request per day. |
| Token endpoint: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with header `Authorization: ApiKey <key>`. | Only the Worker calls it. |
| Data endpoints live on `personal.connectapi.garmin.com`, are **GET-only**, and only a fixed allow-list of paths is served. The token does not work on the regular Connect API host. | Read-only integration. Nothing is ever written to Garmin. |
| For your own account and your own tools only, not for apps serving other users. | Matches this single-user app. |
| Rate limits are not published. | Conservative sync: hourly, small windows, bounded detail fetches, back-off on 429. |

Sources: Garmin's Personal API FAQ (developer.garmin.com/gc-developer-program/personal/personal-faq/)
and community reports. Endpoint paths and payload shapes below are **not yet
verified** against Garmin's own Swagger documentation; Stage 6 starts by doing
that.

### Endpoint catalogue (to verify in Stage 6)

| Our domain | Reported Personal API path | Notes |
| --- | --- | --- |
| `activities` | `/activitylist-service/activities/search/activities` | list, paged; date filter params to confirm |
| `activities` (single) | `/activity-service/activity/{id}` | summary incl. HR zones, training effect, load |
| `activity_details` | `/download-service/files/activity/{id}` | original FIT file (only the original format works) |
| `sleep` | `/sleep-service/sleep/dailySleep`, `/sleep-service/sleep/dailySleepSummariesByDate` | sleep stages and score |
| `hrv` | `/hrv-service/hrv/{date}`, `/hrv-service/hrv/daily/{from}/{to}` | the range form avoids one call per day |
| `stress` | `/stats/stress/daily/{start}/{end}`, `/stats/stress/weekly` | daily aggregates and intraday samples |
| `body_battery` | `/wellness-service/wellness/bodyBattery/reports/daily` | daily charged/drained/high/low |
| `daily_summary` | `/usersummary-service/stats/steps/daily/{start}/{end}`, `/usersummary/daily`, `/usersummary-service/v2/dailysummaries` | steps, resting HR, kcal, intensity minutes |
| settings import | `/userprofile-service/userprofile/settings` | max HR, zones (to pre-fill Settings) |

## 2. Code structure

```
apps/api/src/garmin/
├── provider.ts        GarminProvider interface + GarminProviderError
├── index.ts           createProvider(env, today): mock | live
├── sync.ts            SyncService: windows, backfill, details, intraday
└── mock/
    ├── random.ts      seeded PRNG (mulberry32) + helpers
    ├── simulate.ts    synthetic athlete with training response + scenarios
    └── provider.ts    MockGarminProvider
        (Stage 6)
├── live/
│   ├── token.ts       TokenManager: key → 24 h token, encrypted cache, renew on expiry/401
│   ├── client.ts      GET client: timeouts, 429/5xx back-off, no logging of secrets
│   ├── mappers/       one pure mapper per domain: Garmin JSON → normalised record
│   └── provider.ts    LiveGarminProvider
```

### The boundary: `GarminProvider`

```ts
interface GarminProvider {
  readonly mode: 'mock' | 'live';
  readonly source: 'mock' | 'garmin';
  dailySummaries(range): Promise<DailySummaryRecord[]>;
  sleep(range): Promise<SleepRecord[]>;
  hrv(range): Promise<HrvRecord[]>;
  bodyBattery(range): Promise<BodyBatteryRecord[]>;
  stress(range): Promise<StressRecord[]>;
  activities(range): Promise<ActivityRecord[]>;
  activityDetails(id): Promise<ActivityDetailsRecord | null>;
  intraday(date): Promise<IntradaySeriesRecord[]>;
}
```

Every method returns **normalised records** (SI units, local dates, `null`
for unknown) with the provider's raw payload attached as `raw`, which the
repositories keep in `raw_json`. Nothing above this interface knows Garmin's
JSON shapes, so connecting the live API in Stage 6 changes no service, route,
engine or UI code.

## 3. Sync strategy (`SyncService`)

Runs hourly from the cron trigger (`17 * * * *`) and on *Sync now*
(`POST /api/sync`). For each daily domain:

1. **Recent window**: from *newest synced date − 3 days* to today. The overlap
   picks up data Garmin revises after a late watch sync (e.g. sleep score,
   HRV status). First run: the last 14 days.
2. **Backfill**: one chunk of at most 28 older days per run, until 180 days of
   history exist. Spreading backfill over runs keeps each invocation inside
   Workers' subrequest limits once requests go to Garmin.
3. **Activity details**: at most 10 per run, newest first, for activities in
   the last 14 days that have none yet.
4. **Intraday curves**: today and yesterday.

All writes are upserts, so re-running is harmless. `sync_state` tracks the
synced window per domain; `sync_runs` logs each run. A failure in one domain
(e.g. HTTP 503 from the HRV service) is recorded on that domain, the other
domains still sync, and the run is reported as `partial`.

### Error handling (live mode, Stage 6)

| Situation | Behaviour |
| --- | --- |
| 401 on a data call | Discard cached token, fetch a new one, retry once. |
| Token request fails with 401/403 | Key invalid or expired → mark connection as needing a new key; Settings shows it. |
| 429 / 5xx / timeout | Mark the domain's error, stop calling Garmin for this run; the next cron run retries. |
| Unexpected payload shape | Mapper throws with the domain and path; the raw payload is not logged (it is personal data). |

## 4. Mock provider

`GARMIN_MODE=mock` (the default until Stage 6) serves a simulated athlete:
max HR 188, resting HR ≈ 48, HRV ≈ 62 ms, sleep need 7.6 h, and a weekly plan
(Tue intervals, Wed easy, Thu tempo, Sat easy ± strength, Sun long, Mon rest).

* **Deterministic**: simulated day by day from a fixed epoch with a per-date
  seed. Past days never change when "today" moves, so re-syncs are stable.
* **Physiological response**: hard sessions and accumulated strain
  (acute vs chronic load) lower next-morning HRV, sleep score and Body Battery
  and raise resting HR.
* **Scenarios** (override the last days before today):

| Scenario | What it simulates | Expected engine outcome |
| --- | --- | --- |
| `normal` | The plain weekly pattern | Depends on the day |
| `well_rested` | Two rest days, great sleep, HRV up | Quality session allowed |
| `fatigued` | Four hard days in a row, short-ish sleep, HRV −12 %, RHR +3 bpm, high load | Recovery |
| `illness` | RHR +10 bpm, HRV −38 %, poor sleep, high stress | Rest |
| `calibrating` | Only 7 days of history | Low confidence, conservative plan |

Switch scenario: set `MOCK_SCENARIO` in `wrangler.jsonc`, or re-seed the
local database (mock mode only):

```bash
curl -X POST http://127.0.0.1:8787/api/dev/mock/reset -H 'content-type: application/json' -d '{"scenario":"fatigued"}'
```

## 5. Security checklist

* Key: `wrangler secret put GARMIN_PERSONAL_API_KEY` (production) or
  `apps/api/.dev.vars` (local, git-ignored). Never in `vars`, never in D1,
  never in the web bundle.
* Access token: encrypted at rest (AES-GCM, key from a separate Worker
  secret), never returned by any endpoint, never logged.
* The API Worker has no public URL; only the Access-protected Pages origin
  reaches it.
* Logs contain domain names, status codes and counts — never tokens or
  health payloads.

## 6. Stage 6 plan

1. Verify endpoint paths, parameters and response shapes against Garmin's
   Swagger docs; capture one real response per endpoint and scrub it into
   `apps/api/test/fixtures/garmin/`.
2. `TokenManager` with tests (fake fetch): cache hit, renewal before expiry,
   renewal after 401, invalid key.
3. Pure mappers per domain, tested against the fixtures.
4. `LiveGarminProvider` composing client + mappers; FIT parsing for laps and
   downsampled streams.
5. Settings: connection status, key expiry date, *Sync now*.
6. Flip `GARMIN_MODE` to `live`.
