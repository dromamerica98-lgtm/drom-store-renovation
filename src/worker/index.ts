import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import type {
  ChangeOrder,
  Dataset,
  Expense,
  Payment,
  Quote,
  Settings,
  Supplier,
  WorkArea,
} from '../shared/types';
import { all, count, first, insert, remove, update } from './db';
import {
  changeOrderSchema,
  changeOrderUpdateSchema,
  expenseSchema,
  paymentSchema,
  quoteSchema,
  quoteUpdateSchema,
  selectionSchema,
  settingsSchema,
  supplierSchema,
  workAreaSchema,
} from './schemas';

type AppEnv = { Bindings: Env; Variables: { user: string } };
type Ctx = Context<AppEnv>;

const app = new Hono<AppEnv>().basePath('/api');

/**
 * Identifies the user. Cloudflare Access puts the signed-in email in this header.
 * Stage 2 adds verification of the Access JWT; until then the app is only run locally.
 * In local development (vite dev) a fixed developer identity is used.
 */
app.use('*', async (c, next) => {
  const email = c.req.header('cf-access-authenticated-user-email') ?? (import.meta.env.DEV ? 'dev@localhost' : null);
  if (!email) throw new HTTPException(401, { message: 'נדרשת התחברות' });
  c.set('user', email);
  await next();
});

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

async function requireExists(c: Ctx, table: string, id: string, label: string) {
  if (!(await count(c.env.DB, `SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id))) {
    throw new HTTPException(400, { message: `${label} לא נמצא` });
  }
}

// ---------- Everything at once ----------

app.get('/data', async (c) => {
  const db = c.env.DB;
  const settingsRow = await first<Settings & { id?: number }>(db, 'SELECT * FROM settings WHERE id = 1');
  if (!settingsRow) throw new HTTPException(500, { message: 'הגדרות הפרויקט חסרות' });
  const { id: _id, ...settings } = settingsRow;
  const [suppliers, workAreas, quotes, changeOrders, expenses, payments] = await Promise.all([
    all<Supplier>(db, 'SELECT * FROM suppliers ORDER BY name'),
    all<WorkArea>(db, 'SELECT * FROM work_areas ORDER BY sort_order, name'),
    all<Quote>(db, 'SELECT * FROM quotes ORDER BY received_date DESC, created_at DESC'),
    all<ChangeOrder>(db, 'SELECT * FROM change_orders ORDER BY date, created_at'),
    all<Expense>(db, 'SELECT * FROM expenses ORDER BY created_at'),
    all<Payment>(db, 'SELECT * FROM payments ORDER BY date DESC, created_at DESC'),
  ]);
  const data: Dataset = {
    settings,
    suppliers,
    workAreas,
    quotes,
    changeOrders,
    expenses,
    payments,
    user: { email: c.get('user') },
  };
  return c.json(data);
});

// ---------- Settings ----------

app.put('/settings', async (c) => {
  const data = await body(c, settingsSchema);
  await update(c.env.DB, 'settings', 1, data, c.get('user'));
  return c.json({ ok: true });
});

// ---------- Suppliers ----------

app.post('/suppliers', async (c) => {
  const id = await insert(c.env.DB, 'suppliers', await body(c, supplierSchema), c.get('user'));
  return c.json({ id }, 201);
});

app.put('/suppliers/:id', async (c) => {
  const ok = await update(c.env.DB, 'suppliers', c.req.param('id'), await body(c, supplierSchema), c.get('user'));
  return ok ? c.json({ ok }) : notFound();
});

app.delete('/suppliers/:id', async (c) => {
  const id = c.req.param('id');
  if (await count(c.env.DB, 'SELECT COUNT(*) AS n FROM quotes WHERE supplier_id = ?', id)) {
    conflict('לספק יש הצעות מחיר. מחקו אותן קודם.');
  }
  return (await remove(c.env.DB, 'suppliers', id)) ? c.json({ ok: true }) : notFound();
});

// ---------- Work areas ----------

app.post('/areas', async (c) => {
  const data = await body(c, workAreaSchema);
  if (!data.sortOrder) {
    data.sortOrder = 1 + (await count(c.env.DB, 'SELECT COALESCE(MAX(sort_order), 0) AS n FROM work_areas'));
  }
  const id = await insert(c.env.DB, 'work_areas', data, c.get('user'));
  return c.json({ id }, 201);
});

app.put('/areas/:id', async (c) => {
  const ok = await update(c.env.DB, 'work_areas', c.req.param('id'), await body(c, workAreaSchema), c.get('user'));
  return ok ? c.json({ ok }) : notFound();
});

app.delete('/areas/:id', async (c) => {
  const id = c.req.param('id');
  if (await count(c.env.DB, 'SELECT COUNT(*) AS n FROM payments WHERE work_area_id = ?', id)) {
    conflict('לתחום יש תשלומים. מחקו או העבירו אותם קודם.');
  }
  // Quotes and change orders are removed by ON DELETE CASCADE.
  return (await remove(c.env.DB, 'work_areas', id)) ? c.json({ ok: true }) : notFound();
});

/** Selects a quote for a work area (or clears the selection with quoteId: null). */
app.post('/areas/:id/selection', async (c) => {
  const areaId = c.req.param('id');
  const { quoteId } = await body(c, selectionSchema);
  const area = await first<WorkArea>(c.env.DB, 'SELECT * FROM work_areas WHERE id = ?', areaId);
  if (!area) notFound();

  let status = area.status;
  if (quoteId) {
    const quote = await first<Quote>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', quoteId);
    if (!quote || quote.workAreaId !== areaId) throw new HTTPException(400, { message: 'ההצעה לא שייכת לתחום' });
    if (quote.status === 'rejected') conflict('אי אפשר לבחור הצעה שנדחתה');
    if (status === 'not_started' || status === 'collecting_quotes') status = 'supplier_selected';
  } else if (status === 'supplier_selected') {
    status = 'collecting_quotes';
  }
  await update(c.env.DB, 'work_areas', areaId, { selectedQuoteId: quoteId, status }, c.get('user'));
  return c.json({ ok: true });
});

// ---------- Quotes ----------

app.post('/quotes', async (c) => {
  const data = await body(c, quoteSchema);
  await requireExists(c, 'work_areas', data.workAreaId, 'תחום העבודה');
  await requireExists(c, 'suppliers', data.supplierId, 'הספק');
  const id = await insert(c.env.DB, 'quotes', data, c.get('user'));
  // A work area that receives its first quote moves on to collecting quotes.
  await c.env.DB.prepare(
    `UPDATE work_areas SET status = 'collecting_quotes' WHERE id = ? AND status = 'not_started'`,
  )
    .bind(data.workAreaId)
    .run();
  return c.json({ id }, 201);
});

app.put('/quotes/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, quoteUpdateSchema);
  await requireExists(c, 'suppliers', data.supplierId, 'הספק');
  if (!(await update(c.env.DB, 'quotes', id, data, c.get('user')))) notFound();
  if (data.status === 'rejected') await clearSelection(c, id);
  return c.json({ ok: true });
});

app.delete('/quotes/:id', async (c) => {
  const id = c.req.param('id');
  await clearSelection(c, id);
  return (await remove(c.env.DB, 'quotes', id)) ? c.json({ ok: true }) : notFound();
});

/** Clears the selection of any work area that selected this quote. */
async function clearSelection(c: Ctx, quoteId: string) {
  await c.env.DB.prepare(
    `UPDATE work_areas
       SET selected_quote_id = NULL,
           status = CASE WHEN status = 'supplier_selected' THEN 'collecting_quotes' ELSE status END,
           updated_at = ?, updated_by = ?
     WHERE selected_quote_id = ?`,
  )
    .bind(new Date().toISOString(), c.get('user'), quoteId)
    .run();
}

// ---------- Change orders ----------

app.post('/change-orders', async (c) => {
  const data = await body(c, changeOrderSchema);
  await requireExists(c, 'work_areas', data.workAreaId, 'תחום העבודה');
  const id = await insert(c.env.DB, 'change_orders', data, c.get('user'));
  return c.json({ id }, 201);
});

app.put('/change-orders/:id', async (c) => {
  const ok = await update(
    c.env.DB,
    'change_orders',
    c.req.param('id'),
    await body(c, changeOrderUpdateSchema),
    c.get('user'),
  );
  return ok ? c.json({ ok }) : notFound();
});

app.delete('/change-orders/:id', async (c) =>
  (await remove(c.env.DB, 'change_orders', c.req.param('id'))) ? c.json({ ok: true }) : notFound(),
);

// ---------- General expenses ----------

app.post('/expenses', async (c) => {
  const id = await insert(c.env.DB, 'expenses', await body(c, expenseSchema), c.get('user'));
  return c.json({ id }, 201);
});

app.put('/expenses/:id', async (c) => {
  const ok = await update(c.env.DB, 'expenses', c.req.param('id'), await body(c, expenseSchema), c.get('user'));
  return ok ? c.json({ ok }) : notFound();
});

app.delete('/expenses/:id', async (c) => {
  const id = c.req.param('id');
  if (await count(c.env.DB, 'SELECT COUNT(*) AS n FROM payments WHERE expense_id = ?', id)) {
    conflict('להוצאה יש תשלומים. מחקו אותם קודם.');
  }
  return (await remove(c.env.DB, 'expenses', id)) ? c.json({ ok: true }) : notFound();
});

// ---------- Payments ----------

async function checkPaymentTarget(c: Ctx, data: z.output<typeof paymentSchema>) {
  if (data.workAreaId) await requireExists(c, 'work_areas', data.workAreaId, 'תחום העבודה');
  if (data.expenseId) await requireExists(c, 'expenses', data.expenseId, 'ההוצאה');
}

app.post('/payments', async (c) => {
  const data = await body(c, paymentSchema);
  await checkPaymentTarget(c, data);
  const id = await insert(c.env.DB, 'payments', data, c.get('user'));
  return c.json({ id }, 201);
});

app.put('/payments/:id', async (c) => {
  const data = await body(c, paymentSchema);
  await checkPaymentTarget(c, data);
  const ok = await update(c.env.DB, 'payments', c.req.param('id'), data, c.get('user'));
  return ok ? c.json({ ok }) : notFound();
});

app.delete('/payments/:id', async (c) =>
  (await remove(c.env.DB, 'payments', c.req.param('id'))) ? c.json({ ok: true }) : notFound(),
);

app.all('*', () => notFound());

export default app;
