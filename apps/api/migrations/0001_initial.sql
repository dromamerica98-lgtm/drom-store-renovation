-- Migration 0001: initial schema
--
-- Single-user database: there are no user_id columns.
-- Conventions (see docs/DATABASE.md):
--   * "date" columns are the user's LOCAL calendar date, 'YYYY-MM-DD'.
--     Sleep belongs to the date the user woke up.
--   * Timestamps are ISO-8601 UTC text, e.g. '2026-11-12T06:30:00Z'.
--   * Units are SI: seconds, metres, metres/second, bpm, milliseconds.
--   * NULL means "not available". Zero is a real measurement.
--   * Source tables keep the provider's raw payload (raw_json) so mappings
--     can be improved and replayed without re-downloading from Garmin.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  timezone                  TEXT    NOT NULL DEFAULT 'UTC',
  units                     TEXT    NOT NULL DEFAULT 'metric'
                              CHECK (units IN ('metric', 'imperial')),
  primary_sport             TEXT    NOT NULL DEFAULT 'running'
                              CHECK (primary_sport IN ('running', 'cycling', 'other')),
  goal_type                 TEXT    NOT NULL DEFAULT 'general_fitness'
                              CHECK (goal_type IN ('general_fitness', 'base_building', '5k', '10k',
                                                   'half_marathon', 'marathon', 'weight_loss')),
  goal_event_date           TEXT,
  goal_notes                TEXT,
  -- JSON array of ISO weekdays (1 = Monday … 7 = Sunday) the user can train.
  available_days            TEXT    NOT NULL DEFAULT '[1,2,3,4,5,6,7]'
                              CHECK (json_valid(available_days) AND json_type(available_days) = 'array'),
  long_session_day          INTEGER CHECK (long_session_day BETWEEN 1 AND 7),
  preferred_duration_min    INTEGER NOT NULL DEFAULT 45 CHECK (preferred_duration_min BETWEEN 10 AND 300),
  max_duration_min          INTEGER NOT NULL DEFAULT 90 CHECK (max_duration_min BETWEEN 10 AND 600),
  quality_sessions_per_week INTEGER NOT NULL DEFAULT 2 CHECK (quality_sessions_per_week BETWEEN 0 AND 4),
  max_hr                    INTEGER CHECK (max_hr BETWEEN 120 AND 230),
  resting_hr_override       INTEGER CHECK (resting_hr_override BETWEEN 25 AND 120),
  lthr                      INTEGER CHECK (lthr BETWEEN 100 AND 220),
  threshold_pace_sec_per_km INTEGER CHECK (threshold_pace_sec_per_km BETWEEN 120 AND 900),
  birth_year                INTEGER CHECK (birth_year BETWEEN 1900 AND 2100),
  sex                       TEXT    CHECK (sex IN ('female', 'male', 'unspecified')),
  updated_at                TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (max_duration_min >= preferred_duration_min)
);

INSERT INTO settings (id) VALUES (1);

-- HR zones in bpm; pace zones in sec/km (for pace, min_value is the FAST end).
CREATE TABLE training_zones (
  kind       TEXT    NOT NULL CHECK (kind IN ('hr', 'pace')),
  zone       INTEGER NOT NULL CHECK (zone BETWEEN 1 AND 5),
  name       TEXT    NOT NULL,
  min_value  REAL    NOT NULL,
  max_value  REAL    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (kind, zone),
  CHECK (max_value >= min_value)
);

-- ---------------------------------------------------------------------------
-- Garmin source data — one table per Garmin domain, keyed by local date
-- ---------------------------------------------------------------------------

CREATE TABLE daily_summary (
  date                   TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  steps                  INTEGER CHECK (steps >= 0),
  step_goal              INTEGER,
  distance_m             REAL,
  resting_hr             INTEGER CHECK (resting_hr BETWEEN 20 AND 150),
  min_hr                 INTEGER,
  max_hr                 INTEGER,
  active_kcal            INTEGER,
  total_kcal             INTEGER,
  intensity_min_moderate INTEGER,
  intensity_min_vigorous INTEGER,
  raw_json               TEXT    CHECK (raw_json IS NULL OR json_valid(raw_json)),
  source                 TEXT    NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at             TEXT    NOT NULL,
  updated_at             TEXT    NOT NULL
);

CREATE TABLE sleep_daily (
  date              TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sleep_start       TEXT,
  sleep_end         TEXT,
  duration_sec      INTEGER CHECK (duration_sec >= 0),
  deep_sec          INTEGER,
  light_sec         INTEGER,
  rem_sec           INTEGER,
  awake_sec         INTEGER,
  score             INTEGER CHECK (score BETWEEN 0 AND 100),
  score_qualifier   TEXT,
  avg_respiration   REAL,
  avg_spo2          REAL,
  avg_sleep_stress  REAL,
  raw_json          TEXT    CHECK (raw_json IS NULL OR json_valid(raw_json)),
  source            TEXT    NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

CREATE TABLE hrv_daily (
  date               TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  last_night_avg_ms  REAL CHECK (last_night_avg_ms > 0),
  last_night_high_ms REAL,
  weekly_avg_ms      REAL,
  -- Garmin's own "balanced" range. Stored for display; the engine computes its own baseline.
  baseline_low_ms    REAL,
  baseline_high_ms   REAL,
  status             TEXT CHECK (status IN ('balanced', 'unbalanced', 'low', 'poor', 'none')),
  raw_json           TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  source             TEXT NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE body_battery_daily (
  date        TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  charged     INTEGER,
  drained     INTEGER,
  highest     INTEGER CHECK (highest BETWEEN 0 AND 100),
  lowest      INTEGER CHECK (lowest BETWEEN 0 AND 100),
  at_wake     INTEGER CHECK (at_wake BETWEEN 0 AND 100),
  end_of_day  INTEGER CHECK (end_of_day BETWEEN 0 AND 100),
  raw_json    TEXT    CHECK (raw_json IS NULL OR json_valid(raw_json)),
  source      TEXT    NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE stress_daily (
  date        TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  avg_stress  INTEGER CHECK (avg_stress BETWEEN 0 AND 100),
  max_stress  INTEGER CHECK (max_stress BETWEEN 0 AND 100),
  rest_sec    INTEGER,
  low_sec     INTEGER,
  medium_sec  INTEGER,
  high_sec    INTEGER,
  raw_json    TEXT    CHECK (raw_json IS NULL OR json_valid(raw_json)),
  source      TEXT    NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

-- Intraday curves (heart rate, stress, Body Battery …): ONE row per day per
-- metric, samples resampled to a fixed interval and stored as a JSON array
-- (null for gaps). D1 bills and limits by rows; charts read a whole day.
CREATE TABLE intraday_series (
  date          TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  metric        TEXT    NOT NULL CHECK (metric IN ('heart_rate', 'stress', 'body_battery', 'respiration', 'spo2')),
  start_at      TEXT    NOT NULL,
  interval_sec  INTEGER NOT NULL CHECK (interval_sec > 0),
  samples_json  TEXT    NOT NULL CHECK (json_valid(samples_json) AND json_type(samples_json) = 'array'),
  source        TEXT    NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  PRIMARY KEY (date, metric)
);

-- ---------------------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------------------

CREATE TABLE activities (
  id                  INTEGER PRIMARY KEY,           -- Garmin activityId
  start_at            TEXT    NOT NULL,              -- UTC
  start_local         TEXT    NOT NULL,              -- local wall clock 'YYYY-MM-DDTHH:MM:SS'
  local_date          TEXT    NOT NULL CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sport               TEXT    NOT NULL CHECK (sport IN ('running', 'trail_running', 'treadmill_running',
                                                        'cycling', 'indoor_cycling', 'swimming', 'walking',
                                                        'hiking', 'strength', 'cardio', 'yoga', 'other')),
  garmin_type_key     TEXT,
  name                TEXT,
  duration_sec        REAL    NOT NULL CHECK (duration_sec >= 0),
  moving_duration_sec REAL,
  distance_m          REAL,
  elevation_gain_m    REAL,
  avg_hr              INTEGER,
  max_hr              INTEGER,
  avg_speed_mps       REAL,
  max_speed_mps       REAL,
  avg_power_w         REAL,
  normalized_power_w  REAL,
  avg_cadence         REAL,
  calories            INTEGER,
  aerobic_te          REAL    CHECK (aerobic_te BETWEEN 0 AND 5),
  anaerobic_te        REAL    CHECK (anaerobic_te BETWEEN 0 AND 5),
  garmin_load         REAL,                          -- Garmin's EPOC-based training load
  time_in_z1_sec      REAL,
  time_in_z2_sec      REAL,
  time_in_z3_sec      REAL,
  time_in_z4_sec      REAL,
  time_in_z5_sec      REAL,
  rpe                 INTEGER CHECK (rpe BETWEEN 1 AND 10),  -- user-entered, later stage
  has_details         INTEGER NOT NULL DEFAULT 0 CHECK (has_details IN (0, 1)),
  raw_json            TEXT    CHECK (raw_json IS NULL OR json_valid(raw_json)),
  source              TEXT    NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);

CREATE INDEX idx_activities_local_date ON activities (local_date);
CREATE INDEX idx_activities_sport_date ON activities (sport, local_date);

-- Per-activity detail parsed from Garmin activity details / FIT file.
-- Streams are downsampled before storage; the original FIT file, if kept,
-- belongs in object storage (R2), referenced by fit_object_key.
CREATE TABLE activity_details (
  activity_id     INTEGER PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
  laps_json       TEXT    CHECK (laps_json IS NULL OR json_valid(laps_json)),
  streams_json    TEXT    CHECK (streams_json IS NULL OR json_valid(streams_json)),
  fit_object_key  TEXT,
  fit_size_bytes  INTEGER,
  source          TEXT    NOT NULL CHECK (source IN ('garmin', 'mock', 'manual')),
  fetched_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- Engine output — what was decided, from which inputs, by which version
-- ---------------------------------------------------------------------------

CREATE TABLE daily_assessments (
  date             TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  engine_version   TEXT    NOT NULL,
  inputs_hash      TEXT    NOT NULL,     -- unchanged hash ⇒ no need to recompute
  readiness_score  INTEGER CHECK (readiness_score BETWEEN 0 AND 100),  -- NULL while calibrating
  readiness_band   TEXT    NOT NULL CHECK (readiness_band IN ('primed', 'good', 'moderate', 'low',
                                                                'very_low', 'unknown')),
  confidence       REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  -- Denormalised load numbers so Trends can chart them with plain SQL.
  daily_load       REAL,
  atl              REAL,
  ctl              REAL,
  tsb              REAL,
  acwr             REAL,
  components_json  TEXT    NOT NULL CHECK (json_valid(components_json)),
  baselines_json   TEXT    NOT NULL CHECK (json_valid(baselines_json)),
  load_json        TEXT    NOT NULL CHECK (json_valid(load_json)),
  flags_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(flags_json)),
  computed_at      TEXT    NOT NULL
);

CREATE TABLE recommendations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  date                  TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  parent_id             INTEGER REFERENCES recommendations (id) ON DELETE CASCADE,
  origin                TEXT    NOT NULL CHECK (origin IN ('engine', 'modification')),
  modification_kind     TEXT    CHECK (modification_kind IN ('shorter', 'easier', 'harder', 'time_limit',
                                                             'rest', 'alternative')),
  modification_minutes  INTEGER CHECK (modification_minutes BETWEEN 5 AND 600),
  engine_version        TEXT    NOT NULL,
  inputs_hash           TEXT    NOT NULL,
  rule_id               TEXT    NOT NULL,   -- decision rule that produced it
  workout_type          TEXT    NOT NULL,
  duration_min          INTEGER NOT NULL CHECK (duration_min >= 0),
  workout_json          TEXT    NOT NULL CHECK (json_valid(workout_json)),
  reasons_json          TEXT    NOT NULL CHECK (json_valid(reasons_json)),
  is_current            INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  status                TEXT    NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'completed', 'skipped')),
  completed_activity_id INTEGER REFERENCES activities (id) ON DELETE SET NULL,
  created_at            TEXT    NOT NULL,
  CHECK ((origin = 'engine') = (parent_id IS NULL)),
  CHECK ((origin = 'modification') = (modification_kind IS NOT NULL)),
  CHECK (modification_kind IS NOT 'time_limit' OR modification_minutes IS NOT NULL)
);

-- At most one current recommendation per day.
CREATE UNIQUE INDEX idx_recommendations_current ON recommendations (date) WHERE is_current = 1;
CREATE INDEX idx_recommendations_date ON recommendations (date, id);

-- ---------------------------------------------------------------------------
-- Garmin connection and sync bookkeeping
-- ---------------------------------------------------------------------------

-- The Personal API key itself is a Worker secret and is NOT stored here.
-- Only the short-lived (24 h) access token is cached, AES-GCM encrypted.
CREATE TABLE garmin_credentials (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  access_token_ciphertext  TEXT,
  access_token_iv          TEXT,
  access_token_expires_at  TEXT,
  api_key_expires_at       TEXT,   -- entered in Settings so the app can warn before expiry
  updated_at               TEXT NOT NULL
);

CREATE TABLE sync_state (
  domain              TEXT PRIMARY KEY CHECK (domain IN ('daily_summary', 'sleep', 'hrv', 'body_battery',
                                                         'stress', 'activities', 'activity_details', 'intraday')),
  newest_synced_date  TEXT,
  oldest_synced_date  TEXT,
  last_success_at     TEXT,
  last_error          TEXT,
  last_error_at       TEXT,
  updated_at          TEXT NOT NULL
);

CREATE TABLE sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger      TEXT NOT NULL CHECK (trigger IN ('cron', 'manual', 'backfill')),
  provider     TEXT NOT NULL CHECK (provider IN ('mock', 'live')),
  status       TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'error')),
  range_start  TEXT,
  range_end    TEXT,
  stats_json   TEXT CHECK (stats_json IS NULL OR json_valid(stats_json)),
  error        TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE INDEX idx_sync_runs_started ON sync_runs (started_at);

-- ---------------------------------------------------------------------------
-- Coach conversation (used from the Coach stage)
-- ---------------------------------------------------------------------------

CREATE TABLE coach_messages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  date               TEXT    NOT NULL,
  recommendation_id  INTEGER REFERENCES recommendations (id) ON DELETE SET NULL,
  role               TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content            TEXT    NOT NULL,
  -- A modification the assistant proposed, expressed as an engine operation.
  action_json        TEXT    CHECK (action_json IS NULL OR json_valid(action_json)),
  model              TEXT,
  created_at         TEXT    NOT NULL
);

CREATE INDEX idx_coach_messages_date ON coach_messages (date, id);

-- ---------------------------------------------------------------------------
-- One row per day with everything the engine needs
-- ---------------------------------------------------------------------------

CREATE VIEW v_daily_metrics AS
WITH all_dates AS (
  SELECT date FROM daily_summary
  UNION SELECT date FROM sleep_daily
  UNION SELECT date FROM hrv_daily
  UNION SELECT date FROM body_battery_daily
  UNION SELECT date FROM stress_daily
)
SELECT
  d.date                 AS date,
  ds.resting_hr          AS resting_hr,
  ds.steps               AS steps,
  sl.duration_sec        AS sleep_duration_sec,
  sl.score               AS sleep_score,
  hv.last_night_avg_ms   AS hrv_last_night_ms,
  hv.weekly_avg_ms       AS hrv_weekly_avg_ms,
  hv.status              AS hrv_status,
  bb.at_wake             AS body_battery_wake,
  bb.highest             AS body_battery_high,
  bb.lowest              AS body_battery_low,
  st.avg_stress          AS stress_avg
FROM all_dates d
LEFT JOIN daily_summary      ds ON ds.date = d.date
LEFT JOIN sleep_daily        sl ON sl.date = d.date
LEFT JOIN hrv_daily          hv ON hv.date = d.date
LEFT JOIN body_battery_daily bb ON bb.date = d.date
LEFT JOIN stress_daily       st ON st.date = d.date;
