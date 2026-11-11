import { areaDisplayNames } from '../shared/labels';
import type { Dataset, Payment, WorkArea } from '../shared/types';

const namesCache = new WeakMap<WorkArea[], Map<string, string>>();

/** Area names as shown on screen; the zone is added when a name exists in several zones. */
export function areaName(data: Dataset, areaId: string | null | undefined): string | undefined {
  if (!areaId) return undefined;
  let names = namesCache.get(data.workAreas);
  if (!names) {
    names = areaDisplayNames(data.workAreas);
    namesCache.set(data.workAreas, names);
  }
  return names.get(areaId);
}

/** Name of what a payment is for (work area or general expense). */
export function paymentTargetName(data: Dataset, p: Payment): string {
  if (p.workAreaId) return areaName(data, p.workAreaId) ?? 'תחום שנמחק';
  return data.expenses.find((e) => e.id === p.expenseId)?.description ?? 'הוצאה שנמחקה';
}

export function paymentTargetLink(p: Payment): string {
  return p.workAreaId ? `/areas/${p.workAreaId}` : `/expenses/${p.expenseId}`;
}

/** The supplier a payment goes to: the selected supplier of its work area, or an expense's payee. */
export function paymentPayee(data: Dataset, p: Payment): { id: string | null; name: string } | null {
  if (p.workAreaId) {
    const area = data.workAreas.find((a) => a.id === p.workAreaId);
    const quote = data.quotes.find((q) => q.id === area?.selectedQuoteId);
    const supplier = data.suppliers.find((s) => s.id === quote?.supplierId);
    return supplier ? { id: supplier.id, name: supplier.name } : null;
  }
  const payee = data.expenses.find((e) => e.id === p.expenseId)?.payee;
  return payee ? { id: null, name: payee } : null;
}

export function supplierName(data: Dataset, id: string | null | undefined): string {
  return data.suppliers.find((s) => s.id === id)?.name ?? '—';
}
