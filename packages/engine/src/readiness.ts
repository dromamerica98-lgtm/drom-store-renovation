/**
 * Readiness: how recovered you are this morning, 0–100.
 *
 * Each component is scored from its z-score against YOUR baseline:
 *     score = clamp(70 + 20 × z_good, 0, 100)
 * where z_good is the z-score oriented so that positive is good (HRV, sleep,
 * Body Battery up; resting HR, stress down). "Normal for you" (z = 0) is 70,
 * one SD better is 90, one SD worse is 50, two SD worse is 30.
 *
 * A few absolute safety caps apply on top (e.g. under 5 h sleep), because
 * some thresholds matter no matter what your normal is.
 *
 * Until a baseline has 14 days of data the component falls back to Garmin's
 * own classification or the raw value, and counts less toward confidence.
 */
import {
  computeBaseline,
  computeBaselines,
  metricValues,
  zScore,
  type Baseline,
  type BaselineMetric,
} from './baselines';
import { addDays } from './dates';
import type { IsoDate } from './domain';
import type { DailyMetrics } from './domain';
import { fmtDuration } from './format';
import { clamp, isNum, mean, round } from './stats';

export type ComponentKey = 'hrv' | 'sleep' | 'restingHr' | 'bodyBattery' | 'stress';
export type ReadinessBand = 'primed' | 'good' | 'moderate' | 'low' | 'very_low' | 'unknown';
export type ComponentStatus = 'better' | 'normal' | 'worse' | 'much_worse' | 'unknown';

export const COMPONENT_WEIGHTS: Record<ComponentKey, number> = {
  hrv: 0.3,
  sleep: 0.25,
  restingHr: 0.2,
  bodyBattery: 0.15,
  stress: 0.1,
};

/** Confidence weight of a component scored without a personal baseline. */
const FALLBACK_QUALITY = 0.6;

export interface ReadinessComponent {
  key: ComponentKey;
  label: string;
  /** Today's value in natural units (sleep: seconds). */
  value: number | null;
  unit: 'ms' | 'bpm' | 's' | 'score';
  /** Baseline mean in natural units. */
  baseline: number | null;
  z: number | null;
  score: number | null;
  weight: number;
  basis: 'baseline' | 'fallback' | 'missing';
  status: ComponentStatus;
  note: string;
  /** Secondary values, e.g. sleep score next to sleep duration. */
  extra?: Record<string, number | null>;
}

export interface Readiness {
  score: number | null;
  band: ReadinessBand;
  /** 0–1: how much of the readiness model is backed by personal baselines. */
  confidence: number;
  components: ReadinessComponent[];
}

export type FlagCode =
  | 'illness_pattern'
  | 'rhr_elevated'
  | 'hrv_suppressed'
  | 'hrv_trend_low'
  | 'very_short_sleep'
  | 'short_sleep'
  | 'body_battery_low'
  | 'high_stress'
  | 'missing_today_data'
  | 'calibrating'
  | 'load_spike'
  | 'load_high'
  | 'load_low'
  | 'load_history_short'
  | 'consecutive_hard_days'
  | 'no_rest_day';

export interface Flag {
  code: FlagCode;
  severity: 'info' | 'caution' | 'warning' | 'critical';
  message: string;
}

export function scoreFromZ(zGood: number): number {
  return Math.round(clamp(70 + 20 * zGood, 0, 100));
}

function statusFromZ(zGood: number | null): ComponentStatus {
  if (zGood === null) return 'unknown';
  if (zGood >= 0.5) return 'better';
  if (zGood > -0.5) return 'normal';
  if (zGood > -1.5) return 'worse';
  return 'much_worse';
}

export function bandFor(score: number | null): ReadinessBand {
  if (score === null) return 'unknown';
  if (score >= 80) return 'primed';
  if (score >= 65) return 'good';
  if (score >= 50) return 'moderate';
  if (score >= 35) return 'low';
  return 'very_low';
}

const pct = (value: number, base: number) => Math.round(((value - base) / base) * 100);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export interface ReadinessResult {
  readiness: Readiness;
  baselines: Record<BaselineMetric, Baseline>;
  flags: Flag[];
}

export function computeReadiness(date: IsoDate, history: readonly DailyMetrics[]): ReadinessResult {
  const baselines = computeBaselines(history, date);
  // Stress is judged on yesterday's full day, so its baseline ends the day before that.
  baselines.stress = computeBaseline(history, 'stress', addDays(date, -1));
  const today = history.find((d) => d.date === date);
  const yesterday = history.find((d) => d.date === addDays(date, -1));
  const flags: Flag[] = [];
  const components: ReadinessComponent[] = [];

  // --- HRV ---------------------------------------------------------------
  {
    const value = today?.hrvLastNightMs ?? null;
    const b = baselines.hrv;
    const z = b.sufficient ? zScore(b, value) : null;
    let score: number | null = null;
    let basis: ReadinessComponent['basis'] = 'missing';
    let note = 'No HRV reading from last night.';
    if (z !== null && isNum(value)) {
      score = scoreFromZ(z);
      basis = 'baseline';
      const p = pct(value, b.mean!);
      note = `HRV ${Math.round(value)} ms, ${p === 0 ? 'right at' : `${Math.abs(p)}% ${p > 0 ? 'above' : 'below'}`} your baseline of ${Math.round(b.mean!)} ms.`;
    } else if (isNum(value)) {
      const byStatus = { balanced: 70, unbalanced: 50, low: 35, poor: 25, none: null } as const;
      const s = today?.hrvStatus ? byStatus[today.hrvStatus] : null;
      if (s !== null) {
        score = s;
        basis = 'fallback';
      }
      note = `HRV ${Math.round(value)} ms. Your personal baseline is still being built (${b.n}/14 nights).`;
    }
    components.push({
      key: 'hrv',
      label: 'HRV',
      value,
      unit: 'ms',
      baseline: b.mean === null ? null : round(b.mean, 1),
      z: z === null ? null : round(z, 2),
      score,
      weight: COMPONENT_WEIGHTS.hrv,
      basis,
      status: statusFromZ(z),
      note,
      extra: { weeklyAvgMs: today?.hrvWeeklyAvgMs ?? null },
    });
    if (z !== null && z <= -1.5) {
      flags.push({ code: 'hrv_suppressed', severity: 'warning', message: 'HRV is well below your normal range.' });
    }
    // Sustained suppression: 7-day mean of ln(HRV) below baseline by > 0.5 SD.
    if (b.sufficient && b.mean !== null && b.sd !== null) {
      const recent = metricValues(history, 'hrv', addDays(date, -6), date).map(Math.log);
      const m = mean(recent);
      if (recent.length >= 4 && m !== null && (m - Math.log(b.mean)) / b.sd < -0.5) {
        flags.push({ code: 'hrv_trend_low', severity: 'caution', message: 'Your 7-day HRV average is trending below baseline.' });
      }
    }
  }

  // --- Sleep -------------------------------------------------------------
  {
    const dur = today?.sleepDurationSec ?? null;
    const sleepScore = today?.sleepScore ?? null;
    const bd = baselines.sleepDuration;
    const bs = baselines.sleepScore;
    const zDur = bd.sufficient ? zScore(bd, dur) : null;
    const zScoreSleep = bs.sufficient ? zScore(bs, sleepScore) : null;
    const zs = [zDur, zScoreSleep].filter(isNum);
    let score: number | null = null;
    let basis: ReadinessComponent['basis'] = 'missing';
    if (zs.length) {
      score = Math.round(zs.map(scoreFromZ).reduce((a, b) => a + b, 0) / zs.length);
      basis = 'baseline';
    } else if (isNum(dur) || isNum(sleepScore)) {
      const parts = [
        isNum(dur) ? clamp(100 - 25 * (8 - dur / 3600), 0, 100) : null,
        isNum(sleepScore) ? sleepScore : null,
      ].filter(isNum);
      score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
      basis = 'fallback';
    }
    if (score !== null && isNum(dur)) {
      if (dur < 5 * 3600) score = Math.min(score, 30);
      else if (dur < 6 * 3600) score = Math.min(score, 50);
    }
    const zCombined = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
    let note = 'No sleep recorded for last night.';
    if (isNum(dur)) {
      note = `Slept ${fmtDuration(dur)}`;
      if (bd.mean !== null && bd.sufficient) note += ` (usual ${fmtDuration(bd.mean)})`;
      if (isNum(sleepScore)) note += `, sleep score ${sleepScore}`;
      if (isNum(sleepScore) && bs.mean !== null && bs.sufficient) note += ` (usual ${Math.round(bs.mean)})`;
      note += '.';
    }
    components.push({
      key: 'sleep',
      label: 'Sleep',
      value: dur,
      unit: 's',
      baseline: bd.mean === null ? null : Math.round(bd.mean),
      z: zCombined === null ? null : round(zCombined, 2),
      score,
      weight: COMPONENT_WEIGHTS.sleep,
      basis,
      status: statusFromZ(zCombined),
      note,
      extra: { sleepScore, sleepScoreBaseline: bs.mean === null ? null : Math.round(bs.mean) },
    });
    if (isNum(dur) && dur < 5 * 3600) {
      flags.push({ code: 'very_short_sleep', severity: 'warning', message: `Only ${fmtDuration(dur)} of sleep.` });
    } else if (isNum(dur) && (dur < 6 * 3600 || (zDur !== null && zDur <= -1.5))) {
      flags.push({ code: 'short_sleep', severity: 'caution', message: `Short night: ${fmtDuration(dur)} of sleep.` });
    }
  }

  // --- Resting HR (lower is better) ---------------------------------------
  {
    const value = today?.restingHr ?? yesterday?.restingHr ?? null;
    const b = baselines.restingHr;
    const z = b.sufficient ? zScore(b, value) : null;
    const delta = isNum(value) && b.mean !== null ? Math.round(value - b.mean) : null;
    components.push({
      key: 'restingHr',
      label: 'Resting HR',
      value,
      unit: 'bpm',
      baseline: b.mean === null ? null : round(b.mean, 1),
      z: z === null ? null : round(z, 2),
      score: z === null ? null : scoreFromZ(-z),
      weight: COMPONENT_WEIGHTS.restingHr,
      basis: z === null ? 'missing' : 'baseline',
      status: statusFromZ(z === null ? null : -z),
      note: !isNum(value)
        ? 'No resting heart rate yet.'
        : z === null
          ? `Resting HR ${value} bpm. Baseline still being built.`
          : `Resting HR ${value} bpm, ${delta === 0 ? 'same as' : `${signed(delta!)} bpm vs`} your baseline of ${Math.round(b.mean!)}.`,
    });
    const hrvZ = components.find((c) => c.key === 'hrv')?.z ?? null;
    const elevated = z !== null && (z >= 2 || (delta !== null && delta >= 5));
    // Illness needs a clear absolute rise as well as a statistical one, plus suppressed HRV.
    const illnessRise = z !== null && z >= 2 && delta !== null && delta >= 4;
    if (illnessRise && hrvZ !== null && hrvZ <= -1.5) {
      flags.push({
        code: 'illness_pattern',
        severity: 'critical',
        message: 'Resting HR is up and HRV is down together — a common sign of illness or heavy fatigue.',
      });
    } else if (elevated) {
      flags.push({ code: 'rhr_elevated', severity: 'warning', message: `Resting HR is ${signed(delta!)} bpm above your baseline.` });
    }
  }

  // --- Body Battery at wake -----------------------------------------------
  {
    const value = today?.bodyBatteryWake ?? null;
    const b = baselines.bodyBattery;
    const z = b.sufficient ? zScore(b, value) : null;
    let score = z !== null ? scoreFromZ(z) : isNum(value) ? Math.round(value) : null;
    if (score !== null && isNum(value) && value < 25) score = Math.min(score, 35);
    components.push({
      key: 'bodyBattery',
      label: 'Body Battery',
      value,
      unit: 'score',
      baseline: b.mean === null ? null : Math.round(b.mean),
      z: z === null ? null : round(z, 2),
      score,
      weight: COMPONENT_WEIGHTS.bodyBattery,
      basis: z !== null ? 'baseline' : isNum(value) ? 'fallback' : 'missing',
      status: statusFromZ(z),
      note: !isNum(value)
        ? 'No Body Battery reading yet.'
        : `Body Battery ${value} at wake${b.sufficient && b.mean !== null ? ` (usually ${Math.round(b.mean)})` : ''}.`,
    });
    if (isNum(value) && value < 30) {
      flags.push({ code: 'body_battery_low', severity: 'caution', message: `Body Battery only ${value} at wake.` });
    }
  }

  // --- Stress (yesterday's full-day average; lower is better) -------------
  {
    const value = yesterday?.stressAvg ?? null;
    const b = baselines.stress;
    const z = b.sufficient ? zScore(b, value) : null;
    components.push({
      key: 'stress',
      label: 'Stress',
      value,
      unit: 'score',
      baseline: b.mean === null ? null : Math.round(b.mean),
      z: z === null ? null : round(z, 2),
      score: z !== null ? scoreFromZ(-z) : isNum(value) ? Math.round(clamp(110 - 1.6 * value, 0, 100)) : null,
      weight: COMPONENT_WEIGHTS.stress,
      basis: z !== null ? 'baseline' : isNum(value) ? 'fallback' : 'missing',
      status: statusFromZ(z === null ? null : -z),
      note: !isNum(value)
        ? 'No stress data for yesterday.'
        : `Yesterday's average stress ${value}${b.sufficient && b.mean !== null ? ` (usually ${Math.round(b.mean)})` : ''}.`,
    });
    if (z !== null && z >= 1.5) {
      flags.push({ code: 'high_stress', severity: 'caution', message: 'Yesterday was a high-stress day for you.' });
    }
  }

  // --- Combine ------------------------------------------------------------
  const scored = components.filter((c) => c.score !== null);
  const totalWeight = Object.values(COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0);
  const usedWeight = scored.reduce((s, c) => s + c.weight, 0);
  const confidence = round(
    scored.reduce((s, c) => s + c.weight * (c.basis === 'baseline' ? 1 : FALLBACK_QUALITY), 0) / totalWeight,
    2,
  );
  const score =
    usedWeight > 0 && confidence >= 0.25
      ? Math.round(scored.reduce((s, c) => s + c.weight * c.score!, 0) / usedWeight)
      : null;

  if (!isNum(today?.sleepDurationSec) && !isNum(today?.hrvLastNightMs)) {
    flags.push({
      code: 'missing_today_data',
      severity: 'caution',
      message: "Last night's sleep and HRV have not synced yet.",
    });
  }
  const keyBaselines: BaselineMetric[] = ['hrv', 'restingHr', 'sleepDuration'];
  if (keyBaselines.some((m) => !baselines[m].sufficient)) {
    const n = Math.min(...keyBaselines.map((m) => baselines[m].n));
    flags.push({
      code: 'calibrating',
      severity: 'info',
      message: `Building your personal baselines (${n} of 14 days). Recommendations stay conservative until then.`,
    });
  }

  return {
    readiness: { score, band: bandFor(score), confidence, components },
    baselines,
    flags,
  };
}

/** Exposed for documentation/tests: which metrics feed which component. */
export const COMPONENT_METRICS: Record<ComponentKey, BaselineMetric[]> = {
  hrv: ['hrv'],
  sleep: ['sleepDuration', 'sleepScore'],
  restingHr: ['restingHr'],
  bodyBattery: ['bodyBattery'],
  stress: ['stress'],
};
