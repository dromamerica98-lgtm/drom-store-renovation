/**
 * @coach/shared — the API contract between the Worker (apps/api) and the
 * PWA (apps/web). Only types live here; both sides import them so a contract
 * change is a compile error on whichever side falls behind.
 */

export interface StatusResponse {
  ok: true;
  service: 'coach-api';
  engineVersion: string;
  garminMode: 'mock' | 'live';
  time: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export type SyncDomainName =
  | 'daily_summary'
  | 'sleep'
  | 'hrv'
  | 'body_battery'
  | 'stress'
  | 'activities'
  | 'activity_details'
  | 'intraday';

export interface SyncResultResponse {
  runId: number;
  status: 'success' | 'partial' | 'error';
  counts: Record<string, number>;
  errors: Array<{ domain: SyncDomainName; message: string }>;
}

export interface SyncStatusResponse {
  garminMode: 'mock' | 'live';
  domains: Array<{
    domain: SyncDomainName;
    newestSyncedDate: string | null;
    oldestSyncedDate: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
  }>;
  recentRuns: Array<{
    id: number;
    trigger: 'cron' | 'manual' | 'backfill';
    status: 'running' | 'success' | 'partial' | 'error';
    startedAt: string;
    finishedAt: string | null;
    counts: Record<string, number> | null;
    error: string | null;
  }>;
}
