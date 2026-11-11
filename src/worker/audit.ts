import type { AuditAction, AuditEntity } from '../shared/audit';
import { ZONE_LABELS, isZone } from '../shared/labels';
import { formatILS } from '../shared/money';
import { all } from './db';

/**
 * Change history. Each change is written together with its audit row in one D1 batch
 * (a transaction), so there is no change without a record and no record without a change.
 * The actor is always the email Cloudflare Access verified (c.get('user')).
 */

type Row = Record<string, unknown>;

/** Bookkeeping columns and storage keys are not part of the history. */
const IGNORED = new Set(['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'sortOrder', 'r2Key']);

export function snapshot(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !IGNORED.has(k)));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** {field: [before, after]} for the fields of `after` that changed. */
export function diff(before: Row, after: Row): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(after)) {
    if (IGNORED.has(key) || same(before[key], value)) continue;
    changes[key] = [before[key] ?? null, value ?? null];
  }
  return changes;
}

export interface AuditRecord {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  label: string;
  changes: Row;
  refs?: Record<string, string>;
}

export function auditStatement(db: D1Database, actor: string, r: AuditRecord): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (at, actor, action, entity, entity_id, label, changes, refs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(new Date().toISOString(), actor, r.action, r.entity, r.entityId, r.label, JSON.stringify(r.changes), JSON.stringify(r.refs ?? {}));
}

/**
 * Names of the items referred to by id: areas, suppliers, expenses, and quotes (by supplier name).
 * Stored with each record so the history still reads well after those items change or are deleted.
 */
export async function lookupNames(
  db: D1Database,
  ids: { areas?: (string | null | undefined)[]; suppliers?: (string | null | undefined)[]; expenses?: (string | null | undefined)[]; quotes?: (string | null | undefined)[] },
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const list = (xs?: (string | null | undefined)[]) => [...new Set((xs ?? []).filter((x): x is string => !!x))];
  const query = async (sql: string, values: string[]) => {
    if (!values.length) return;
    const rows = await all<{ id: string; name: string }>(db, sql.replace('?', values.map(() => '?').join(', ')), ...values);
    for (const r of rows) names[r.id] = r.name;
  };
  const areaIds = list(ids.areas);
  if (areaIds.length) {
    const rows = await all<{ id: string; name: string; zone: string }>(
      db,
      `SELECT id, name, zone FROM work_areas WHERE id IN (${areaIds.map(() => '?').join(', ')})`,
      ...areaIds,
    );
    for (const r of rows) names[r.id] = areaAuditLabel(r);
  }
  await query('SELECT id, name FROM suppliers WHERE id IN (?)', list(ids.suppliers));
  await query('SELECT id, description AS name FROM expenses WHERE id IN (?)', list(ids.expenses));
  const quoteIds = list(ids.quotes);
  if (quoteIds.length) {
    const rows = await all<{ id: string; supplier: string; name: string; zone: string }>(
      db,
      `SELECT q.id, s.name AS supplier, a.name, a.zone FROM quotes q
         JOIN suppliers s ON s.id = q.supplier_id JOIN work_areas a ON a.id = q.work_area_id
        WHERE q.id IN (${quoteIds.map(() => '?').join(', ')})`,
      ...quoteIds,
    );
    for (const r of rows) names[r.id] = `${r.supplier} · ${areaAuditLabel(r)}`;
  }
  return names;
}

/** How a work area is named in the history: "חשמל · משרד מחסן". */
export function areaAuditLabel(area: { name?: unknown; zone?: unknown }): string {
  return isZone(area.zone) ? `${String(area.name)} · ${ZONE_LABELS[area.zone]}` : String(area.name);
}

export function paymentLabel(p: Record<string, unknown>, names: Record<string, string>): string {
  const target = names[String(p.workAreaId ?? p.expenseId ?? '')] ?? '';
  const amount = typeof p.amount === 'number' ? formatILS(p.amount) : '';
  return [amount, target].filter(Boolean).join(' · ');
}
