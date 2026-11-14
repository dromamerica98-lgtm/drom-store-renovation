/**
 * Typed client for the Worker API (same origin, /api/*).
 * No credentials or Garmin details ever live here: authentication is the
 * Cloudflare Access cookie, which JavaScript cannot read (HttpOnly).
 */
import type { ApiError as ApiErrorBody, ModifyRequest, StatusResponse, SyncResultResponse, TodayResponse } from '@coach/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }

  /** The Access session expired or is missing: a reload sends the user to sign in. */
  get signInRequired(): boolean {
    return this.status === 401;
  }
}

export interface Fetched<T> {
  data: T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Fetched<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      // An expired Access session answers with a redirect to the login page;
      // don't follow it from fetch(), report it so the UI can reload.
      redirect: 'manual',
      cache: 'no-store',
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline.');
  }
  if (res.type === 'opaqueredirect' || res.status === 401) {
    throw new ApiError(401, 'Your sign-in has expired.', 'unauthorized');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.message ?? `Request failed (${res.status})`, body?.error.code);
  }
  return { data: (await res.json()) as T };
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  status: () => request<StatusResponse>('/status'),
  today: () => request<TodayResponse>('/today'),
  modify: (req: ModifyRequest) => post<TodayResponse>('/today/modify', req),
  reset: () => post<TodayResponse>('/today/reset'),
  sync: () => post<SyncResultResponse>('/sync'),
  mockReset: (scenario: string) => post<SyncResultResponse>('/dev/mock/reset', { scenario }),
};

/** Clears every cache the app owns, then signs out of Cloudflare Access. */
export async function signOut(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage('clear-caches');
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } finally {
    window.location.href = '/cdn-cgi/access/logout';
  }
}
