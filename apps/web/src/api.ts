/**
 * Typed client for the Worker API. Same origin: /api/* is proxied to the
 * API Worker (Vite proxy in dev, Pages Function + service binding in prod).
 * No credentials or Garmin details ever live here.
 */
import type { ApiError as ApiErrorBody, ModifyRequest, StatusResponse, SyncResultResponse, TodayResponse } from '@coach/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Fetched<T> {
  data: T;
  /** True when the service worker served a cached copy because the network failed. */
  offline: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Fetched<T>> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error.message ?? `Request failed (${res.status})`);
  }
  return { data: (await res.json()) as T, offline: res.headers.get('x-coach-offline') === '1' };
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
