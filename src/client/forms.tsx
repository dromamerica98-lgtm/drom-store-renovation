import { useRef, useState } from 'react';
import {
  AREA_STATUS_LABELS,
  CHANGE_ORDER_STATUS_LABELS,
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from '../shared/labels';
import { agorotToInput, parseShekels } from '../shared/money';
import type {
  AreaStatus,
  ChangeOrder,
  ChangeOrderStatus,
  Expense,
  ExpenseCategory,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Quote,
  QuoteStatus,
  Supplier,
  VatMode,
  WorkArea,
} from '../shared/types';
import { QUOTE_FILE_ACCEPT, formatFileSize } from '../shared/files';
import { api } from './api';
import { checkFileSize } from './components/QuoteFiles';
import { Field, MoneyField, Select, Sheet, TextArea, TextInput, setter } from './components/ui';
import { todayISO, useData } from './data';

class FormError extends Error {}

/** Parses an amount field; throws a FormError with a Hebrew message when invalid. */
function amountOf(label: string, input: string, opts: { required?: boolean; allowNegative?: boolean } = {}) {
  if (input.trim() === '') {
    if (opts.required) throw new FormError(`יש למלא ${label}`);
    return null;
  }
  const value = parseShekels(input);
  if (value === null || (!opts.allowNegative && value < 0)) throw new FormError(`${label}: סכום לא תקין`);
  return value;
}

function requireText(label: string, value: string) {
  if (!value.trim()) throw new FormError(`יש למלא ${label}`);
  return value.trim();
}

/** Shared submit flow: validate, send, close on success. */
function useSubmit(onClose: () => void) {
  const { reload } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Validation and server errors both show inside the form, which stays open. */
  function validated<T>(validate: () => T, send: (body: T) => Promise<unknown>) {
    let body: T;
    try {
      body = validate();
    } catch (e) {
      if (e instanceof FormError) {
        setError(e.message);
        return;
      }
      throw e;
    }
    setError(null);
    setBusy(true);
    send(body)
      .then(async () => {
        await reload();
        onClose();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'שגיאה לא צפויה');
        setBusy(false);
      });
  }
  /** Asks for confirmation, deletes and closes. */
  function remove(question: string, action: () => Promise<unknown>) {
    if (!confirm(question)) return;
    setError(null);
    setBusy(true);
    action()
      .then(async () => {
        await reload();
        onClose();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'שגיאה לא צפויה');
        setBusy(false);
      });
  }
  return { busy, error, validated, remove };
}

// ---------- Work area ----------

export function AreaForm({ area, onClose }: { area?: WorkArea; onClose: () => void }) {
  const [f, setF] = useState({
    name: area?.name ?? '',
    status: area?.status ?? ('not_started' as AreaStatus),
    progress: String(area?.progress ?? 0),
    estimate: agorotToInput(area?.estimateAmount),
    estimateVat: area?.estimateVat ?? ('excl' as VatMode),
    notes: area?.notes ?? '',
  });
  const set = setter(setF);
  const { busy, error, validated } = useSubmit(onClose);

  const onSubmit = () =>
    validated(
      () => {
        const progress = Number(f.progress);
        if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
          throw new FormError('אחוז התקדמות חייב להיות מספר שלם בין 0 ל־100');
        }
        return {
          name: requireText('שם התחום', f.name),
          status: f.status,
          progress,
          estimateAmount: amountOf('הערכת עלות', f.estimate),
          estimateVat: f.estimateVat,
          notes: f.notes,
          sortOrder: area?.sortOrder ?? 0,
        };
      },
      (body) => (area ? api.update('areas', area.id, body) : api.create('areas', body)),
    );

  return (
    <Sheet title={area ? 'עריכת תחום עבודה' : 'תחום עבודה חדש'} onClose={onClose} onSubmit={onSubmit} busy={busy} error={error}>
      <TextInput label="שם התחום" value={f.name} onChange={set('name')} required />
      <Select
        label="סטטוס"
        value={f.status}
        options={AREA_STATUS_LABELS}
        onChange={(v) => setF((p) => ({ ...p, status: v, progress: v === 'done' ? '100' : p.progress }))}
      />
      <TextInput label="אחוז התקדמות" value={f.progress} onChange={set('progress')} inputMode="numeric" />
      <MoneyField
        label="הערכת עלות"
        amount={f.estimate}
        onAmount={set('estimate')}
        vat={f.estimateVat}
        onVat={set('estimateVat')}
      />
      <p className="hint">ההערכה משמשת לתחזית כל עוד לא נבחרה הצעת מחיר.</p>
      <TextArea label="הערות" value={f.notes} onChange={set('notes')} />
    </Sheet>
  );
}

// ---------- Quote ----------

const NEW_SUPPLIER = '__new__';

export function QuoteForm({ areaId, quote, onClose }: { areaId: string; quote?: Quote; onClose: () => void }) {
  const { data } = useData();
  const [f, setF] = useState({
    supplierId: quote?.supplierId ?? (data.suppliers.length ? '' : NEW_SUPPLIER),
    newSupplier: '',
    amount: agorotToInput(quote?.amount),
    vatMode: quote?.vatMode ?? ('excl' as VatMode),
    receivedDate: quote?.receivedDate ?? todayISO(),
    validUntil: quote?.validUntil ?? '',
    description: quote?.description ?? '',
    status: quote?.status ?? ('open' as QuoteStatus),
  });
  const [files, setFiles] = useState<File[]>([]);
  // If an upload fails after the quote was saved, a retry must not create the quote or the
  // already-uploaded files a second time.
  const createdId = useRef<string | null>(null);
  const uploaded = useRef(new Set<File>());
  const set = setter(setF);
  const { busy, error, validated, remove } = useSubmit(onClose);

  const onSubmit = () =>
    validated(
      () => {
        if (!f.supplierId) throw new FormError('יש לבחור ספק');
        try {
          files.forEach(checkFileSize);
        } catch (e) {
          throw new FormError((e as Error).message);
        }
        return {
          newSupplier: f.supplierId === NEW_SUPPLIER ? requireText('שם הספק החדש', f.newSupplier) : null,
          body: {
            supplierId: f.supplierId,
            amount: amountOf('סכום ההצעה', f.amount, { required: true }),
            vatMode: f.vatMode,
            receivedDate: f.receivedDate || null,
            validUntil: f.validUntil || null,
            description: f.description,
            status: f.status,
          },
        };
      },
      async ({ newSupplier, body }) => {
        let supplierId = body.supplierId;
        if (newSupplier) supplierId = (await api.create('suppliers', { name: newSupplier })).id;
        const payload = { ...body, supplierId };
        let quoteId = quote?.id ?? createdId.current;
        if (quoteId) await api.update('quotes', quoteId, payload);
        else quoteId = createdId.current = (await api.create('quotes', { ...payload, workAreaId: areaId })).id;
        for (const file of files) {
          if (uploaded.current.has(file)) continue;
          await api.uploadQuoteFile(quoteId, file);
          uploaded.current.add(file);
        }
      },
    );

  return (
    <Sheet title={quote ? 'עריכת הצעת מחיר' : 'הצעת מחיר חדשה'} onClose={onClose} onSubmit={onSubmit} busy={busy}
      error={error}
      onDelete={quote ? () => remove('למחוק את הצעת המחיר ואת הקבצים שלה?', () => api.remove('quotes', quote.id)) : undefined}
    >
      <Select
        label="ספק *"
        value={f.supplierId}
        onChange={set('supplierId')}
        options={[
          ...(f.supplierId === '' ? [{ value: '', label: 'בחרו ספק…' }] : []),
          ...data.suppliers.map((s) => ({ value: s.id, label: s.name })),
          { value: NEW_SUPPLIER, label: '+ ספק חדש' },
        ]}
      />
      {f.supplierId === NEW_SUPPLIER && (
        <TextInput label="שם הספק החדש" value={f.newSupplier} onChange={set('newSupplier')} required />
      )}
      <MoneyField label="סכום ההצעה" amount={f.amount} onAmount={set('amount')} vat={f.vatMode} onVat={set('vatMode')} required />
      <div className="field-row">
        <TextInput label="תאריך קבלה" type="date" value={f.receivedDate} onChange={set('receivedDate')} />
        <TextInput label="בתוקף עד" type="date" value={f.validUntil} onChange={set('validUntil')} />
      </div>
      <TextArea label="מה כלול בהצעה" value={f.description} onChange={set('description')} />
      <Field label={quote ? 'צירוף קבצים נוספים' : 'קובץ ההצעה (PDF או תמונה)'}>
        {(id) => (
          <>
            <input
              id={id}
              type="file"
              accept={QUOTE_FILE_ACCEPT}
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && (
              <ul className="picked-files">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}`} dir="auto">
                    {file.name} · {formatFileSize(file.size)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Field>
      <Select label="סטטוס" value={f.status} onChange={set('status')} options={QUOTE_STATUS_LABELS} />
    </Sheet>
  );
}

// ---------- Change order ----------

export function ChangeOrderForm({ areaId, change, onClose }: { areaId: string; change?: ChangeOrder; onClose: () => void }) {
  const [f, setF] = useState({
    description: change?.description ?? '',
    amount: agorotToInput(change?.amount),
    vatMode: change?.vatMode ?? ('excl' as VatMode),
    date: change?.date ?? todayISO(),
    status: change?.status ?? ('pending' as ChangeOrderStatus),
  });
  const set = setter(setF);
  const { busy, error, validated, remove } = useSubmit(onClose);

  const onSubmit = () =>
    validated(
      () => ({
        description: requireText('תיאור', f.description),
        amount: amountOf('סכום', f.amount, { required: true, allowNegative: true }),
        vatMode: f.vatMode,
        date: f.date || null,
        status: f.status,
      }),
      (body) => (change ? api.update('change-orders', change.id, body) : api.create('change-orders', { ...body, workAreaId: areaId })),
    );

  return (
    <Sheet title={change ? 'עריכת תוספת' : 'תוספת לחוזה'} onClose={onClose} onSubmit={onSubmit} busy={busy}
      error={error}
      onDelete={change ? () => remove('למחוק את התוספת?', () => api.remove('change-orders', change.id)) : undefined}
    >
      <TextInput label="תיאור" value={f.description} onChange={set('description')} required />
      <MoneyField
        label="סכום (זיכוי בסימן מינוס)"
        amount={f.amount}
        onAmount={set('amount')}
        vat={f.vatMode}
        onVat={set('vatMode')}
        required
        allowNegative
      />
      <TextInput label="תאריך" type="date" value={f.date} onChange={set('date')} />
      <Select
        label="סטטוס"
        value={f.status}
        onChange={set('status')}
        options={CHANGE_ORDER_STATUS_LABELS}
        hint="רק תוספות שאושרו נכללות בתחזית."
      />
    </Sheet>
  );
}

// ---------- General expense ----------

const DEFAULT_EXPENSE_VAT: Record<ExpenseCategory, VatMode> = {
  fee: 'exempt',
  insurance: 'exempt',
  permit: 'exempt',
  consultant: 'excl',
  other: 'excl',
};

export function ExpenseForm({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const [f, setF] = useState({
    category: expense?.category ?? ('fee' as ExpenseCategory),
    description: expense?.description ?? '',
    payee: expense?.payee ?? '',
    estimate: agorotToInput(expense?.estimateAmount),
    estimateVat: expense?.estimateVat ?? DEFAULT_EXPENSE_VAT.fee,
    actual: agorotToInput(expense?.actualAmount),
    actualVat: expense?.actualVat ?? DEFAULT_EXPENSE_VAT.fee,
    notes: expense?.notes ?? '',
  });
  const set = setter(setF);
  const { busy, error, validated } = useSubmit(onClose);

  const onCategory = (category: ExpenseCategory) =>
    setF((p) =>
      expense
        ? { ...p, category }
        : { ...p, category, estimateVat: DEFAULT_EXPENSE_VAT[category], actualVat: DEFAULT_EXPENSE_VAT[category] },
    );

  const onSubmit = () =>
    validated(
      () => ({
        category: f.category,
        description: requireText('תיאור', f.description),
        payee: f.payee,
        estimateAmount: amountOf('הערכה', f.estimate),
        estimateVat: f.estimateVat,
        actualAmount: amountOf('סכום בפועל', f.actual),
        actualVat: f.actualVat,
        notes: f.notes,
      }),
      (body) => (expense ? api.update('expenses', expense.id, body) : api.create('expenses', body)),
    );

  return (
    <Sheet title={expense ? 'עריכת הוצאה' : 'הוצאה כללית חדשה'} onClose={onClose} onSubmit={onSubmit} busy={busy} error={error}>
      <Select label="קטגוריה" value={f.category} onChange={onCategory} options={EXPENSE_CATEGORY_LABELS} />
      <TextInput label="תיאור" value={f.description} onChange={set('description')} required />
      <TextInput label="למי משלמים" value={f.payee} onChange={set('payee')} />
      <MoneyField label="הערכה" amount={f.estimate} onAmount={set('estimate')} vat={f.estimateVat} onVat={set('estimateVat')} />
      <MoneyField label="סכום בפועל" amount={f.actual} onAmount={set('actual')} vat={f.actualVat} onVat={set('actualVat')} />
      <p className="hint">כשיש סכום בפועל, התחזית משתמשת בו במקום בהערכה.</p>
      <TextArea label="הערות" value={f.notes} onChange={set('notes')} />
    </Sheet>
  );
}

// ---------- Payment ----------

export function PaymentForm({
  payment,
  target,
  onClose,
}: {
  payment?: Payment;
  /** Preselected target, e.g. "area:<id>" or "expense:<id>". */
  target?: string;
  onClose: () => void;
}) {
  const { data } = useData();
  const initialTarget = payment
    ? payment.workAreaId
      ? `area:${payment.workAreaId}`
      : `expense:${payment.expenseId}`
    : (target ?? '');
  const [f, setF] = useState({
    target: initialTarget,
    amount: agorotToInput(payment?.amount),
    vatMode: payment?.vatMode ?? ('incl' as VatMode),
    date: payment?.date ?? todayISO(),
    status: payment?.status ?? ('paid' as PaymentStatus),
    method: payment?.method ?? ('transfer' as PaymentMethod | ''),
    reference: payment?.reference ?? '',
    notes: payment?.notes ?? '',
  });
  const set = setter(setF);
  const { busy, error, validated, remove } = useSubmit(onClose);

  const onSubmit = () =>
    validated(
      () => {
        const [kind, id] = f.target.split(':');
        if (!id) throw new FormError('יש לבחור על מה התשלום');
        if (!f.date) throw new FormError('יש למלא תאריך');
        return {
          workAreaId: kind === 'area' ? id : null,
          expenseId: kind === 'expense' ? id : null,
          amount: amountOf('סכום', f.amount, { required: true }),
          vatMode: f.vatMode,
          date: f.date,
          status: f.status,
          method: f.method || null,
          reference: f.reference,
          notes: f.notes,
        };
      },
      (body) => (payment ? api.update('payments', payment.id, body) : api.create('payments', body)),
    );

  return (
    <Sheet title={payment ? 'עריכת תשלום' : 'תשלום חדש'} onClose={onClose} onSubmit={onSubmit} busy={busy}
      error={error}
      onDelete={payment ? () => remove('למחוק את התשלום?', () => api.remove('payments', payment.id)) : undefined}
    >
      <Field label="על מה התשלום *">
        {(id) => (
          <select id={id} value={f.target} onChange={(e) => set('target')(e.target.value)}>
            {f.target === '' && <option value="">בחרו…</option>}
            {data.workAreas.length > 0 && (
              <optgroup label="תחומי עבודה">
                {data.workAreas.map((a) => (
                  <option key={a.id} value={`area:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            )}
            {data.expenses.length > 0 && (
              <optgroup label="הוצאות כלליות">
                {data.expenses.map((e) => (
                  <option key={e.id} value={`expense:${e.id}`}>
                    {e.description}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
      </Field>
      <MoneyField label="סכום" amount={f.amount} onAmount={set('amount')} vat={f.vatMode} onVat={set('vatMode')} required />
      <div className="field-row">
        <Select label="סטטוס" value={f.status} onChange={set('status')} options={PAYMENT_STATUS_LABELS} />
        <TextInput label={f.status === 'paid' ? 'תאריך תשלום' : 'מועד מתוכנן'} type="date" value={f.date} onChange={set('date')} required />
      </div>
      <Select
        label="אמצעי תשלום"
        value={f.method}
        onChange={set('method')}
        options={[{ value: '', label: '—' }, ...Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value: value as PaymentMethod, label }))]}
      />
      <TextInput label="מספר חשבונית / קבלה" value={f.reference} onChange={set('reference')} />
      <TextArea label="הערות" value={f.notes} onChange={set('notes')} />
    </Sheet>
  );
}

// ---------- Supplier ----------

export function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const [f, setF] = useState({
    name: supplier?.name ?? '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    taxId: supplier?.taxId ?? '',
    notes: supplier?.notes ?? '',
  });
  const set = setter(setF);
  const { busy, error, validated, remove } = useSubmit(onClose);

  const onSubmit = () =>
    validated(
      () => ({ ...f, name: requireText('שם הספק', f.name) }),
      (body) => (supplier ? api.update('suppliers', supplier.id, body) : api.create('suppliers', body)),
    );

  return (
    <Sheet title={supplier ? 'עריכת ספק' : 'ספק חדש'} onClose={onClose} onSubmit={onSubmit} busy={busy}
      error={error}
      onDelete={supplier ? () => remove('למחוק את הספק?', () => api.remove('suppliers', supplier.id)) : undefined}
    >
      <TextInput label="שם הספק" value={f.name} onChange={set('name')} required />
      <TextInput label="איש קשר" value={f.contactName} onChange={set('contactName')} />
      <div className="field-row">
        <TextInput label="טלפון" type="tel" value={f.phone} onChange={set('phone')} inputMode="tel" />
        <TextInput label="ח.פ. / ע.מ." value={f.taxId} onChange={set('taxId')} inputMode="numeric" />
      </div>
      <TextInput label="מייל" type="email" value={f.email} onChange={set('email')} inputMode="email" />
      <TextArea label="הערות" value={f.notes} onChange={set('notes')} />
    </Sheet>
  );
}
