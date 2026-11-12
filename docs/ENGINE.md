# Readiness & recommendation engine

`packages/engine` (`@coach/engine`) decides what you should train today.
It is **deterministic**: pure functions, no network, no database, no clock,
no randomness. The same inputs always produce the same output, stamped with
`ENGINE_VERSION` and an `inputsHash`. The AI layer explains the result; it
cannot change it except through the guarded modification operations below.

> Not medical advice. The engine uses conservative, widely used training
> heuristics. If you feel ill, rest regardless of the score.

## 1. Inputs and outputs

```ts
assessDay({
  date,         // the day being planned (local date)
  metrics,      // DailyMetrics[] — one row per day, ideally ≥ 60 days
  activities,   // ActivitySummary[] — only those before `date` are used
  settings,     // AthleteSettings — goal, days, durations, HR/pace zones
}) → DailyAssessment {
  readiness,    // score 0–100, band, confidence, 5 components
  baselines,    // personal mean/SD per metric
  load,         // ATL, CTL, TSB, ACWR, volume, intensity distribution, streaks
  flags,        // machine-readable warnings (illness pattern, load spike …)
  zones,        // resolved HR and pace zones (+ where they came from)
  recommendation: { ruleId, workout, reasons, summary, harder },
}

applyModification(assessment, currentWorkout, { kind, minutes? }, settings)
  → { applied, workout, reasons }
```

Inputs are sorted internally, so caller ordering never changes the result.
Activities on the assessed date are ignored: today's plan is based on the
state you woke up in, so finishing the workout does not rewrite it.

## 2. Pipeline

```
metrics ──▶ personal baselines ──▶ readiness components ──▶ readiness score ─┐
        └─▶ recovery flags ─────────────────────────────────────────────────┤
activities ─▶ per-activity load ─▶ ATL / CTL / ACWR, streaks ─▶ load flags ──┤
settings ──▶ zones                                                          ▼
                                             decision rules (R1…R9) + guard
                                                          │
                                                          ▼
                                     workout builder ─▶ structured workout
                                                          │
                                       reasons (codes + sentences), summary
```

## 3. Personal baselines (`baselines.ts`)

* Window: the **42 days before** the assessed date (today excluded).
* Minimum: **14 days** with data, otherwise the baseline is *calibrating*.
* HRV is log-transformed (ln rMSSD); its baseline mean is a geometric mean.
* Stress is judged on **yesterday's** full-day average, so its baseline window
  ends the day before yesterday.
* SD floors stop a very stable history from exaggerating small changes:

| Metric | Source | SD floor |
| --- | --- | --- |
| HRV | last-night average | 0.05 ln units (~5 %) |
| Resting HR | daily resting HR | 1.5 bpm |
| Sleep duration | total sleep | 30 min |
| Sleep score | Garmin sleep score | 4 points |
| Body Battery | value at wake | 5 points |
| Stress | daily average | 3 points |

## 4. Readiness (`readiness.ts`)

Each component's z-score is oriented so positive is good, then mapped:

```
score = clamp(70 + 20 × z_good, 0, 100)
```

| z_good | Score | Meaning |
| --- | --- | --- |
| +1.5 | 100 | clearly better than your normal |
| +1 | 90 | |
| 0 | 70 | your normal |
| −1 | 50 | |
| −2 | 30 | clearly worse than your normal |

| Component | Weight | Notes |
| --- | --- | --- |
| HRV | 0.30 | Also checks the 7-day HRV average: > 0.5 SD below baseline → `hrv_trend_low` |
| Sleep | 0.25 | Mean of duration and sleep-score components. Absolute caps: < 6 h → max 50, < 5 h → max 30 |
| Resting HR | 0.20 | Lower is better; today's value, else yesterday's |
| Body Battery | 0.15 | Value at wake. Absolute cap: < 25 → max 35 |
| Stress | 0.10 | Yesterday's average, lower is better |

* **Readiness** = weighted mean of the available components.
* **Confidence** (0–1) = share of the total weight backed by a personal
  baseline (components on fallback count 0.6). Below 0.25 → no score.
* **Bands**: ≥ 80 primed · 65–79 good · 50–64 moderate · 35–49 low · < 35 very low.
* **While calibrating** a component falls back to Garmin's HRV status
  (balanced 70, unbalanced 50, low 35, poor 25), the sleep score / duration,
  the raw Body Battery, or a raw stress mapping — at reduced confidence.
  Resting HR has no fallback (it means nothing without your baseline).

## 5. Training load (`load.ts`)

Per-activity load, computed the same way for every activity:

1. **Edwards TRIMP** from time in HR zones: Σ minutes in zone × zone number.
2. **Banister TRIMP** from average HR (scaled ×1.3 to Edwards magnitude) if
   zone times are missing.
3. **Duration × sport factor** (run 2, bike/swim 1.8, strength 1.5, walk 1,
   mobility 0.8 per minute) if there is no HR.

Garmin's own training load is stored and shown but not mixed in, so the
model stays consistent when Garmin omits it.

| Output | Definition |
| --- | --- |
| ATL | 7-day exponentially weighted daily load ("fatigue") |
| CTL | 42-day exponentially weighted daily load ("fitness") |
| TSB | CTL − ATL ("form") |
| ACWR | ATL / CTL; `null` until 21 days of history and CTL ≥ 5 |
| Intensity class | **hard**: ≥ 8 min in Z4–5 or ≥ 20 min in Z3–5 · **long**: ≥ 85 min · **moderate**: ≥ 10 min Z3 · else **easy**. Strength, mobility and walks count as easy. Without zones: training effect. |
| Quality type | vo2max (≥ 4 min Z5) · threshold (Z4 ≥ Z3) · tempo |
| Streaks | consecutive hard/long days, days since rest, since hard, since long |
| Volume | last 7 days, previous 7, average week over 28 days; 28-day Z1–2 / Z3 / Z4–5 split |

All values describe the state **entering** the assessed day.

## 6. Flags

| Flag | Condition | Severity |
| --- | --- | --- |
| `illness_pattern` | RHR z ≥ 2 **and** ≥ +4 bpm, **and** HRV z ≤ −1.5 | critical |
| `rhr_elevated` | RHR z ≥ 2 or ≥ +5 bpm (without the illness pattern) | warning |
| `hrv_suppressed` | HRV z ≤ −1.5 | warning |
| `hrv_trend_low` | 7-day mean ln HRV > 0.5 SD below baseline | caution |
| `very_short_sleep` / `short_sleep` | < 5 h / < 6 h or z ≤ −1.5 | warning / caution |
| `body_battery_low` | < 30 at wake | caution |
| `high_stress` | yesterday's stress z ≥ 1.5 | caution |
| `load_spike` / `load_high` / `load_low` | ACWR > 1.5 / > 1.3 / < 0.8 | warning / caution / info |
| `consecutive_hard_days` | ≥ 2 hard or long days in a row | caution |
| `no_rest_day` | ≥ 6 days without rest | caution |
| `missing_today_data` | no sleep and no HRV for last night | caution |
| `calibrating` | HRV, RHR or sleep baseline < 14 days | info |
| `load_history_short` | < 21 days of history | info |

## 7. Decision rules (`decision.ts`)

First match wins.

| Rule | When | Workout |
| --- | --- | --- |
| R1 `ILLNESS` | `illness_pattern` | rest |
| R2 `VERY_LOW_READINESS` | readiness < 35 | rest |
| R3 `UNAVAILABLE_DAY` | weekday not in available days | rest |
| R4 `RECOVERY_NEEDED` | readiness < 50, or `load_spike`, or `very_short_sleep` | recovery, 20–30 min Z1 |
| R5 `REST_OVERDUE` | ≥ 6 days without rest | rest (recovery if readiness ≥ 80) |
| R6 `AFTER_HARD_DAY` | yesterday hard/long, or ≥ 2 hard days in a row | easy |
| R7 `LONG_DAY` | long-session day (Settings, else weekend with no long run in 6 days), readiness ≥ 55, load not high | long |
| R8 `QUALITY_DAY` | readiness ≥ 65, no `hrv_trend_low`, load not high, last hard ≥ 2 days ago, quality quota not met | tempo / threshold / VO₂max |
| R9 `EASY_DEFAULT` | otherwise | easy |

**Quality quota**: hard days in the 6 days before today must be below
*quality sessions per week* (so a session today keeps the rolling 7-day count
within target).

**Quality choice**: rotate through the goal's list, skipping the last quality
type done; VO₂max needs readiness ≥ 75.

| Goal | Rotation |
| --- | --- |
| 5k | VO₂max → threshold → tempo |
| 10k | threshold → VO₂max → tempo |
| Half marathon | threshold → tempo |
| Marathon | tempo → threshold |
| General fitness | tempo → threshold → VO₂max |
| Base building | tempo |
| Weight loss | tempo → threshold |

**Guard**: a quality decision is downgraded to easy when confidence < 0.5,
baselines are calibrating, or last night's data is missing.

**Duration** (rounded to 5 min, within Settings' maximum):

| Type | Duration |
| --- | --- |
| recovery | 60 % of preferred, 20–30 min |
| easy | preferred; × 0.85 if readiness < 65; × 1.1 if ACWR < 0.8; × 0.85 if ACWR > 1.3 |
| long | ≤ 110 % of the longest session in 28 days (≤ 2.2 × preferred), at least preferred + 15 |
| quality | preferred (min 40) |

## 8. Workouts (`workouts.ts`)

| Type | Structure | Target |
| --- | --- | --- |
| rest | — | optional walk/mobility |
| mobility | one block | RPE 1–2 |
| recovery | one block (≤ 40 min) | Z1 |
| easy | 10 min warm-up · main · 5 min cool-down | Z2 |
| long | 10 min warm-up · steady main · 10 min cool-down | Z2 |
| tempo | 10–15 min warm-up · up to 40 min continuous · cool-down | Z3 |
| threshold | warm-up · 2–5 × 8 min (6 min if short) w/ 2 min easy · cool-down | Z4 |
| VO₂max | warm-up + strides · 3–6 × 3 min (2 min if short) w/ equal easy · cool-down | Z5 |

Every step has: HR zone + bpm range, pace range (running, when pace zones are
known), RPE range and an effort cue. Zones come from Settings, else LTHR
(Friel), else max HR (Garmin %max defaults), else an age estimate (with a note),
else RPE only. Pace zones come from Settings or threshold pace.

## 9. Modifications and guardrails (`modify.ts`)

Each modification transforms the **current** workout, so they chain.

| Request | Behaviour |
| --- | --- |
| Make it shorter | ~70 % of the time; never below the useful minimum (quality 35, long 60 → becomes easy, easy 20) |
| Make it easier | one step down: VO₂max → threshold → tempo → easy → recovery → rest; long → shorter easy |
| Make it harder | one step up: rest → recovery → easy → tempo → threshold → VO₂max; long → +15 min. **Guarded** |
| I only have X minutes | fit to X; quality < 35 min → easy (or recovery < 20); long < 60 → easy |
| Rest day | always allowed |
| Alternative | same stimulus, other modality: run → bike → elliptical; rest ↔ mobility |

**"Harder" guard** — stepping up to a quality session is refused if any of:
illness pattern, readiness < 65 or unknown, confidence < 0.5, load spike/high,
HRV suppressed or trending low, short sleep, yesterday hard, ≥ 2 hard days in a
row, or the weekly quality quota already met. VO₂max additionally needs
readiness ≥ 75. Stepping up to recovery/easy is refused only on the illness
pattern or readiness < 35. A refusal returns the blocking reasons. Today's
recommendation carries `harder.qualityAllowed` so the UI can say why up front.

## 10. Reasons

Every recommendation has `reasons[]`, decisive reason first:

```json
{ "code": "YESTERDAY_HARD", "tone": "neutral",
  "message": "Yesterday was \"Intervals\". An easy aerobic day today lets you absorb it …",
  "data": { "consecutiveHardDays": 1 } }
```

`code` is stable and machine-readable (e.g. `ILLNESS_PATTERN`, `LOAD_SPIKE`,
`QUALITY_DUE`, `QUALITY_ROTATION`, `HRV_BELOW_NORMAL`, `READINESS_GOOD`,
`CONSERVATIVE_LOW_CONFIDENCE`, `MOD_HARDER_REFUSED`). `message` is a
deterministic sentence the UI shows as-is. `summary` joins readiness, the
decisive reason and the workout in one paragraph.

## 11. Contract with the AI layer (Coach stage)

The LLM receives the `DailyAssessment` JSON (readiness components with values
and baselines, load, flags, recommendation, reasons) and the user's question.
It may:

1. explain the reasoning in natural language, grounded in the reason codes and
   numbers it was given;
2. propose a change **only** as one of the modification kinds above, which
   the Worker executes through `applyModification` — including the guard;
3. answer questions about the recommendation and the metrics.

It may not produce workouts, numbers or targets that did not come from the
engine.

## 12. Versioning

`ENGINE_VERSION` (semver) is stored with every assessment and recommendation.
Bump the minor version for any rule or threshold change, the major version
for a change in output shape. `inputsHash` covers the engine version, the
assessed date, the relevant metrics and activities, and settings, so the API
recomputes only when something that matters changed.

## 13. Tests

`packages/engine/test/` — 75 unit tests: baselines (window, log-HRV, SD floors,
calibration), zones, load (TRIMP variants, ACWR steady state and spike,
streaks), readiness (bands, illness vs. elevated RHR, sleep caps, HRV trend,
fallbacks), every decision rule R1–R9 and the guard, workout structures and
durations, every modification and its guardrails, determinism and input-order
independence.
