/** All money amounts are stored and passed around as integer agorot (1 ₪ = 100). */

/** How an amount was entered. */
export type VatMode = 'incl' | 'excl' | 'exempt';
/** How the budget and the reports are shown. */
export type VatBasis = 'incl' | 'excl';

export type AreaStatus =
  | 'not_started'
  | 'collecting_quotes'
  | 'supplier_selected'
  | 'in_progress'
  | 'done';
export type QuoteStatus = 'open' | 'rejected';
export type ChangeOrderStatus = 'pending' | 'approved';
export type PaymentStatus = 'paid' | 'planned';
export type ExpenseCategory = 'fee' | 'insurance' | 'permit' | 'consultant' | 'other';
export type PaymentMethod = 'transfer' | 'check' | 'credit' | 'cash' | 'other';

export interface Audit {
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Settings {
  projectName: string;
  totalBudget: number;
  budgetVat: VatBasis;
  reserveAmount: number;
  /** Percent, e.g. 18. */
  vatRate: number;
  displayBasis: VatBasis;
  updatedAt: string;
  updatedBy: string;
}

export interface Supplier extends Audit {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  notes: string | null;
}

export interface WorkArea extends Audit {
  id: string;
  name: string;
  status: AreaStatus;
  /** 0–100, entered manually. */
  progress: number;
  estimateAmount: number | null;
  estimateVat: VatMode;
  selectedQuoteId: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface Quote extends Audit {
  id: string;
  workAreaId: string;
  supplierId: string;
  amount: number;
  vatMode: VatMode;
  receivedDate: string | null;
  validUntil: string | null;
  description: string | null;
  status: QuoteStatus;
}

/** A PDF or image attached to a quote. The file itself is in R2 and is served by /api/files/:id. */
export interface QuoteFile {
  id: string;
  quoteId: string;
  fileName: string;
  contentType: string;
  /** Bytes. */
  size: number;
  createdAt: string;
  createdBy: string;
}

export interface ChangeOrder extends Audit {
  id: string;
  workAreaId: string;
  description: string;
  /** May be negative (credit). */
  amount: number;
  vatMode: VatMode;
  date: string | null;
  status: ChangeOrderStatus;
}

export interface Expense extends Audit {
  id: string;
  category: ExpenseCategory;
  description: string;
  payee: string | null;
  estimateAmount: number | null;
  estimateVat: VatMode;
  actualAmount: number | null;
  actualVat: VatMode;
  notes: string | null;
}

export interface Payment extends Audit {
  id: string;
  workAreaId: string | null;
  expenseId: string | null;
  amount: number;
  vatMode: VatMode;
  date: string;
  status: PaymentStatus;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
}

export interface Dataset {
  settings: Settings;
  suppliers: Supplier[];
  workAreas: WorkArea[];
  quotes: Quote[];
  quoteFiles: QuoteFile[];
  changeOrders: ChangeOrder[];
  expenses: Expense[];
  payments: Payment[];
  user: { email: string };
}
