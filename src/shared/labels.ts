import type {
  AreaStatus,
  ChangeOrderStatus,
  ExpenseCategory,
  PaymentMethod,
  PaymentStatus,
  QuoteStatus,
  VatBasis,
  VatMode,
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
