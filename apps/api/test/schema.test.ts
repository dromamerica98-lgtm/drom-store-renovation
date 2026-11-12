import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, splitSql, type TestDb } from './helpers/db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.dispose());
beforeEach(() => resetDb(t.db));

const NOW = '2026-11-12T07:00:00Z';

describe('migration splitter', () => {
  it('ignores semicolons inside strings and comments', () => {
    expect(splitSql("-- a; b\nSELECT ';' AS x; SELECT 2;")).toEqual(["SELECT ';' AS x", 'SELECT 2']);
  });
});

describe('schema 0001', () => {
  it('creates every table and the engine view', async () => {
    const { results } = await t.db
      .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%' ORDER BY name")
      .all<{ name: string; type: string }>();
    expect(results.map((r) => r.name)).toEqual([
      'activities',
      'activity_details',
      'body_battery_daily',
      'coach_messages',
      'daily_assessments',
      'daily_summary',
      'garmin_credentials',
      'hrv_daily',
      'intraday_series',
      'recommendations',
      'settings',
      'sleep_daily',
      'stress_daily',
      'sync_runs',
      'sync_state',
      'training_zones',
      'v_daily_metrics',
    ]);
  });

  it('seeds a single settings row and refuses a second one', async () => {
    const row = await t.db.prepare('SELECT * FROM settings').first<{ id: number; preferred_duration_min: number }>();
    expect(row?.id).toBe(1);
    expect(row?.preferred_duration_min).toBe(45);
    await expect(t.db.prepare('INSERT INTO settings (id) VALUES (2)').run()).rejects.toThrow(/CHECK/);
  });

  it('rejects malformed dates and out-of-range values', async () => {
    const insertSleep = (date: string, score: number) =>
      t.db
        .prepare("INSERT INTO sleep_daily (date, score, source, fetched_at, updated_at) VALUES (?1, ?2, 'mock', ?3, ?3)")
        .bind(date, score, NOW)
        .run();
    await expect(insertSleep('12/11/2026', 80)).rejects.toThrow(/CHECK/);
    await expect(insertSleep('2026-11-12', 101)).rejects.toThrow(/CHECK/);
    await expect(insertSleep('2026-11-12', 80)).resolves.toBeTruthy();
  });

  it('allows only one current recommendation per day', async () => {
    const insert = (isCurrent: number) =>
      t.db
        .prepare(
          `INSERT INTO recommendations (date, origin, engine_version, inputs_hash, rule_id, workout_type, duration_min,
             workout_json, reasons_json, is_current, created_at)
           VALUES ('2026-11-12', 'engine', '0.1.0', 'h', 'R1', 'easy', 45, '{}', '[]', ?1, ?2)`,
        )
        .bind(isCurrent, NOW)
        .run();
    await insert(1);
    await insert(0);
    await expect(insert(1)).rejects.toThrow(/UNIQUE/);
  });

  it('requires a parent and a kind for modified recommendations', async () => {
    const run = (origin: string, parent: number | null, kind: string | null) =>
      t.db
        .prepare(
          `INSERT INTO recommendations (date, parent_id, origin, modification_kind, engine_version, inputs_hash, rule_id,
             workout_type, duration_min, workout_json, reasons_json, created_at)
           VALUES ('2026-11-12', ?1, ?2, ?3, '0.1.0', 'h', 'R1', 'easy', 30, '{}', '[]', ?4)`,
        )
        .bind(parent, origin, kind, NOW)
        .run();
    const engine = await run('engine', null, null);
    const parentId = engine.meta.last_row_id;
    await expect(run('modification', null, 'shorter')).rejects.toThrow(/CHECK/);
    await expect(run('modification', parentId, null)).rejects.toThrow(/CHECK/);
    await expect(run('modification', parentId, 'shorter')).resolves.toBeTruthy();
  });
});
