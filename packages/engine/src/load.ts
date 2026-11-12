/**
 * Training load model.
 *
 * Per-activity load is a TRIMP computed the same way for every activity so
 * that numbers are comparable over time:
 *   1. Edwards TRIMP from time in HR zones:  Σ minutes_in_zone × zone_number
 *   2. Banister TRIMP from average HR when zone times are missing
 *   3. Duration × a conservative per-sport factor when there is no HR at all
 * (Garmin's own load is stored and shown, but not mixed into this model.)
 *
 * Daily loads feed exponentially weighted averages:
 *   ATL (acute, 7-day), CTL (chronic, 42-day), TSB = CTL − ATL,
 *   ACWR = ATL / CTL (acute:chronic workload ratio).
 * All values describe the state ENTERING the assessed day (up to yesterday).
 */
import { addDays, daysBetween } from './dates';
import type { IsoDate } from './domain';
import { sportFamily, type ActivitySummary } from './domain';
import { clamp, isNum, round } from './stats';

export type IntensityClass = 'easy' | 'moderate' | 'hard' | 'long';
export type QualityType = 'tempo' | 'threshold' | 'vo2max';
export type DayClass = 'rest' | IntensityClass;

export const ATL_DAYS = 7;
export const CTL_DAYS = 42;
/** Minimum days of history before ACWR/CTL are trusted. */
export const MIN_LOAD_HISTORY_DAYS = 21;

/** Load per minute when no HR data exists, by sport family. */
const FALLBACK_LOAD_PER_MIN: Record<ReturnType<typeof sportFamily>, number> = {
  run: 2,
  bike: 1.8,
  swim: 1.8,
  walk: 1,
  strength: 1.5,
  mobility: 0.8,
  other: 1.5,
};

export interface PhysiologyRefs {
  maxHr: number | null;
  restingHr: number | null;
}

export function activityLoad(a: ActivitySummary, refs: PhysiologyRefs): number {
  const minutes = a.durationSec / 60;
  if (a.timeInZonesSec) {
    return round(a.timeInZonesSec.reduce((sum, sec, i) => sum + (sec / 60) * (i + 1), 0), 1);
  }
  if (isNum(a.avgHr) && isNum(refs.maxHr) && isNum(refs.restingHr) && refs.maxHr > refs.restingHr) {
    const hrr = clamp((a.avgHr - refs.restingHr) / (refs.maxHr - refs.restingHr), 0, 1);
    // Scaled ×1.3 so Banister values sit on the same scale as Edwards TRIMP.
    return round(minutes * hrr * 0.64 * Math.exp(1.92 * hrr) * 1.3, 1);
  }
  return round(minutes * FALLBACK_LOAD_PER_MIN[sportFamily(a.sport)], 1);
}

/** Classifies one activity's intensity from zones, training effect or duration. */
export function classifyActivity(a: ActivitySummary): IntensityClass {
  const family = sportFamily(a.sport);
  if (family === 'strength' || family === 'mobility' || family === 'walk') return 'easy';
  const minutes = a.durationSec / 60;
  if (a.timeInZonesSec) {
    const [, , z3, z4, z5] = a.timeInZonesSec.map((s) => s / 60) as [number, number, number, number, number];
    if (z4 + z5 >= 8 || z3 + z4 + z5 >= 20) return 'hard';
    if (minutes >= 85) return 'long';
    if (z3 >= 10) return 'moderate';
    return 'easy';
  }
  if ((a.anaerobicTe ?? 0) >= 2 || (a.aerobicTe ?? 0) >= 3.8) return 'hard';
  if (minutes >= 85) return 'long';
  if ((a.aerobicTe ?? 0) >= 3) return 'moderate';
  return 'easy';
}

/** Which quality stimulus a hard activity was, for workout rotation. */
export function qualityTypeOf(a: ActivitySummary): QualityType | null {
  if (classifyActivity(a) !== 'hard' || !a.timeInZonesSec) return null;
  const [, , z3, z4, z5] = a.timeInZonesSec;
  if (z5 >= 4 * 60 && z5 >= z4 * 0.3) return 'vo2max';
  if (z4 >= z3) return 'threshold';
  return 'tempo';
}

const CLASS_RANK: Record<DayClass, number> = { rest: 0, easy: 1, moderate: 2, long: 3, hard: 4 };

export interface ActivityView {
  id: number;
  date: IsoDate;
  name: string | null;
  sport: ActivitySummary['sport'];
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  load: number;
  intensityClass: IntensityClass;
}

export interface VolumeWindow {
  from: IsoDate;
  to: IsoDate;
  sessions: number;
  durationSec: number;
  distanceM: number;
  load: number;
}

export interface LoadSummary {
  /** Days of activity/metrics history available before the assessed date. */
  historyDays: number;
  sufficientHistory: boolean;
  atl: number;
  ctl: number;
  tsb: number;
  /** Null when chronic load is too small or history too short to be meaningful. */
  acwr: number | null;
  /** Daily loads for the last 42 days ending yesterday, oldest first. */
  dailyLoads: Array<{ date: IsoDate; load: number }>;
  yesterday: { date: IsoDate; dayClass: DayClass; load: number; activities: ActivityView[] };
  last7: VolumeWindow;
  previous7: VolumeWindow;
  /** Average weekly volume over the 28 days ending yesterday. */
  avgWeek28: { sessions: number; durationSec: number; distanceM: number; load: number };
  /** Share of time in Z1–2 / Z3 / Z4–5 over the last 28 days (null if no zone data). */
  intensityDistribution28: { low: number; moderate: number; high: number } | null;
  hardDaysLast7: number;
  /**
   * Hard days in the 6 days before the assessed date. A quality session today
   * would make the rolling 7-day count this + 1, so quotas compare against it.
   */
  hardDaysPrev6: number;
  consecutiveHardDays: number;
  daysSinceHard: number | null;
  daysSinceRest: number;
  daysSinceLong: number | null;
  lastQualityType: QualityType | null;
  longestSessionSec28: number;
}

export function computeLoad(
  date: IsoDate,
  activities: readonly ActivitySummary[],
  refs: PhysiologyRefs,
  firstDataDate: IsoDate | null,
): LoadSummary {
  const yesterday = addDays(date, -1);
  const past = activities.filter((a) => a.localDate < date).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const views: ActivityView[] = past.map((a) => ({
    id: a.id,
    date: a.localDate,
    name: a.name,
    sport: a.sport,
    durationSec: a.durationSec,
    distanceM: a.distanceM,
    avgHr: a.avgHr,
    load: activityLoad(a, refs),
    intensityClass: classifyActivity(a),
  }));

  const byDate = new Map<IsoDate, ActivityView[]>();
  for (const v of views) byDate.set(v.date, [...(byDate.get(v.date) ?? []), v]);
  const dayLoad = (d: IsoDate) => (byDate.get(d) ?? []).reduce((s, v) => s + v.load, 0);
  const dayClass = (d: IsoDate): DayClass => {
    const acts = (byDate.get(d) ?? []).filter((v) => !(sportFamily(v.sport) === 'walk' && v.durationSec < 1800));
    return acts.reduce<DayClass>((best, v) => (CLASS_RANK[v.intensityClass] > CLASS_RANK[best] ? v.intensityClass : best), 'rest');
  };

  const historyStart = firstDataDate && firstDataDate < date ? firstDataDate : (views[0]?.date ?? date);
  const historyDays = Math.max(0, daysBetween(historyStart, date));

  // EWMA from the start of history (max one year) up to yesterday.
  const ewmaStart = historyDays > 365 ? addDays(date, -365) : historyStart;
  const seedDays = Math.min(historyDays, 14);
  let seed = 0;
  for (let i = 0; i < seedDays; i++) seed += dayLoad(addDays(ewmaStart, i));
  let atl = seedDays ? seed / seedDays : 0;
  let ctl = atl;
  for (let d = ewmaStart; d <= yesterday; d = addDays(d, 1)) {
    const l = dayLoad(d);
    atl += (l - atl) / ATL_DAYS;
    ctl += (l - ctl) / CTL_DAYS;
  }

  const dailyLoads: LoadSummary['dailyLoads'] = [];
  for (let i = CTL_DAYS; i >= 1; i--) {
    const d = addDays(date, -i);
    dailyLoads.push({ date: d, load: round(dayLoad(d), 1) });
  }

  const windowStats = (from: IsoDate, to: IsoDate): VolumeWindow => {
    const inWindow = views.filter((v) => v.date >= from && v.date <= to);
    return {
      from,
      to,
      sessions: inWindow.length,
      durationSec: inWindow.reduce((s, v) => s + v.durationSec, 0),
      distanceM: Math.round(inWindow.reduce((s, v) => s + (v.distanceM ?? 0), 0)),
      load: round(inWindow.reduce((s, v) => s + v.load, 0), 1),
    };
  };
  const last28 = windowStats(addDays(date, -28), yesterday);

  let zoneTotals = [0, 0, 0, 0, 0];
  for (const a of past) {
    if (a.localDate >= addDays(date, -28) && a.timeInZonesSec) {
      zoneTotals = zoneTotals.map((t, i) => t + a.timeInZonesSec![i]!);
    }
  }
  const zoneSum = zoneTotals.reduce((a, b) => a + b, 0);

  // Streaks and recency, walking back from yesterday.
  let consecutiveHardDays = 0;
  for (let d = yesterday; ['hard', 'long'].includes(dayClass(d)); d = addDays(d, -1)) consecutiveHardDays++;
  let daysSinceRest = 0;
  for (let d = yesterday; dayClass(d) !== 'rest' && daysSinceRest < 30; d = addDays(d, -1)) daysSinceRest++;
  const lastOf = (pred: (v: ActivityView) => boolean) => {
    const v = [...views].reverse().find(pred);
    return v ? daysBetween(v.date, date) : null;
  };
  const lastQuality = [...past].reverse().find((a) => qualityTypeOf(a) !== null);

  let hardDaysPrev6 = 0;
  for (let i = 1; i <= 6; i++) if (dayClass(addDays(date, -i)) === 'hard') hardDaysPrev6++;
  const hardDaysLast7 = hardDaysPrev6 + (dayClass(addDays(date, -7)) === 'hard' ? 1 : 0);

  const acwrMeaningful = historyDays >= MIN_LOAD_HISTORY_DAYS && ctl >= 5;

  return {
    historyDays,
    sufficientHistory: historyDays >= MIN_LOAD_HISTORY_DAYS,
    atl: round(atl, 1),
    ctl: round(ctl, 1),
    tsb: round(ctl - atl, 1),
    acwr: acwrMeaningful ? round(atl / ctl, 2) : null,
    dailyLoads,
    yesterday: {
      date: yesterday,
      dayClass: dayClass(yesterday),
      load: round(dayLoad(yesterday), 1),
      activities: byDate.get(yesterday) ?? [],
    },
    last7: windowStats(addDays(date, -7), yesterday),
    previous7: windowStats(addDays(date, -14), addDays(date, -8)),
    avgWeek28: {
      sessions: round(last28.sessions / 4, 1),
      durationSec: Math.round(last28.durationSec / 4),
      distanceM: Math.round(last28.distanceM / 4),
      load: round(last28.load / 4, 1),
    },
    intensityDistribution28:
      zoneSum > 0
        ? {
            low: round((zoneTotals[0]! + zoneTotals[1]!) / zoneSum, 3),
            moderate: round(zoneTotals[2]! / zoneSum, 3),
            high: round((zoneTotals[3]! + zoneTotals[4]!) / zoneSum, 3),
          }
        : null,
    hardDaysLast7,
    hardDaysPrev6,
    consecutiveHardDays,
    daysSinceHard: lastOf((v) => v.intensityClass === 'hard'),
    daysSinceRest,
    daysSinceLong: lastOf((v) => v.intensityClass === 'long'),
    lastQualityType: lastQuality ? qualityTypeOf(lastQuality) : null,
    longestSessionSec28: Math.max(0, ...views.filter((v) => v.date >= addDays(date, -28)).map((v) => v.durationSec)),
  };
}
