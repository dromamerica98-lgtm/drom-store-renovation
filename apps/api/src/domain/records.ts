/**
 * Normalised records as stored in D1. Garmin (or mock) payloads are mapped to
 * these shapes by the provider layer; repositories persist them.
 */
import type {
  ActivitySummary,
  DataSource,
  HrvStatus,
  IsoDate,
  IsoTimestamp,
} from '@coach/engine';

/** Provenance attached to every write. */
export interface WriteMeta {
  source: DataSource;
  fetchedAt: IsoTimestamp;
}

/** A record plus the provider's raw payload, kept for later re-mapping. */
export type WithRaw<T> = T & { raw?: unknown };

export interface DailySummaryRecord {
  date: IsoDate;
  steps: number | null;
  stepGoal: number | null;
  distanceM: number | null;
  restingHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  activeKcal: number | null;
  totalKcal: number | null;
  intensityMinModerate: number | null;
  intensityMinVigorous: number | null;
}

export interface SleepRecord {
  /** Date the user woke up. */
  date: IsoDate;
  sleepStart: IsoTimestamp | null;
  sleepEnd: IsoTimestamp | null;
  durationSec: number | null;
  deepSec: number | null;
  lightSec: number | null;
  remSec: number | null;
  awakeSec: number | null;
  score: number | null;
  scoreQualifier: string | null;
  avgRespiration: number | null;
  avgSpo2: number | null;
  avgSleepStress: number | null;
}

export interface HrvRecord {
  date: IsoDate;
  lastNightAvgMs: number | null;
  lastNightHighMs: number | null;
  weeklyAvgMs: number | null;
  baselineLowMs: number | null;
  baselineHighMs: number | null;
  status: HrvStatus | null;
}

export interface BodyBatteryRecord {
  date: IsoDate;
  charged: number | null;
  drained: number | null;
  highest: number | null;
  lowest: number | null;
  atWake: number | null;
  endOfDay: number | null;
}

export interface StressRecord {
  date: IsoDate;
  avgStress: number | null;
  maxStress: number | null;
  restSec: number | null;
  lowSec: number | null;
  mediumSec: number | null;
  highSec: number | null;
}

export const INTRADAY_METRICS = ['heart_rate', 'stress', 'body_battery', 'respiration', 'spo2'] as const;
export type IntradayMetric = (typeof INTRADAY_METRICS)[number];

export interface IntradaySeriesRecord {
  date: IsoDate;
  metric: IntradayMetric;
  startAt: IsoTimestamp;
  intervalSec: number;
  /** Fixed-interval samples; null marks a gap. */
  samples: Array<number | null>;
}

export interface ActivityRecord extends ActivitySummary {
  startLocal: string;
  garminTypeKey: string | null;
  movingDurationSec: number | null;
  elevationGainM: number | null;
  maxSpeedMps: number | null;
  avgPowerW: number | null;
  normalizedPowerW: number | null;
  avgCadence: number | null;
  calories: number | null;
  hasDetails: boolean;
}

export interface ActivityLap {
  index: number;
  startOffsetSec: number;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
}

/** Downsampled time series for one activity; arrays are index-aligned with `t`. */
export interface ActivityStreams {
  t: number[];
  hr?: Array<number | null>;
  speedMps?: Array<number | null>;
  altitudeM?: Array<number | null>;
  powerW?: Array<number | null>;
  cadence?: Array<number | null>;
}

export interface ActivityDetailsRecord {
  activityId: number;
  laps: ActivityLap[] | null;
  streams: ActivityStreams | null;
  fitObjectKey: string | null;
  fitSizeBytes: number | null;
}

export const SYNC_DOMAINS = [
  'daily_summary',
  'sleep',
  'hrv',
  'body_battery',
  'stress',
  'activities',
  'activity_details',
  'intraday',
] as const;
export type SyncDomain = (typeof SYNC_DOMAINS)[number];
