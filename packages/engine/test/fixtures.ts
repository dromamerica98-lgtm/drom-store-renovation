import { addDays } from '../src/dates';
import type { ActivitySummary, AthleteSettings, DailyMetrics, ZoneTimes } from '../src/domain';

export const TODAY = '2026-11-12'; // a Thursday

export function settings(overrides: Partial<AthleteSettings> = {}): AthleteSettings {
  return {
    timezone: 'UTC',
    units: 'metric',
    primarySport: 'running',
    goalType: 'general_fitness',
    goalEventDate: null,
    goalNotes: null,
    availableDays: [1, 2, 3, 4, 5, 6, 7],
    longSessionDay: null,
    preferredDurationMin: 45,
    maxDurationMin: 120,
    qualitySessionsPerWeek: 2,
    maxHr: 188,
    restingHrOverride: null,
    lthr: null,
    thresholdPaceSecPerKm: 270,
    birthYear: null,
    sex: null,
    hrZones: [],
    paceZones: [],
    ...overrides,
  };
}

/** Small deterministic wobble so baselines have a realistic, non-zero spread. */
const WOBBLE = [-1, 0.6, 0, 1, -0.6, 0.3, -0.3];

/** A normal day for this athlete: HRV ~60 ms, RHR ~48, 7.5 h sleep, BB ~75. */
export function day(date: string, overrides: Partial<DailyMetrics> = {}, i = 0): DailyMetrics {
  const w = WOBBLE[i % 7]!;
  return {
    date,
    restingHr: Math.round(48 + w),
    steps: 9000,
    sleepDurationSec: Math.round(7.5 * 3600 + w * 1200),
    sleepScore: Math.round(80 + w * 4),
    hrvLastNightMs: Math.round(60 + w * 4),
    hrvWeeklyAvgMs: 60,
    hrvStatus: 'balanced',
    bodyBatteryWake: Math.round(75 + w * 6),
    bodyBatteryHigh: Math.round(75 + w * 6),
    bodyBatteryLow: 25,
    stressAvg: Math.round(27 + w * 3),
    ...overrides,
  };
}

/** `days` days of normal history ending the day before `today`, plus `today` itself. */
export function history(days = 60, todayOverrides: Partial<DailyMetrics> = {}, today = TODAY): DailyMetrics[] {
  const out: DailyMetrics[] = [];
  for (let i = days; i >= 1; i--) out.push(day(addDays(today, -i), {}, i));
  out.push(day(today, { ...todayOverrides }, 2)); // i = 2 → zero wobble
  return out;
}

const SPLITS: Record<'recovery' | 'easy' | 'long' | 'tempo' | 'threshold' | 'vo2max', number[]> = {
  recovery: [0.9, 0.1, 0, 0, 0],
  easy: [0.15, 0.8, 0.05, 0, 0],
  long: [0.1, 0.8, 0.1, 0, 0],
  tempo: [0.3, 0.2, 0.45, 0.05, 0],
  threshold: [0.35, 0.15, 0.1, 0.4, 0],
  vo2max: [0.4, 0.2, 0.05, 0.15, 0.2],
};

const KINDS = Object.keys(SPLITS);
export function run(
  date: string,
  kind: keyof typeof SPLITS,
  minutes = kind === 'long' ? 95 : kind === 'recovery' ? 25 : 45,
  overrides: Partial<ActivitySummary> = {},
): ActivitySummary {
  const sec = minutes * 60;
  return {
    // Deterministic id: yyyymmdd + kind, so identical inputs are identical.
    id: Number(date.replaceAll('-', '')) * 100 + KINDS.indexOf(kind) * 10 + (minutes % 10),
    localDate: date,
    startAt: `${date}T06:30:00Z`,
    sport: 'running',
    name: `${kind[0]!.toUpperCase()}${kind.slice(1)} run`,
    durationSec: sec,
    distanceM: Math.round(sec * 3),
    avgHr: 145,
    maxHr: 170,
    avgSpeedMps: 3,
    timeInZonesSec: SPLITS[kind].map((f) => Math.round(f * sec)) as ZoneTimes,
    garminLoad: null,
    aerobicTe: 3,
    anaerobicTe: kind === 'vo2max' ? 2.2 : 0.3,
    rpe: null,
    ...overrides,
  };
}

/**
 * A steady weekly pattern for `weeks` weeks before `today`:
 * Mon rest, Tue threshold, Wed easy, Thu tempo, Fri rest, Sat easy, Sun long.
 */
export function trainingWeeks(weeks = 8, today = TODAY): ActivitySummary[] {
  const out: ActivitySummary[] = [];
  for (let i = weeks * 7; i >= 1; i--) {
    const date = addDays(today, -i);
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    if (wd === 2) out.push(run(date, 'threshold', 50));
    if (wd === 3) out.push(run(date, 'easy', 45));
    if (wd === 4) out.push(run(date, 'tempo', 50));
    if (wd === 6) out.push(run(date, 'easy', 40));
    if (wd === 0) out.push(run(date, 'long', 90));
  }
  return out;
}
