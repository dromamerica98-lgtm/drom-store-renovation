/**
 * Test database: a real local D1 (workerd + SQLite) from wrangler's
 * getPlatformProxy, in memory, with every migration in ./migrations applied.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../../src/env';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Splits a migration file into statements (quote- and comment-aware). */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let quote: "'" | '"' | null = null;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      i++;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i++;
    } else if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export async function applyMigrations(db: D1Database): Promise<void> {
  const dir = `${apiRoot}migrations/`;
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const statements = splitSql(readFileSync(dir + file, 'utf8'));
    await db.batch(statements.map((s) => db.prepare(s)));
  }
}

export interface TestDb {
  db: D1Database;
  env: Env;
  dispose: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const { env, dispose } = await getPlatformProxy<Env>({
    configPath: `${apiRoot}wrangler.jsonc`,
    persist: false,
  });
  await applyMigrations(env.DB);
  return { db: env.DB, env, dispose };
}

const DATA_TABLES = [
  'coach_messages',
  'recommendations',
  'daily_assessments',
  'activity_details',
  'activities',
  'intraday_series',
  'daily_summary',
  'sleep_daily',
  'hrv_daily',
  'body_battery_daily',
  'stress_daily',
  'sync_runs',
  'sync_state',
  'garmin_credentials',
  'training_zones',
];

/** Empties every table and restores default settings, between tests. */
export async function resetDb(db: D1Database): Promise<void> {
  await db.batch([
    ...DATA_TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)),
    db.prepare('DELETE FROM settings'),
    db.prepare('INSERT INTO settings (id) VALUES (1)'),
  ]);
}
