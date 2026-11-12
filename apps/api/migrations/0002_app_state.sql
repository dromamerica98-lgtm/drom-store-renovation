-- Migration 0002: small key/value store for app-level state that is not a
-- setting the user edits (e.g. the active mock-data scenario).

CREATE TABLE app_state (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  TEXT NOT NULL
);
