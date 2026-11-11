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
 * Builds an INSERT for a row with a new id and the created/updated columns.
 * `data` must come from a validated schema, so its keys are known column names.
 */
export function insertStatement(db: D1Database, table: string, data: Row, user: string): { id: string; stmt: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row: Row = { ...data, id, createdAt: now, createdBy: user, updatedAt: now, updatedBy: user };
  const keys = Object.keys(row);
  const stmt = db
    .prepare(`INSERT INTO ${table} (${keys.map(toSnake).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .bind(...keys.map((k) => row[k] ?? null));
  return { id, stmt };
}

/** Builds an UPDATE of the given columns plus the updated columns. */
export function updateStatement(
  db: D1Database,
  table: string,
  id: string | number,
  data: Row,
  user: string,
): D1PreparedStatement {
  const row: Row = { ...data, updatedAt: new Date().toISOString(), updatedBy: user };
  const keys = Object.keys(row);
  return db
    .prepare(`UPDATE ${table} SET ${keys.map((k) => `${toSnake(k)} = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((k) => row[k] ?? null), id);
}

export function deleteStatement(db: D1Database, table: string, id: string): D1PreparedStatement {
  return db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id);
}

export async function count(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...params).first<{ n: number }>();
  return row?.n ?? 0;
}
