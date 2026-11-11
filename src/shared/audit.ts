import { formatDate } from './calc';
import {
  AREA_STATUS_LABELS,
  CHANGE_ORDER_STATUS_LABELS,
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  VAT_BASIS_LABELS,
  VAT_MODE_LABELS,
  ZONE_LABELS,
} from './labels';
import { formatFileSize } from './files';
import { formatILS } from './money';

/** The change history (audit log) and how its entries read in Hebrew. */

export type AuditAction = 'create' | 'update' | 'delete';
export type AuditEntity =
  | 'settings'
  | 'supplier'
  | 'work_area'
  | 'quote'
  | 'quote_file'
  | 'change_order'
  | 'expense'
  | 'payment';

export interface AuditEntry {
  id: number;
  /** ISO timestamp. */
  at: string;
  /** Email of the signed-in user, as verified by Cloudflare Access. */
  actor: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  /** What the item was called at the time, e.g. the area's name. */
  label: string;
  /** create/delete: the item's fields. update: {field: [before, after]}. */
  changes: Record<string, unknown>;
  /** Names of items referred to by id (areas, suppliers, expenses) at the time. */
  refs: Record<string, string>;
}

export interface AuditPage {
  entries: AuditEntry[];
  hasMore: boolean;
  /** Everyone who appears in the log, for the filter. */
  actors: string[];
}

interface EntityText {
  name: string;
  created: string;
  updated: string;
  deleted: string;
}

export const ENTITY_TEXT: Record<AuditEntity, EntityText> = {
  settings: { name: 'הגדרות', created: 'נוצרו הגדרות', updated: 'עודכנו הגדרות הפרויקט', deleted: 'נמחקו הגדרות' },
  supplier: { name: 'ספק', created: 'נוסף ספק', updated: 'עודכן ספק', deleted: 'נמחק ספק' },
  work_area: { name: 'תחום', created: 'נוסף תחום', updated: 'עודכן תחום', deleted: 'נמחק תחום' },
  quote: { name: 'הצעת מחיר', created: 'נוספה הצעת מחיר', updated: 'עודכנה הצעת מחיר', deleted: 'נמחקה הצעת מחיר' },
  quote_file: { name: 'קובץ', created: 'צורף קובץ', updated: 'עודכן קובץ', deleted: 'נמחק קובץ' },
  change_order: { name: 'תוספת לחוזה', created: 'נוספה תוספת לחוזה', updated: 'עודכנה תוספת לחוזה', deleted: 'נמחקה תוספת לחוזה' },
  expense: { name: 'הוצאה', created: 'נוספה הוצאה', updated: 'עודכנה הוצאה', deleted: 'נמחקה הוצאה' },
  payment: { name: 'תשלום', created: 'נוסף תשלום', updated: 'עודכן תשלום', deleted: 'נמחק תשלום' },
};

type Kind =
  | 'text'
  | 'money'
  | 'pct'
  | 'number'
  | 'date'
  | 'bytes'
  | 'vat'
  | 'basis'
  | 'ref'
  | { labels: Record<string, string> };

interface FieldSpec {
  label: string;
  kind: Kind;
}

const F = (label: string, kind: Kind = 'text'): FieldSpec => ({ label, kind });

/** The fields shown for each kind of item, in display order. Fields not listed are not shown. */
const FIELDS: Record<AuditEntity, Record<string, FieldSpec>> = {
  settings: {
    projectName: F('שם הפרויקט'),
    totalBudget: F('תקציב כולל', 'money'),
    budgetVat: F('מע"מ התקציב', 'basis'),
    reserveAmount: F('רזרבה', 'money'),
    vatRate: F('שיעור מע"מ', 'pct'),
    displayBasis: F('הצגת סכומים', 'basis'),
  },
  supplier: {
    name: F('שם'),
    contactName: F('איש קשר'),
    phone: F('טלפון'),
    email: F('מייל'),
    taxId: F('ח.פ.'),
    notes: F('הערות'),
  },
  work_area: {
    name: F('שם'),
    zone: F('אזור', { labels: ZONE_LABELS }),
    status: F('סטטוס', { labels: AREA_STATUS_LABELS }),
    progress: F('התקדמות', 'pct'),
    selectedQuoteId: F('הצעה נבחרת', 'ref'),
    estimateAmount: F('הערכת עלות', 'money'),
    estimateVat: F('מע"מ ההערכה', 'vat'),
    notes: F('הערות'),
  },
  quote: {
    workAreaId: F('תחום', 'ref'),
    supplierId: F('ספק', 'ref'),
    amount: F('סכום', 'money'),
    vatMode: F('מע"מ', 'vat'),
    status: F('סטטוס', { labels: QUOTE_STATUS_LABELS }),
    receivedDate: F('תאריך קבלה', 'date'),
    validUntil: F('בתוקף עד', 'date'),
    description: F('תיאור'),
  },
  quote_file: {
    fileName: F('שם הקובץ'),
    contentType: F('סוג'),
    size: F('גודל', 'bytes'),
  },
  change_order: {
    workAreaId: F('תחום', 'ref'),
    description: F('תיאור'),
    amount: F('סכום', 'money'),
    vatMode: F('מע"מ', 'vat'),
    date: F('תאריך', 'date'),
    status: F('סטטוס', { labels: CHANGE_ORDER_STATUS_LABELS }),
  },
  expense: {
    category: F('קטגוריה', { labels: EXPENSE_CATEGORY_LABELS }),
    description: F('תיאור'),
    payee: F('למי משלמים'),
    estimateAmount: F('הערכה', 'money'),
    estimateVat: F('מע"מ ההערכה', 'vat'),
    actualAmount: F('סכום בפועל', 'money'),
    actualVat: F('מע"מ הסכום בפועל', 'vat'),
    notes: F('הערות'),
  },
  payment: {
    workAreaId: F('תחום', 'ref'),
    expenseId: F('הוצאה', 'ref'),
    amount: F('סכום', 'money'),
    vatMode: F('מע"מ', 'vat'),
    status: F('סטטוס', { labels: PAYMENT_STATUS_LABELS }),
    date: F('תאריך', 'date'),
    method: F('אמצעי תשלום', { labels: PAYMENT_METHOD_LABELS }),
    reference: F('אסמכתא'),
    notes: F('הערות'),
  },
};

/** Fields shown when an item is added or deleted (a short summary, not every field). */
const SUMMARY_FIELDS: Record<AuditEntity, string[]> = {
  settings: ['projectName', 'totalBudget', 'reserveAmount'],
  supplier: ['phone'],
  work_area: ['zone', 'status', 'estimateAmount'],
  quote: ['amount', 'vatMode', 'validUntil'],
  quote_file: ['size'],
  change_order: ['amount', 'status'],
  expense: ['category', 'actualAmount', 'estimateAmount'],
  payment: ['amount', 'status', 'date'],
};

const EMPTY = 'ריק';

function formatValue(value: unknown, kind: Kind, refs: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof kind === 'object') return kind.labels[String(value)] ?? String(value);
  switch (kind) {
    case 'money':
      return typeof value === 'number' ? formatILS(value) : String(value);
    case 'pct':
      return `${value}%`;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(String(value)) : String(value);
    case 'bytes':
      return typeof value === 'number' ? formatFileSize(value) : String(value);
    case 'vat':
      return VAT_MODE_LABELS[value as keyof typeof VAT_MODE_LABELS] ?? String(value);
    case 'basis':
      return VAT_BASIS_LABELS[value as keyof typeof VAT_BASIS_LABELS] ?? String(value);
    case 'ref':
      return refs[String(value)] ?? 'פריט שנמחק';
    default: {
      const text = String(value).replace(/\s+/g, ' ').trim();
      return text.length > 60 ? `${text.slice(0, 57)}…` : text;
    }
  }
}

export interface DescribedEntry {
  /** e.g. "עודכן תחום" */
  title: string;
  /** e.g. "חשמל ותאורה" */
  label: string;
  /** e.g. ["התקדמות: מ־60% ל־80%"] */
  details: string[];
}

export function describeEntry(entry: AuditEntry): DescribedEntry {
  const text = ENTITY_TEXT[entry.entity];
  const fields = FIELDS[entry.entity];
  const title = entry.action === 'create' ? text.created : entry.action === 'update' ? text.updated : text.deleted;
  const details: string[] = [];

  if (entry.action === 'update') {
    for (const [field, spec] of Object.entries(fields)) {
      const pair = entry.changes[field];
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      details.push(
        `${spec.label}: מ־${formatValue(pair[0], spec.kind, entry.refs)} ל־${formatValue(pair[1], spec.kind, entry.refs)}`,
      );
    }
  } else {
    for (const field of SUMMARY_FIELDS[entry.entity]) {
      const spec = fields[field];
      const value = entry.changes[field];
      if (!spec || value === null || value === undefined || value === '') continue;
      details.push(`${spec.label}: ${formatValue(value, spec.kind, entry.refs)}`);
    }
    const cascade = entry.changes.cascade;
    if (typeof cascade === 'string' && cascade) details.push(cascade);
  }
  return { title, label: entry.label, details };
}

/** One line for the daily email: "14:05 · ofer.wiesel@gmail.com · עודכן תחום "חשמל": התקדמות: מ־60% ל־80%". */
export function digestLine(entry: AuditEntry, timeZone = 'Asia/Jerusalem'): string {
  const d = describeEntry(entry);
  const time = new Date(entry.at).toLocaleTimeString('he-IL', { timeZone, hour: '2-digit', minute: '2-digit' });
  const details = d.details.length ? `: ${d.details.join('; ')}` : '';
  return `${time} · ${entry.actor} · ${d.title} "${d.label}"${details}`;
}
