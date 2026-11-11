import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { MAX_FILE_BYTES } from '../shared/files';
import type {
  ChangeOrder,
  Dataset,
  Expense,
  Payment,
  Quote,
  QuoteFile,
  Settings,
  Supplier,
  WorkArea,
} from '../shared/types';
import { accessAuth, accessLogoutUrl, expiredAccessCookies } from './access';
import type { AuditEntity } from '../shared/audit';
import { duplicateAreaMessage, normalizeAreaName } from '../shared/labels';
import { areaAuditLabel, auditStatement, diff, lookupNames, paymentLabel, snapshot, type AuditRecord } from './audit';
import { all, count, deleteStatement, first, insertStatement, updateStatement } from './db';
import { contentDisposition, detectFileType, sanitizeFileName } from './files';
import {
  changeOrderSchema,
  changeOrderUpdateSchema,
  expenseSchema,
  paymentSchema,
  quoteCreateSchema,
  quoteUpdateSchema,
  selectionSchema,
  settingsSchema,
  supplierSchema,
  workAreaSchema,
  workAreaUpdateSchema,
} from './schemas';

type AppEnv = { Bindings: Env; Variables: { user: string } };
type Ctx = Context<AppEnv>;

const app = new Hono<AppEnv>().basePath('/api');

/**
 * Every API request needs an identity verified by Cloudflare Access: `ctx.access` (or, as a
 * fallback, the Access JWT checked against the team's keys); see access.ts. Plain headers are
 * never trusted. Under `vite dev` the identity is simulated by wrangler from the `access.dev`
 * block in wrangler.jsonc, and only then may ACCESS_AUD be left empty; production builds
 * compile that allowance away.
 */
app.use('*', accessAuth({ allowAnyAud: import.meta.env.DEV }));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'שגיאה בשרת' }, 500);
});

async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  const json: unknown = await c.req.json().catch(() => null);
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? ` (${issue.path.join('.')})` : '';
    throw new HTTPException(400, { message: `נתונים לא תקינים${where}: ${issue.message}` });
  }
  return result.data;
}

function notFound(): never {
  throw new HTTPException(404, { message: 'הרשומה לא נמצאה' });
}

function conflict(message: string): never {
  throw new HTTPException(409, { message });
}

/** Throws 400 with `message` (e.g. "הספק לא נמצא") when the row does not exist. */
async function requireExists(c: Ctx, table: string, id: string, message: string) {
  if (!(await count(c.env.DB, `SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id))) {
    throw new HTTPException(400, { message });
  }
}

// ---------- Everything at once ----------

app.get('/data', async (c) => {
  const db = c.env.DB;
  const settingsRow = await first<Settings & { id?: number }>(db, 'SELECT * FROM settings WHERE id = 1');
  if (!settingsRow) throw new HTTPException(500, { message: 'הגדרות הפרויקט חסרות' });
  const { id: _id, ...settings } = settingsRow;
  const [suppliers, workAreas, quotes, quoteFiles, changeOrders, expenses, payments] = await Promise.all([
    all<Supplier>(db, 'SELECT * FROM suppliers ORDER BY name'),
    all<WorkArea>(db, 'SELECT * FROM work_areas ORDER BY sort_order, name'),
    all<Quote>(db, 'SELECT * FROM quotes ORDER BY received_date DESC, created_at DESC'),
    all<QuoteFile>(
      db,
      'SELECT id, quote_id, file_name, content_type, size, created_at, created_by FROM quote_files ORDER BY created_at',
    ),
    all<ChangeOrder>(db, 'SELECT * FROM change_orders ORDER BY date, created_at'),
    all<Expense>(db, 'SELECT * FROM expenses ORDER BY created_at'),
    all<Payment>(db, 'SELECT * FROM payments ORDER BY date DESC, created_at DESC'),
  ]);
  const data: Dataset = {
    settings,
    suppliers,
    workAreas,
    quotes,
    quoteFiles,
    changeOrders,
    expenses,
    payments,
    user: {
      email: c.get('user'),
      logoutUrl: import.meta.env.DEV ? null : accessLogoutUrl(c.env.ACCESS_TEAM_DOMAIN),
      isAdmin: isAdmin(c),
    },
  };
  return c.json(data);
});

// ---------- Sign out ----------

/**
 * First step of signing out: deletes the Access cookie of this hostname, so the app stops
 * being signed in right away. The browser then goes to the team logout address, which ends
 * the Access session itself (see src/client/auth.ts).
 */
app.post('/logout', (c) => {
  for (const cookie of expiredAccessCookies()) c.header('Set-Cookie', cookie, { append: true });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});

// ---------- Change history ----------

type Row = Record<string, unknown>;

/** Owners who may read the change history (ADMIN_EMAILS, comma separated). Local development: everyone. */
function isAdmin(c: Ctx): boolean {
  if (import.meta.env.DEV) return true;
  const admins = (c.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(c.get('user'));
}

/** Runs the statements and their audit rows as one transaction. */
async function commit(c: Ctx, statements: D1PreparedStatement[], records: AuditRecord[]) {
  const user = c.get('user');
  try {
    return await c.env.DB.batch([...statements, ...records.map((r) => auditStatement(c.env.DB, user, r))]);
  } catch (e) {
    // Safety net for two people adding the same area at the same moment (unique zone + name).
    if (e instanceof Error && e.message.includes('UNIQUE constraint failed: work_areas')) {
      conflict('כבר קיים תחום בשם הזה באותו אזור. בחרו אזור אחר או שם אחר.');
    }
    throw e;
  }
}

/** The same work area name may appear in several zones, but only once in each zone. */
/**
 * Rejects a second work area with the same name in the same zone. Names are compared after
 * trimming, collapsing spaces and ignoring case, so rows saved before names were normalized
 * (e.g. with a double space) still count.
 */
async function assertUniqueArea(c: Ctx, name: string, zone: WorkArea['zone'], exceptId = '') {
  const inZone = await all<{ id: string; name: string }>(
    c.env.DB,
    'SELECT id, name FROM work_areas WHERE zone = ? AND id <> ?',
    zone,
    exceptId,
  );
  const wanted = normalizeAreaName(name);
  if (inZone.some((a) => normalizeAreaName(a.name) === wanted)) conflict(duplicateAreaMessage(name, zone));
}

/** An update record, or nothing when no field actually changed. */
function updated(entity: AuditEntity, entityId: string, label: string, before: Row, after: Row, refs?: Record<string, string>): AuditRecord[] {
  const changes = diff(before, after);
  return Object.keys(changes).length ? [{ action: 'update', entity, entityId, label, changes, refs }] : [];
}

async function existing(c: Ctx, table: string, id: string): Promise<Row> {
  const row = await first<Row>(c.env.DB, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) notFound();
  return row;
}

const AUDIT_ENTITIES = new Set<AuditEntity>(['settings', 'supplier', 'work_area', 'quote', 'quote_file', 'change_order', 'expense', 'payment']);

/** The change history, newest first. Owners only. */
app.get('/audit', async (c) => {
  if (!isAdmin(c)) throw new HTTPException(403, { message: 'יומן השינויים זמין רק לבעלי האפליקציה' });
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
  const where: string[] = [];
  const params: unknown[] = [];
  const before = Number(c.req.query('before') ?? 0);
  if (before > 0) {
    where.push('id < ?');
    params.push(before);
  }
  const actor = c.req.query('actor');
  if (actor) {
    where.push('actor = ?');
    params.push(actor.toLowerCase());
  }
  if (c.req.query('others') === '1') {
    where.push('actor <> ?');
    params.push(c.get('user'));
  }
  const entity = c.req.query('entity');
  if (entity && AUDIT_ENTITIES.has(entity as AuditEntity)) {
    where.push('entity = ?');
    params.push(entity);
  }
  const rows = await all<Row & { changes: string; refs: string }>(
    c.env.DB,
    `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
    ...params,
    limit + 1,
  );
  const actors = await all<{ actor: string }>(c.env.DB, 'SELECT DISTINCT actor FROM audit_log ORDER BY actor');
  return c.json({
    entries: rows.slice(0, limit).map((r) => ({ ...r, changes: JSON.parse(r.changes), refs: JSON.parse(r.refs) })),
    hasMore: rows.length > limit,
    actors: actors.map((a) => a.actor),
  });
});

// ---------- Settings ----------

app.put('/settings', async (c) => {
  const data = await body(c, settingsSchema);
  const before = (await first<Row>(c.env.DB, 'SELECT * FROM settings WHERE id = 1')) ?? {};
  await commit(c, [updateStatement(c.env.DB, 'settings', 1, data, c.get('user'))], updated('settings', '1', 'הגדרות הפרויקט', before, data));
  return c.json({ ok: true });
});

// ---------- Suppliers ----------

app.post('/suppliers', async (c) => {
  const data = await body(c, supplierSchema);
  const { id, stmt } = insertStatement(c.env.DB, 'suppliers', data, c.get('user'));
  await commit(c, [stmt], [{ action: 'create', entity: 'supplier', entityId: id, label: data.name, changes: snapshot(data) }]);
  return c.json({ id }, 201);
});

app.put('/suppliers/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, supplierSchema);
  const before = await existing(c, 'suppliers', id);
  await commit(c, [updateStatement(c.env.DB, 'suppliers', id, data, c.get('user'))], updated('supplier', id, data.name, before, data));
  return c.json({ ok: true });
});

app.delete('/suppliers/:id', async (c) => {
  const id = c.req.param('id');
  if (await count(c.env.DB, 'SELECT COUNT(*) AS n FROM quotes WHERE supplier_id = ?', id)) {
    conflict('לספק יש הצעות מחיר. מחקו אותן קודם.');
  }
  const before = await existing(c, 'suppliers', id);
  await commit(c, [deleteStatement(c.env.DB, 'suppliers', id)], [
    { action: 'delete', entity: 'supplier', entityId: id, label: String(before.name), changes: snapshot(before) },
  ]);
  return c.json({ ok: true });
});

// ---------- Work areas ----------

app.post('/areas', async (c) => {
  const data = await body(c, workAreaSchema);
  await assertUniqueArea(c, data.name, data.zone);
  if (!data.sortOrder) {
    data.sortOrder = 1 + (await count(c.env.DB, 'SELECT COALESCE(MAX(sort_order), 0) AS n FROM work_areas'));
  }
  const { id, stmt } = insertStatement(c.env.DB, 'work_areas', data, c.get('user'));
  await commit(c, [stmt], [{ action: 'create', entity: 'work_area', entityId: id, label: areaAuditLabel(data), changes: snapshot(data) }]);
  return c.json({ id }, 201);
});

/** Edits, including progress and status. */
app.put('/areas/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, workAreaUpdateSchema);
  const before = await existing(c, 'work_areas', id);
  // Keep the stored spelling when only spacing or case differs, so an unrelated edit
  // (e.g. progress) never rewrites an existing name.
  if (normalizeAreaName(data.name) === normalizeAreaName(String(before.name))) data.name = String(before.name);
  await assertUniqueArea(c, data.name, data.zone, id);
  await commit(c, [updateStatement(c.env.DB, 'work_areas', id, data, c.get('user'))], updated('work_area', id, areaAuditLabel(data), before, data));
  return c.json({ ok: true });
});

app.delete('/areas/:id', async (c) => {
  const id = c.req.param('id');
  if (await count(c.env.DB, 'SELECT COUNT(*) AS n FROM payments WHERE work_area_id = ?', id)) {
    conflict('לתחום יש תשלומים. מחקו או העבירו אותם קודם.');
  }
  const before = await existing(c, 'work_areas', id);
  const keys = await fileKeys(c, 'q.work_area_id = ?', id);
  const quotes = await count(c.env.DB, 'SELECT COUNT(*) AS n FROM quotes WHERE work_area_id = ?', id);
  const changeOrders = await count(c.env.DB, 'SELECT COUNT(*) AS n FROM change_orders WHERE work_area_id = ?', id);
  const cascade = quotes || keys.length || changeOrders
    ? `נמחקו איתו ${quotes} הצעות, ${keys.length} קבצים ו־${changeOrders} תוספות`
    : '';
  // Quotes, their file rows and change orders are removed by ON DELETE CASCADE.
  await commit(c, [deleteStatement(c.env.DB, 'work_areas', id)], [
    { action: 'delete', entity: 'work_area', entityId: id, label: areaAuditLabel(before), changes: { ...snapshot(before), cascade } },
  ]);
  await deleteObjects(c, keys);
  return c.json({ ok: true });
});

/** Selects a quote for a work area (or clears the selection with quoteId: null). */
app.post('/areas/:id/selection', async (c) => {
  const areaId = c.req.param('id');
  const { quoteId } = await body(c, selectionSchema);
  const area = (await existing(c, 'work_areas', areaId)) as Row & WorkArea;

  let status = area.status;
  if (quoteId) {
    const quote = await first<Quote>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', quoteId);
    if (!quote || quote.workAreaId !== areaId) throw new HTTPException(400, { message: 'ההצעה לא שייכת לתחום' });
    if (quote.status === 'rejected') conflict('אי אפשר לבחור הצעה שנדחתה');
    if (status === 'not_started' || status === 'collecting_quotes') status = 'supplier_selected';
  } else if (status === 'supplier_selected') {
    status = 'collecting_quotes';
  }
  const after = { selectedQuoteId: quoteId, status };
  const refs = await lookupNames(c.env.DB, { quotes: [area.selectedQuoteId, quoteId] });
  await commit(c, [updateStatement(c.env.DB, 'work_areas', areaId, after, c.get('user'))], updated('work_area', areaId, areaAuditLabel(area), area, after, refs));
  return c.json({ ok: true });
});

// ---------- Quotes ----------

const quoteLabel = (q: Row, names: Record<string, string>) =>
  [names[String(q.supplierId)], names[String(q.workAreaId)]].filter(Boolean).join(' · ');

app.post('/quotes', async (c) => {
  const { select, ...data } = await body(c, quoteCreateSchema);
  await requireExists(c, 'work_areas', data.workAreaId, 'תחום העבודה לא נמצא');
  await requireExists(c, 'suppliers', data.supplierId, 'הספק לא נמצא');
  const area = (await existing(c, 'work_areas', data.workAreaId)) as Row & WorkArea;
  if (select && data.status === 'rejected') conflict('אי אפשר לבחור הצעה שנדחתה');
  const user = c.get('user');
  const names = await lookupNames(c.env.DB, { areas: [data.workAreaId], suppliers: [data.supplierId] });
  const { id, stmt } = insertStatement(c.env.DB, 'quotes', data, user);
  const statements = [stmt];
  const records: AuditRecord[] = [{ action: 'create', entity: 'quote', entityId: id, label: quoteLabel(data, names), changes: snapshot(data), refs: names }];
  if (select) {
    // "בחירת ספק": the new quote becomes the area's selection, as POST /areas/:id/selection would do.
    const status = area.status === 'not_started' || area.status === 'collecting_quotes' ? 'supplier_selected' : area.status;
    const after = { selectedQuoteId: id, status };
    const refs = { ...(await lookupNames(c.env.DB, { quotes: [area.selectedQuoteId] })), [id]: quoteLabel(data, names) };
    statements.push(updateStatement(c.env.DB, 'work_areas', data.workAreaId, after, user));
    records.push(...updated('work_area', data.workAreaId, areaAuditLabel(area), area, after, refs));
  } else if (area.status === 'not_started') {
    // A work area that receives its first quote moves on to collecting quotes.
    const after = { status: 'collecting_quotes' };
    statements.push(updateStatement(c.env.DB, 'work_areas', data.workAreaId, after, user));
    records.push(...updated('work_area', data.workAreaId, areaAuditLabel(area), area, after));
  }
  await commit(c, statements, records);
  return c.json({ id }, 201);
});

app.put('/quotes/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, quoteUpdateSchema);
  await requireExists(c, 'suppliers', data.supplierId, 'הספק לא נמצא');
  const before = await existing(c, 'quotes', id);
  const names = await lookupNames(c.env.DB, { areas: [String(before.workAreaId)], suppliers: [String(before.supplierId), data.supplierId] });
  const statements = [updateStatement(c.env.DB, 'quotes', id, data, c.get('user'))];
  const records = updated('quote', id, quoteLabel({ ...before, ...data }, names), before, data, names);
  if (data.status === 'rejected') await clearSelection(c, id, statements, records);
  await commit(c, statements, records);
  return c.json({ ok: true });
});

app.delete('/quotes/:id', async (c) => {
  const id = c.req.param('id');
  const before = await existing(c, 'quotes', id);
  const keys = await fileKeys(c, 'q.id = ?', id);
  const names = await lookupNames(c.env.DB, { areas: [String(before.workAreaId)], suppliers: [String(before.supplierId)] });
  const statements: D1PreparedStatement[] = [];
  const records: AuditRecord[] = [];
  await clearSelection(c, id, statements, records);
  statements.push(deleteStatement(c.env.DB, 'quotes', id));
  records.push({
    action: 'delete',
    entity: 'quote',
    entityId: id,
    label: quoteLabel(before, names),
    changes: { ...snapshot(before), cascade: keys.length ? `נמחקו איתה ${keys.length} קבצים` : '' },
    refs: names,
  });
  // File rows are removed by ON DELETE CASCADE; the objects are removed from R2 below.
  await commit(c, statements, records);
  await deleteObjects(c, keys);
  return c.json({ ok: true });
});

/** Adds the statements that clear any selection of this quote (and the matching history). */
async function clearSelection(c: Ctx, quoteId: string, statements: D1PreparedStatement[], records: AuditRecord[]) {
  const areas = await all<Row & WorkArea>(c.env.DB, 'SELECT * FROM work_areas WHERE selected_quote_id = ?', quoteId);
  if (!areas.length) return;
  const refs = await lookupNames(c.env.DB, { quotes: [quoteId] });
  for (const area of areas) {
    const after = { selectedQuoteId: null, status: area.status === 'supplier_selected' ? 'collecting_quotes' : area.status };
    statements.push(updateStatement(c.env.DB, 'work_areas', area.id, after, c.get('user')));
    records.push(...updated('work_area', area.id, areaAuditLabel(area), area, after, refs));
  }
}

// ---------- Quote files (private R2 bucket, served only through this Worker) ----------

const MAX_UPLOAD_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;

app.post('/quotes/:id/files', async (c) => {
  const quoteId = c.req.param('id');
  if (Number(c.req.header('content-length') ?? 0) > MAX_UPLOAD_REQUEST_BYTES) tooLarge();
  await requireExists(c, 'quotes', quoteId, 'הצעת המחיר לא נמצאה');

  const form = await c.req.raw.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new HTTPException(400, { message: 'לא נשלח קובץ' });
  if (file.size === 0) throw new HTTPException(400, { message: 'הקובץ ריק' });
  if (file.size > MAX_FILE_BYTES) tooLarge();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type) {
    throw new HTTPException(415, { message: 'סוג הקובץ לא נתמך. אפשר להעלות PDF או תמונה (JPEG, PNG, WebP, HEIC).' });
  }

  const id = crypto.randomUUID();
  const key = `quotes/${quoteId}/${id}`;
  const fileName = sanitizeFileName(file.name, type);
  const user = c.get('user');
  const names = await lookupNames(c.env.DB, { quotes: [quoteId] });
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: type.contentType },
    customMetadata: { quoteId, uploadedBy: user },
  });
  try {
    const insertFile = c.env.DB.prepare(
      `INSERT INTO quote_files (id, quote_id, r2_key, file_name, content_type, size, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, quoteId, key, fileName, type.contentType, bytes.byteLength, new Date().toISOString(), user);
    // Only the file's name, type and size go into the history, never its contents.
    await commit(c, [insertFile], [
      {
        action: 'create',
        entity: 'quote_file',
        entityId: id,
        label: [fileName, names[quoteId]].filter(Boolean).join(' · '),
        changes: { fileName, contentType: type.contentType, size: bytes.byteLength, quoteId },
        refs: names,
      },
    ]);
  } catch (e) {
    await c.env.FILES.delete(key);
    throw e;
  }
  return c.json({ id }, 201);
});

/** Streams a file to a signed-in user. `?download=1` saves it instead of opening it. */
app.get('/files/:id', async (c) => {
  const row = await first<{ r2Key: string; fileName: string; contentType: string }>(
    c.env.DB,
    'SELECT r2_key, file_name, content_type FROM quote_files WHERE id = ?',
    c.req.param('id'),
  );
  if (!row) notFound();
  const object = await c.env.FILES.get(row.r2Key);
  if (!object) throw new HTTPException(404, { message: 'הקובץ לא נמצא באחסון' });
  return new Response(object.body, {
    headers: {
      'Content-Type': row.contentType,
      'Content-Length': String(object.size),
      'Content-Disposition': contentDisposition(c.req.query('download') ? 'attachment' : 'inline', row.fileName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

app.delete('/files/:id', async (c) => {
  const id = c.req.param('id');
  const row = await first<{ r2Key: string; fileName: string; contentType: string; size: number; quoteId: string }>(
    c.env.DB,
    'SELECT r2_key, file_name, content_type, size, quote_id FROM quote_files WHERE id = ?',
    id,
  );
  if (!row) notFound();
  const names = await lookupNames(c.env.DB, { quotes: [row.quoteId] });
  await commit(c, [deleteStatement(c.env.DB, 'quote_files', id)], [
    {
      action: 'delete',
      entity: 'quote_file',
      entityId: id,
      label: [row.fileName, names[row.quoteId]].filter(Boolean).join(' · '),
      changes: { fileName: row.fileName, contentType: row.contentType, size: row.size, quoteId: row.quoteId },
      refs: names,
    },
  ]);
  await deleteObjects(c, [row.r2Key]);
  return c.json({ ok: true });
});

function tooLarge(): never {
  throw new HTTPException(413, { message: `הקובץ גדול מדי. הגודל המרבי הוא ${MAX_FILE_BYTES / (1024 * 1024)} MB.` });
}

/** R2 keys of the files of the quotes matching `where` (on quotes aliased as q). */
async function fileKeys(c: Ctx, where: string, param: string): Promise<string[]> {
  const rows = await all<{ r2Key: string }>(
    c.env.DB,
    `SELECT f.r2_key FROM quote_files f JOIN quotes q ON q.id = f.quote_id WHERE ${where}`,
    param,
  );
  return rows.map((r) => r.r2Key);
}

/**
 * Removes objects after their rows are gone. D1 is the source of truth: if this fails,
 * the objects are unreachable (no row points to them) and only take up space.
 */
async function deleteObjects(c: Ctx, keys: string[]) {
  if (!keys.length) return;
  try {
    await c.env.FILES.delete(keys);
  } catch (e) {
    console.error('R2 delete failed', keys.length, e);
  }
}

// ---------- Change orders ----------

const changeOrderLabel = (co: Row, names: Record<string, string>) =>
  [co.description, names[String(co.workAreaId)]].filter(Boolean).join(' · ');

app.post('/change-orders', async (c) => {
  const data = await body(c, changeOrderSchema);
  await requireExists(c, 'work_areas', data.workAreaId, 'תחום העבודה לא נמצא');
  const names = await lookupNames(c.env.DB, { areas: [data.workAreaId] });
  const { id, stmt } = insertStatement(c.env.DB, 'change_orders', data, c.get('user'));
  await commit(c, [stmt], [
    { action: 'create', entity: 'change_order', entityId: id, label: changeOrderLabel(data, names), changes: snapshot(data), refs: names },
  ]);
  return c.json({ id }, 201);
});

app.put('/change-orders/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, changeOrderUpdateSchema);
  const before = await existing(c, 'change_orders', id);
  const names = await lookupNames(c.env.DB, { areas: [String(before.workAreaId)] });
  await commit(
    c,
    [updateStatement(c.env.DB, 'change_orders', id, data, c.get('user'))],
    updated('change_order', id, changeOrderLabel({ ...before, ...data }, names), before, data, names),
  );
  return c.json({ ok: true });
});

app.delete('/change-orders/:id', async (c) => {
  const id = c.req.param('id');
  const before = await existing(c, 'change_orders', id);
  const names = await lookupNames(c.env.DB, { areas: [String(before.workAreaId)] });
  await commit(c, [deleteStatement(c.env.DB, 'change_orders', id)], [
    { action: 'delete', entity: 'change_order', entityId: id, label: changeOrderLabel(before, names), changes: snapshot(before), refs: names },
  ]);
  return c.json({ ok: true });
});

// ---------- General expenses ----------

app.post('/expenses', async (c) => {
  const data = await body(c, expenseSchema);
  const { id, stmt } = insertStatement(c.env.DB, 'expenses', data, c.get('user'));
  await commit(c, [stmt], [{ action: 'create', entity: 'expense', entityId: id, label: data.description, changes: snapshot(data) }]);
  return c.json({ id }, 201);
});

app.put('/expenses/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, expenseSchema);
  const before = await existing(c, 'expenses', id);
  await commit(c, [updateStatement(c.env.DB, 'expenses', id, data, c.get('user'))], updated('expense', id, data.description, before, data));
  return c.json({ ok: true });
});

app.delete('/expenses/:id', async (c) => {
  const id = c.req.param('id');
  if (await count(c.env.DB, 'SELECT COUNT(*) AS n FROM payments WHERE expense_id = ?', id)) {
    conflict('להוצאה יש תשלומים. מחקו אותם קודם.');
  }
  const before = await existing(c, 'expenses', id);
  await commit(c, [deleteStatement(c.env.DB, 'expenses', id)], [
    { action: 'delete', entity: 'expense', entityId: id, label: String(before.description), changes: snapshot(before) },
  ]);
  return c.json({ ok: true });
});

// ---------- Payments ----------

async function checkPaymentTarget(c: Ctx, data: z.output<typeof paymentSchema>) {
  if (data.workAreaId) await requireExists(c, 'work_areas', data.workAreaId, 'תחום העבודה לא נמצא');
  if (data.expenseId) await requireExists(c, 'expenses', data.expenseId, 'ההוצאה לא נמצאה');
}

app.post('/payments', async (c) => {
  const data = await body(c, paymentSchema);
  await checkPaymentTarget(c, data);
  const names = await lookupNames(c.env.DB, { areas: [data.workAreaId], expenses: [data.expenseId] });
  const { id, stmt } = insertStatement(c.env.DB, 'payments', data, c.get('user'));
  await commit(c, [stmt], [
    { action: 'create', entity: 'payment', entityId: id, label: paymentLabel(data, names), changes: snapshot(data), refs: names },
  ]);
  return c.json({ id }, 201);
});

app.put('/payments/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, paymentSchema);
  await checkPaymentTarget(c, data);
  const before = await existing(c, 'payments', id);
  const names = await lookupNames(c.env.DB, {
    areas: [String(before.workAreaId ?? ''), data.workAreaId],
    expenses: [String(before.expenseId ?? ''), data.expenseId],
  });
  await commit(
    c,
    [updateStatement(c.env.DB, 'payments', id, data, c.get('user'))],
    updated('payment', id, paymentLabel(data, names), before, data, names),
  );
  return c.json({ ok: true });
});

app.delete('/payments/:id', async (c) => {
  const id = c.req.param('id');
  const before = await existing(c, 'payments', id);
  const names = await lookupNames(c.env.DB, { areas: [String(before.workAreaId ?? '')], expenses: [String(before.expenseId ?? '')] });
  await commit(c, [deleteStatement(c.env.DB, 'payments', id)], [
    { action: 'delete', entity: 'payment', entityId: id, label: paymentLabel(before, names), changes: snapshot(before), refs: names },
  ]);
  return c.json({ ok: true });
});

app.all('*', () => notFound());

export default app;
