import type { DailyMetrics, HrvStatus, IsoDate } from '@coach/engine';
import type {
  BodyBatteryRecord,
  DailySummaryRecord,
  HrvRecord,
  IntradayMetric,
  IntradaySeriesRecord,
  SleepRecord,
  StressRecord,
  WithRaw,
  WriteMeta,
} from '../domain/records';
import { type Column, n, runInBatches, toJson, upsertStatements } from './sql';

/** Columns every Garmin source table shares. */
function provenance<T extends { raw?: unknown }>(meta: WriteMeta): Column<T>[] {
  return [
    ['raw_json', (r) => toJson(r.raw)],
    ['source', () => meta.source],
    ['fetched_at', () => meta.fetchedAt],
    ['updated_at', () => meta.fetchedAt],
  ];
}

const DAILY_SUMMARY_COLUMNS: Column<WithRaw<DailySummaryRecord>>[] = [
  ['date', (r) => r.date],
  ['steps', (r) => n(r.steps)],
  ['step_goal', (r) => n(r.stepGoal)],
  ['distance_m', (r) => n(r.distanceM)],
  ['resting_hr', (r) => n(r.restingHr)],
  ['min_hr', (r) => n(r.minHr)],
  ['max_hr', (r) => n(r.maxHr)],
  ['active_kcal', (r) => n(r.activeKcal)],
  ['total_kcal', (r) => n(r.totalKcal)],
  ['intensity_min_moderate', (r) => n(r.intensityMinModerate)],
  ['intensity_min_vigorous', (r) => n(r.intensityMinVigorous)],
];

const SLEEP_COLUMNS: Column<WithRaw<SleepRecord>>[] = [
  ['date', (r) => r.date],
  ['sleep_start', (r) => n(r.sleepStart)],
  ['sleep_end', (r) => n(r.sleepEnd)],
  ['duration_sec', (r) => n(r.durationSec)],
  ['deep_sec', (r) => n(r.deepSec)],
  ['light_sec', (r) => n(r.lightSec)],
  ['rem_sec', (r) => n(r.remSec)],
  ['awake_sec', (r) => n(r.awakeSec)],
  ['score', (r) => n(r.score)],
  ['score_qualifier', (r) => n(r.scoreQualifier)],
  ['avg_respiration', (r) => n(r.avgRespiration)],
  ['avg_spo2', (r) => n(r.avgSpo2)],
  ['avg_sleep_stress', (r) => n(r.avgSleepStress)],
];

const HRV_COLUMNS: Column<WithRaw<HrvRecord>>[] = [
  ['date', (r) => r.date],
  ['last_night_avg_ms', (r) => n(r.lastNightAvgMs)],
  ['last_night_high_ms', (r) => n(r.lastNightHighMs)],
  ['weekly_avg_ms', (r) => n(r.weeklyAvgMs)],
  ['baseline_low_ms', (r) => n(r.baselineLowMs)],
  ['baseline_high_ms', (r) => n(r.baselineHighMs)],
  ['status', (r) => n(r.status)],
];

const BODY_BATTERY_COLUMNS: Column<WithRaw<BodyBatteryRecord>>[] = [
  ['date', (r) => r.date],
  ['charged', (r) => n(r.charged)],
  ['drained', (r) => n(r.drained)],
  ['highest', (r) => n(r.highest)],
  ['lowest', (r) => n(r.lowest)],
  ['at_wake', (r) => n(r.atWake)],
  ['end_of_day', (r) => n(r.endOfDay)],
];

const STRESS_COLUMNS: Column<WithRaw<StressRecord>>[] = [
  ['date', (r) => r.date],
  ['avg_stress', (r) => n(r.avgStress)],
  ['max_stress', (r) => n(r.maxStress)],
  ['rest_sec', (r) => n(r.restSec)],
  ['low_sec', (r) => n(r.lowSec)],
  ['medium_sec', (r) => n(r.mediumSec)],
  ['high_sec', (r) => n(r.highSec)],
];

type DailyMetricsRow = {
  date: string;
  resting_hr: number | null;
  steps: number | null;
  sleep_duration_sec: number | null;
  sleep_score: number | null;
  hrv_last_night_ms: number | null;
  hrv_weekly_avg_ms: number | null;
  hrv_status: HrvStatus | null;
  body_battery_wake: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  stress_avg: number | null;
};

type IntradayRow = {
  date: string;
  metric: IntradayMetric;
  start_at: string;
  interval_sec: number;
  samples_json: string;
};

/** Daily recovery/health tables: summary, sleep, HRV, Body Battery, stress, intraday. */
export class HealthRepository {
  constructor(private readonly db: D1Database) {}

  private async upsertAll<T extends { raw?: unknown }>(
    table: string,
    columns: Column<T>[],
    rows: T[],
    meta: WriteMeta,
  ): Promise<number> {
    const all = [...columns, ...provenance<T>(meta)];
    await runInBatches(this.db, upsertStatements(this.db, table, ['date'], all, rows));
    return rows.length;
  }

  upsertDailySummaries(rows: WithRaw<DailySummaryRecord>[], meta: WriteMeta) {
    return this.upsertAll('daily_summary', DAILY_SUMMARY_COLUMNS, rows, meta);
  }

  upsertSleep(rows: WithRaw<SleepRecord>[], meta: WriteMeta) {
    return this.upsertAll('sleep_daily', SLEEP_COLUMNS, rows, meta);
  }

  upsertHrv(rows: WithRaw<HrvRecord>[], meta: WriteMeta) {
    return this.upsertAll('hrv_daily', HRV_COLUMNS, rows, meta);
  }

  upsertBodyBattery(rows: WithRaw<BodyBatteryRecord>[], meta: WriteMeta) {
    return this.upsertAll('body_battery_daily', BODY_BATTERY_COLUMNS, rows, meta);
  }

  upsertStress(rows: WithRaw<StressRecord>[], meta: WriteMeta) {
    return this.upsertAll('stress_daily', STRESS_COLUMNS, rows, meta);
  }

  async upsertIntraday(rows: IntradaySeriesRecord[], meta: WriteMeta): Promise<number> {
    const columns: Column<IntradaySeriesRecord>[] = [
      ['date', (r) => r.date],
      ['metric', (r) => r.metric],
      ['start_at', (r) => r.startAt],
      ['interval_sec', (r) => r.intervalSec],
      ['samples_json', (r) => JSON.stringify(r.samples)],
      ['source', () => meta.source],
      ['fetched_at', () => meta.fetchedAt],
      ['updated_at', () => meta.fetchedAt],
    ];
    await runInBatches(this.db, upsertStatements(this.db, 'intraday_series', ['date', 'metric'], columns, rows));
    return rows.length;
  }

  async getIntraday(date: IsoDate, metric: IntradayMetric): Promise<IntradaySeriesRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM intraday_series WHERE date = ?1 AND metric = ?2')
      .bind(date, metric)
      .first<IntradayRow>();
    if (!row) return null;
    return {
      date: row.date,
      metric: row.metric,
      startAt: row.start_at,
      intervalSec: row.interval_sec,
      samples: JSON.parse(row.samples_json) as Array<number | null>,
    };
  }

  /** One merged row per day (inclusive range), oldest first. */
  async getDailyMetrics(from: IsoDate, to: IsoDate): Promise<DailyMetrics[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM v_daily_metrics WHERE date BETWEEN ?1 AND ?2 ORDER BY date')
      .bind(from, to)
      .all<DailyMetricsRow>();
    return results.map((r) => ({
      date: r.date,
      restingHr: r.resting_hr,
      steps: r.steps,
      sleepDurationSec: r.sleep_duration_sec,
      sleepScore: r.sleep_score,
      hrvLastNightMs: r.hrv_last_night_ms,
      hrvWeeklyAvgMs: r.hrv_weekly_avg_ms,
      hrvStatus: r.hrv_status,
      bodyBatteryWake: r.body_battery_wake,
      bodyBatteryHigh: r.body_battery_high,
      bodyBatteryLow: r.body_battery_low,
      stressAvg: r.stress_avg,
    }));
  }
}
