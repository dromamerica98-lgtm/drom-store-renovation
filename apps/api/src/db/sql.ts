/** Small helpers shared by repositories. All SQL lives under src/db. */

export type SqlValue = string | number | null;

/** Maps one column to a value taken from a record. */
export type Column<T> = readonly [column: string, get: (row: T) => SqlValue];

const statementCache = new Map<string, string>();

/**
 * Builds `INSERT … ON CONFLICT (key) DO UPDATE SET …` for one row.
 * Upserts make every sync idempotent: re-fetching a day overwrites it.
 */
export function upsertStatement<T>(
  db: D1Database,
  table: string,
  key: readonly string[],
  columns: readonly Column<T>[],
  row: T,
): D1PreparedStatement {
  const cacheKey = `${table}|${key.join(',')}|${columns.map((c) => c[0]).join(',')}`;
  let sql = statementCache.get(cacheKey);
  if (!sql) {
    const names = columns.map((c) => c[0]);
    const updates = names.filter((n) => !key.includes(n)).map((n) => `${n} = excluded.${n}`);
    sql =
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => `?${i + 1}`).join(', ')}) ` +
      `ON CONFLICT (${key.join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`;
    statementCache.set(cacheKey, sql);
  }
  return db.prepare(sql).bind(...columns.map(([, get]) => get(row)));
}

/** Runs statements in D1 batches (each batch is one implicit transaction). */
export async function runInBatches(db: D1Database, statements: D1PreparedStatement[], size = 50): Promise<void> {
  for (let i = 0; i < statements.length; i += size) {
    await db.batch(statements.slice(i, i + size));
  }
}

export function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value === '') return null;
  return JSON.parse(value) as T;
}

/** Coerces undefined to null so D1 bind() never sees undefined. */
export function n<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true;
}
