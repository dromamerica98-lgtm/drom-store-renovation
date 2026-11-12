/**
 * Domain primitives shared by the engine, the API and the web app.
 *
 * Units are SI throughout: seconds, metres, metres/second, bpm, milliseconds.
 * `null` always means "not available" — never substitute 0.
 */

/** Local calendar date, `YYYY-MM-DD`, in the user's timezone. */
export type IsoDate = string;

/** ISO-8601 UTC timestamp, e.g. `2026-11-12T06:30:00Z`. */
export type IsoTimestamp = string;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const SPORTS = [
  'running',
  'trail_running',
  'treadmill_running',
  'cycling',
  'indoor_cycling',
  'swimming',
  'walking',
  'hiking',
  'strength',
  'cardio',
  'yoga',
  'other',
] as const;
export type Sport = (typeof SPORTS)[number];

/** Endurance family a sport belongs to, used for load and alternatives. */
export type SportFamily = 'run' | 'bike' | 'swim' | 'walk' | 'strength' | 'mobility' | 'other';

export function sportFamily(sport: Sport): SportFamily {
  switch (sport) {
    case 'running':
    case 'trail_running':
    case 'treadmill_running':
      return 'run';
    case 'cycling':
    case 'indoor_cycling':
      return 'bike';
    case 'swimming':
      return 'swim';
    case 'walking':
    case 'hiking':
      return 'walk';
    case 'strength':
    case 'cardio':
      return 'strength';
    case 'yoga':
      return 'mobility';
    default:
      return 'other';
  }
}

/** Garmin's own HRV status classification (stored, shown, not relied on). */
export const HRV_STATUSES = ['balanced', 'unbalanced', 'low', 'poor', 'none'] as const;
export type HrvStatus = (typeof HRV_STATUSES)[number];

export const PRIMARY_SPORTS = ['running', 'cycling', 'other'] as const;
export type PrimarySport = (typeof PRIMARY_SPORTS)[number];

export const GOAL_TYPES = [
  'general_fitness',
  'base_building',
  '5k',
  '10k',
  'half_marathon',
  'marathon',
  'weight_loss',
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export type DataSource = 'garmin' | 'mock' | 'manual';

export type ZoneNumber = 1 | 2 | 3 | 4 | 5;

/** A numeric range for one zone. For pace, values are sec/km (min = fastest). */
export interface Zone {
  zone: ZoneNumber;
  name: string;
  min: number;
  max: number;
}

/**
 * One calendar day of recovery metrics — the engine's main input.
 * Mirrors the `v_daily_metrics` view in D1.
 */
export interface DailyMetrics {
  date: IsoDate;
  restingHr: number | null;
  steps: number | null;
  sleepDurationSec: number | null;
  sleepScore: number | null;
  hrvLastNightMs: number | null;
  hrvWeeklyAvgMs: number | null;
  hrvStatus: HrvStatus | null;
  /** Body Battery when the user woke up — the most readiness-relevant value. */
  bodyBatteryWake: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  stressAvg: number | null;
}

/** Seconds spent in HR zones 1–5. */
export type ZoneTimes = [number, number, number, number, number];

/** The activity fields the engine needs. */
export interface ActivitySummary {
  id: number;
  localDate: IsoDate;
  startAt: IsoTimestamp;
  sport: Sport;
  name: string | null;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
  /** Null when the time-in-zone breakdown is unavailable. */
  timeInZonesSec: ZoneTimes | null;
  /** Garmin's EPOC-based training load, if provided. */
  garminLoad: number | null;
  aerobicTe: number | null;
  anaerobicTe: number | null;
  rpe: number | null;
}

/** Training preferences and physiology from the Settings screen. */
export interface AthleteSettings {
  timezone: string;
  units: 'metric' | 'imperial';
  primarySport: PrimarySport;
  goalType: GoalType;
  goalEventDate: IsoDate | null;
  goalNotes: string | null;
  availableDays: Weekday[];
  longSessionDay: Weekday | null;
  preferredDurationMin: number;
  maxDurationMin: number;
  qualitySessionsPerWeek: number;
  maxHr: number | null;
  restingHrOverride: number | null;
  lthr: number | null;
  thresholdPaceSecPerKm: number | null;
  birthYear: number | null;
  sex: 'female' | 'male' | 'unspecified' | null;
  hrZones: Zone[];
  paceZones: Zone[];
}
