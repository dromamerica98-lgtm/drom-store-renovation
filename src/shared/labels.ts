import type {
  AreaStatus,
  ChangeOrderStatus,
  ExpenseCategory,
  PaymentMethod,
  PaymentStatus,
  QuoteStatus,
  VatBasis,
  VatMode,
  Zone,
} from './types';

export const VAT_MODE_LABELS: Record<VatMode, string> = {
  incl: 'כולל מע"מ',
  excl: 'לפני מע"מ',
  exempt: 'פטור ממע"מ',
};

export const VAT_BASIS_LABELS: Record<VatBasis, string> = {
  excl: 'לפני מע"מ',
  incl: 'כולל מע"מ',
};

export const AREA_STATUS_LABELS: Record<AreaStatus, string> = {
  not_started: 'טרם התחיל',
  collecting_quotes: 'איסוף הצעות',
  supplier_selected: 'ספק נבחר',
  in_progress: 'בביצוע',
  done: 'הושלם',
};

export const AREA_STATUS_ORDER: AreaStatus[] = [
  'not_started',
  'collecting_quotes',
  'supplier_selected',
  'in_progress',
  'done',
];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  open: 'פתוחה',
  rejected: 'נדחתה',
};

export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  pending: 'ממתינה לאישור',
  approved: 'אושרה',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  paid: 'שולם',
  planned: 'מתוכנן',
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fee: 'אגרה',
  insurance: 'ביטוח',
  permit: 'היתר',
  consultant: 'יועצים ותכנון',
  other: 'אחר',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: 'העברה בנקאית',
  check: "צ'ק",
  credit: 'כרטיס אשראי',
  cash: 'מזומן',
  other: 'אחר',
};

export const AREA_FORECAST_SOURCE_LABELS = {
  selected: 'הצעה נבחרת',
  estimate: 'הערכה',
  lowest_quote: 'ההצעה הזולה',
  missing: 'חסרה הערכה',
} as const;

export const EXPENSE_FORECAST_SOURCE_LABELS = {
  actual: 'סכום בפועל',
  estimate: 'הערכה',
  missing: 'חסר סכום',
} as const;

export const ZONE_LABELS: Record<Zone, string> = {
  store: 'חנות',
  office_warehouse: 'משרד מחסן',
  exterior: 'סגירת חוץ',
};

export const ZONE_ORDER: Zone[] = ['store', 'office_warehouse', 'exterior'];

export const DEFAULT_ZONE: Zone = 'store';

export function isZone(value: unknown): value is Zone {
  return value === 'store' || value === 'office_warehouse' || value === 'exterior';
}

/** Names of work areas as compared for uniqueness: trimmed, single spaces, case-insensitive. */
export function normalizeAreaName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * How each work area is called on screen. When the same name exists in more than one zone,
 * the zone is added ("חשמל · משרד מחסן") so the areas can be told apart.
 */
export function areaDisplayNames(areas: { id: string; name: string; zone: Zone }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const a of areas) counts.set(normalizeAreaName(a.name), (counts.get(normalizeAreaName(a.name)) ?? 0) + 1);
  return new Map(
    areas.map((a) => [a.id, (counts.get(normalizeAreaName(a.name)) ?? 0) > 1 ? `${a.name} · ${ZONE_LABELS[a.zone]}` : a.name]),
  );
}

/** The message shown when a work area with the same name already exists in the zone. */
export function duplicateAreaMessage(name: string, zone: Zone): string {
  return `התחום "${name.trim()}" כבר קיים באזור "${ZONE_LABELS[zone]}". אפשר לבחור אזור אחר, או לפתוח את התחום הקיים ולערוך אותו.`;
}

/** "תחום אחד" / "3 תחומים": Hebrew puts "one" after the noun. For masculine nouns. */
export function countOf(n: number, singular: string, plural: string): string {
  return n === 1 ? `${singular} אחד` : `${n} ${plural}`;
}
