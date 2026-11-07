import { z } from 'zod';

// Validation messages in Hebrew.
z.config(z.locales.he());

const vatMode = z.enum(['incl', 'excl', 'exempt']);
const vatBasis = z.enum(['incl', 'excl']);
/** Integer agorot. */
const amount = z.number().int().min(-1e13).max(1e13);
const positiveAmount = amount.min(0);
const isoDate = z.iso.date();
const optDate = isoDate.nullish().transform((v) => v ?? null);
const text = z.string().trim().min(1).max(200);
const optText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null));
const id = z.string().min(1).max(64);

export const settingsSchema = z.object({
  projectName: text,
  totalBudget: positiveAmount,
  budgetVat: vatBasis,
  reserveAmount: positiveAmount,
  vatRate: z.number().min(0).max(100),
  displayBasis: vatBasis,
});

export const supplierSchema = z.object({
  name: text,
  contactName: optText,
  phone: optText,
  email: optText,
  taxId: optText,
  notes: optText,
});

export const workAreaSchema = z.object({
  name: text,
  status: z.enum(['not_started', 'collecting_quotes', 'supplier_selected', 'in_progress', 'done']),
  progress: z.number().int().min(0).max(100),
  estimateAmount: positiveAmount.nullable(),
  estimateVat: vatMode,
  notes: optText,
  sortOrder: z.number().int().default(0),
});

export const selectionSchema = z.object({ quoteId: id.nullable() });

export const quoteSchema = z.object({
  workAreaId: id,
  supplierId: id,
  amount: positiveAmount,
  vatMode,
  receivedDate: optDate,
  validUntil: optDate,
  description: optText,
  status: z.enum(['open', 'rejected']),
});
/** A quote cannot move to another work area. */
export const quoteUpdateSchema = quoteSchema.omit({ workAreaId: true });

export const changeOrderSchema = z.object({
  workAreaId: id,
  description: text,
  amount,
  vatMode,
  date: optDate,
  status: z.enum(['pending', 'approved']),
});
export const changeOrderUpdateSchema = changeOrderSchema.omit({ workAreaId: true });

export const expenseSchema = z.object({
  category: z.enum(['fee', 'insurance', 'permit', 'consultant', 'other']),
  description: text,
  payee: optText,
  estimateAmount: positiveAmount.nullable(),
  estimateVat: vatMode,
  actualAmount: positiveAmount.nullable(),
  actualVat: vatMode,
  notes: optText,
});

export const paymentSchema = z
  .object({
    workAreaId: id.nullable(),
    expenseId: id.nullable(),
    amount: positiveAmount,
    vatMode,
    date: isoDate,
    status: z.enum(['paid', 'planned']),
    method: z.enum(['transfer', 'check', 'credit', 'cash', 'other']).nullable(),
    reference: optText,
    notes: optText,
  })
  .refine((p) => (p.workAreaId === null) !== (p.expenseId === null), {
    message: 'תשלום חייב להיות משויך לתחום עבודה או להוצאה כללית אחת',
  });
