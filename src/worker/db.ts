/** Thin helpers over D1 that map between camelCase API objects and snake_case columns. */

type Row = Record<string, unknown>;

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function camelRow<T>(row: Row): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v])) as T;
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<Row>();
  return results.map((r) => camelRow<T>(r));
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...params).first<Row>();
  return row ? camelRow<T>(row) : null;
}

/**
 * Inserts a row with a new id and audit columns.
 * `data` must come from a validated schema, so its keys are known column names.
 */
export async function insert(db: D1Database, table: string, data: Row, user: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row: Row = { ...data, id, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
  const keys = Object.keys(row);
  await db
    .prepare(`INSERT INTO ${table} (${keys.map(toSnake).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .bind(...keys.map((k) => row[k] ?? null))
    .run();
  return id;
}

/** Updates the given columns and the audit columns. Returns false when the row does not exist. */
export async function update(
  db: D1Database,
  table: string,
  id: string | number,
  data: Row,
  user: string,
): Promise<boolean> {
  const row: Row = { ...data, updatedAt: new Date().toISOString(), updatedBy: user };
  const keys = Object.keys(row);
  const result = await db
    .prepare(`UPDATE ${table} SET ${keys.map((k) => `${toSnake(k)} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => row[k] ?? null), id)
    .run();
  return result.meta.changes > 0;
}

export async function remove(db: D1Database, table: string, id: string): Promise<boolean> {
  const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return result.meta.changes > 0;
}

export async function count(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...params).first<{ n: number }>();
  return row?.n ?? 0;
}
