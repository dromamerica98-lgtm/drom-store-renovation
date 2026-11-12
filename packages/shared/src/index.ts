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

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

import type {
  ActivityView,
  DailyMetrics,
  DayClass,
  Flag,
  HarderGuard,
  IsoDate,
  ModificationKind,
  Readiness,
  Reason,
  RuleId,
  VolumeWindow,
  Workout,
  WorkoutType,
} from '@coach/engine';

export type {
  ActivityView,
  DailyMetrics,
  Flag,
  HarderGuard,
  ModificationKind,
  Readiness,
  ReadinessComponent,
  Reason,
  RepeatBlock,
  Target,
  VolumeWindow,
  Workout,
  WorkoutBlock,
  WorkoutStep,
  WorkoutType,
} from '@coach/engine';

export type LoadStatus = 'unknown' | 'low' | 'balanced' | 'high' | 'spike';

export interface AppliedModification {
  kind: ModificationKind;
  minutes: number | null;
  reasons: Reason[];
}

export interface TodayRecommendation {
  id: number;
  ruleId: RuleId;
  /** The workout to do today (after any modifications). */
  workout: Workout;
  /** Why the engine chose its original recommendation; decisive reason first. */
  reasons: Reason[];
  summary: string;
  /** Can "Make it harder" succeed today? If not, why. */
  harder: HarderGuard;
  /** Modifications applied on top of the engine's choice, oldest first. */
  modifications: AppliedModification[];
  /** The engine's original workout when modified, else null. */
  original: { type: WorkoutType; title: string; durationSec: number } | null;
}

export interface TodayResponse {
  date: IsoDate;
  generatedAt: string;
  engineVersion: string;
  garminMode: 'mock' | 'live';
  lastSyncAt: string | null;
  /** Today's raw metrics (last night's sleep/HRV, wake Body Battery …). */
  today: DailyMetrics | null;
  readiness: Readiness;
  flags: Flag[];
  load: {
    atl: number;
    ctl: number;
    tsb: number;
    acwr: number | null;
    status: LoadStatus;
    sufficientHistory: boolean;
  };
  yesterday: { date: IsoDate; dayClass: DayClass; activities: ActivityView[] };
  week: {
    last7: VolumeWindow;
    previous7: VolumeWindow;
    avgWeek28: { sessions: number; durationSec: number; distanceM: number; load: number };
    intensity28: { low: number; moderate: number; high: number } | null;
    hardDaysLast7: number;
  };
  recommendation: TodayRecommendation;
  /** Present on modify responses: whether the request was applied, and why (not). */
  modificationResult?: { applied: boolean; reasons: Reason[] };
}

export interface ModifyRequest {
  kind: ModificationKind;
  /** Required for kind = "time_limit". */
  minutes?: number;
}
