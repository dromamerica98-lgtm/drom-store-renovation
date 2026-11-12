/**
 * Personal baselines: today's values are judged against YOUR recent history,
 * not population norms.
 *
 * For each metric: mean and SD over the 42 days before the assessed date
 * (today excluded), requiring at least 14 samples. HRV is log-transformed
 * (ln rMSSD), the standard way to make its day-to-day variation symmetric.
 * SDs are floored so a very stable history does not make small changes look
 * dramatic.
 */
import { addDays } from './dates';
import type { IsoDate } from './domain';
import type { DailyMetrics } from './domain';
import { isNum, mean, sd } from './stats';

export const BASELINE_WINDOW_DAYS = 42;
export const MIN_BASELINE_SAMPLES = 14;

export type BaselineMetric = 'hrv' | 'restingHr' | 'sleepDuration' | 'sleepScore' | 'bodyBattery' | 'stress';

export interface Baseline {
  metric: BaselineMetric;
  /** Mean in natural units (HRV: geometric mean in ms). */
  mean: number | null;
  /** SD in the units z-scores use (HRV: ln units; others: natural units). */
  sd: number | null;
  /** Number of days with data in the window. */
  n: number;
  windowDays: number;
  sufficient: boolean;
}

interface MetricSpec {
  get: (d: DailyMetrics) => number | null;
  log: boolean;
  sdFloor: number;
}

export const METRIC_SPECS: Record<BaselineMetric, MetricSpec> = {
  hrv: { get: (d) => d.hrvLastNightMs, log: true, sdFloor: 0.05 },
  restingHr: { get: (d) => d.restingHr, log: false, sdFloor: 1.5 },
  sleepDuration: { get: (d) => d.sleepDurationSec, log: false, sdFloor: 1800 },
  sleepScore: { get: (d) => d.sleepScore, log: false, sdFloor: 4 },
  bodyBattery: { get: (d) => d.bodyBatteryWake, log: false, sdFloor: 5 },
  stress: { get: (d) => d.stressAvg, log: false, sdFloor: 3 },
};

/** Values of a metric for dates in [from, to], positive/finite only for HRV. */
export function metricValues(history: readonly DailyMetrics[], metric: BaselineMetric, from: IsoDate, to: IsoDate): number[] {
  const spec = METRIC_SPECS[metric];
  return history
    .filter((d) => d.date >= from && d.date <= to)
    .map(spec.get)
    .filter((v): v is number => isNum(v) && (!spec.log || v > 0));
}

export function computeBaseline(history: readonly DailyMetrics[], metric: BaselineMetric, date: IsoDate): Baseline {
  const spec = METRIC_SPECS[metric];
  const values = metricValues(history, metric, addDays(date, -BASELINE_WINDOW_DAYS), addDays(date, -1));
  const transformed = spec.log ? values.map(Math.log) : values;
  const m = mean(transformed);
  const s = sd(transformed);
  return {
    metric,
    mean: m === null ? null : spec.log ? Math.exp(m) : m,
    sd: s === null ? null : Math.max(s, spec.sdFloor),
    n: values.length,
    windowDays: BASELINE_WINDOW_DAYS,
    sufficient: values.length >= MIN_BASELINE_SAMPLES,
  };
}

export function computeBaselines(history: readonly DailyMetrics[], date: IsoDate): Record<BaselineMetric, Baseline> {
  return {
    hrv: computeBaseline(history, 'hrv', date),
    restingHr: computeBaseline(history, 'restingHr', date),
    sleepDuration: computeBaseline(history, 'sleepDuration', date),
    sleepScore: computeBaseline(history, 'sleepScore', date),
    bodyBattery: computeBaseline(history, 'bodyBattery', date),
    stress: computeBaseline(history, 'stress', date),
  };
}

/** z-score of a value against a baseline (HRV handled in log space). Null if not computable. */
export function zScore(baseline: Baseline, value: number | null): number | null {
  if (!isNum(value) || baseline.mean === null || baseline.sd === null) return null;
  const spec = METRIC_SPECS[baseline.metric];
  if (spec.log) {
    if (value <= 0) return null;
    return (Math.log(value) - Math.log(baseline.mean)) / baseline.sd;
  }
  return (value - baseline.mean) / baseline.sd;
}
