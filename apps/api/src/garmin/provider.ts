/**
 * The Garmin integration boundary.
 *
 * Everything above this interface (sync, services, routes, UI) works with
 * normalised records only. Implementations:
 *   - MockGarminProvider  — deterministic synthetic data (now)
 *   - LiveGarminProvider  — Garmin Connect Personal API (Stage 6)
 */
import type { DataSource, IsoDate } from '@coach/engine';
import type {
  ActivityDetailsRecord,
  ActivityRecord,
  BodyBatteryRecord,
  DailySummaryRecord,
  HrvRecord,
  IntradaySeriesRecord,
  SleepRecord,
  StressRecord,
  SyncDomain,
  WithRaw,
} from '../domain/records';

/** Inclusive range of local calendar dates. */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface GarminProvider {
  readonly mode: 'mock' | 'live';
  /** Value written to the `source` column of every stored row. */
  readonly source: DataSource;

  dailySummaries(range: DateRange): Promise<WithRaw<DailySummaryRecord>[]>;
  sleep(range: DateRange): Promise<WithRaw<SleepRecord>[]>;
  hrv(range: DateRange): Promise<WithRaw<HrvRecord>[]>;
  bodyBattery(range: DateRange): Promise<WithRaw<BodyBatteryRecord>[]>;
  stress(range: DateRange): Promise<WithRaw<StressRecord>[]>;
  /** Activities whose local start date falls in the range. */
  activities(range: DateRange): Promise<WithRaw<ActivityRecord>[]>;
  /** Laps and downsampled streams (from activity details / FIT). Null if unavailable. */
  activityDetails(activityId: number): Promise<ActivityDetailsRecord | null>;
  /** Intraday curves for one day (heart rate, stress, Body Battery …). */
  intraday(date: IsoDate): Promise<IntradaySeriesRecord[]>;
}

export class GarminProviderError extends Error {
  constructor(
    message: string,
    readonly options: { domain?: SyncDomain; status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'GarminProviderError';
  }
}
