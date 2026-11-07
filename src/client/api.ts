import type { Dataset } from '../shared/types';

export type Entity = 'suppliers' | 'areas' | 'quotes' | 'change-orders' | 'expenses' | 'payments';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(json?.error ?? `שגיאה בשרת (${res.status})`);
  return json as T;
}

export const api = {
  data: () => request<Dataset>('GET', '/data'),
  saveSettings: (body: unknown) => request('PUT', '/settings', body),
  create: (entity: Entity, body: unknown) => request<{ id: string }>('POST', `/${entity}`, body),
  update: (entity: Entity, id: string, body: unknown) => request('PUT', `/${entity}/${id}`, body),
  remove: (entity: Entity, id: string) => request('DELETE', `/${entity}/${id}`),
  selectQuote: (areaId: string, quoteId: string | null) =>
    request('POST', `/areas/${areaId}/selection`, { quoteId }),
};
