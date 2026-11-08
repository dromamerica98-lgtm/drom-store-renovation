import type { Dataset } from '../shared/types';

export type Entity = 'suppliers' | 'areas' | 'quotes' | 'change-orders' | 'expenses' | 'payments';

/** The Access session ended (or never existed); a full page load sends the user to the login page. */
export class AuthError extends Error {}

const SESSION_ENDED = 'פג תוקף ההתחברות. טענו מחדש את הדף כדי להתחבר שוב.';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    // When the Access session has expired, Access answers with a redirect to its login page.
    redirect: 'manual',
    headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.type === 'opaqueredirect') throw new AuthError(SESSION_ENDED);
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401 || res.status === 403) throw new AuthError(json?.error ?? SESSION_ENDED);
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
  uploadQuoteFile: (quoteId: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<{ id: string }>('POST', `/quotes/${quoteId}/files`, form);
  },
  deleteFile: (id: string) => request('DELETE', `/files/${id}`),
};

/** Address for viewing a file in the browser (Access cookies make it work for signed-in users only). */
export function fileUrl(id: string, download = false): string {
  return `/api/files/${id}${download ? '?download=1' : ''}`;
}
