-- Project zones: every work area belongs to one zone of the renovation.
-- Existing areas get 'store' (חנות). Moving an existing area to another zone is a separate,
-- reviewed data change, not part of this migration.
ALTER TABLE work_areas ADD COLUMN zone TEXT NOT NULL DEFAULT 'store'
  CHECK (zone IN ('store', 'office_warehouse', 'exterior'));

-- The same kind of work (e.g. "חשמל") may exist in several zones, but only once per zone.
-- The API checks this first and shows a clear message; the index is the safety net.
CREATE UNIQUE INDEX work_areas_zone_name ON work_areas (zone, name);
