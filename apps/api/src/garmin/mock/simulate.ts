/**
 * Synthetic athlete simulation for the mock Garmin provider.
 *
 * Simulates day by day from a fixed epoch so that the values for any given
 * date are stable across requests (re-syncing never rewrites mock history).
 * Physiology responds to training: hard days and accumulated strain lower the
 * next morning's HRV, sleep quality and Body Battery and raise resting HR.
 *
 * Scenarios override the last few days before `today` so the UI and engine can
 * be exercised in specific states (fatigued, ill, fresh, new user).
 */
import { addDays, daysBetween, weekday, type IsoDate, type Sport, type ZoneTimes } from '@coach/engine';
import type {
  ActivityRecord,
  BodyBatteryRecord,
  DailySummaryRecord,
  HrvRecord,
  SleepRecord,
  StressRecord,
} from '../../domain/records';
import { clamp, rng, round, type Rng } from './random';

export const MOCK_SCENARIOS = ['normal', 'well_rested', 'fatigued', 'illness', 'calibrating'] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === 'string' && (MOCK_SCENARIOS as readonly string[]).includes(value);
}

/** The simulated athlete. Zones are % of max HR 188. */
export const MOCK_ATHLETE = {
  maxHr: 188,
  restingHr: 48,
  hrvMs: 62,
  sleepNeedSec: 7.6 * 3600,
  /** Upper bpm bound of zones 1–5. */
  zoneUpper: [131, 150, 163, 174, 188] as const,
  zoneMid: [118, 141, 157, 169, 180] as const,
};

/** Simulation starts here; history before it does not exist. */
const EPOCH: IsoDate = '2025-06-01';
/** Days of history the `calibrating` scenario exposes. */
const CALIBRATING_DAYS = 6;

type SessionKind = 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'strength';

interface Session {
  kind: SessionKind;
  minutes: number;
}

const ZONE_SPLIT: Record<SessionKind, ZoneTimes> = {
  recovery: [0.85, 0.15, 0, 0, 0],
  easy: [0.15, 0.8, 0.05, 0, 0],
  long: [0.1, 0.8, 0.1, 0, 0],
  tempo: [0.25, 0.25, 0.4, 0.1, 0],
  intervals: [0.3, 0.25, 0.1, 0.25, 0.1],
  strength: [0.7, 0.3, 0, 0, 0],
};

const SPEED_MPS: Record<SessionKind, number> = {
  recovery: 2.6,
  easy: 2.9,
  long: 2.85,
  tempo: 3.35,
  intervals: 3.15,
  strength: 0,
};

const SESSION_NAME: Record<SessionKind, string> = {
  recovery: 'Recovery Run',
  easy: 'Easy Run',
  long: 'Long Run',
  tempo: 'Tempo Run',
  intervals: 'Intervals',
  strength: 'Strength',
};

/** Weekly template by ISO weekday (1 = Monday). */
function plannedSessions(day: IsoDate, r: Rng): Session[] {
  const jitter = (min: number) => Math.round(min * clamp(r.normal(1, 0.1), 0.75, 1.25));
  switch (weekday(day)) {
    case 1:
      return [];
    case 2:
      return [{ kind: 'intervals', minutes: jitter(55) }];
    case 3:
      return [{ kind: 'easy', minutes: jitter(45) }];
    case 4:
      return [{ kind: 'tempo', minutes: jitter(50) }];
    case 5:
      return r.chance(0.3) ? [{ kind: 'easy', minutes: jitter(30) }] : [];
    case 6:
      return [
        { kind: 'easy', minutes: jitter(40) },
        ...(r.chance(0.4) ? [{ kind: 'strength' as const, minutes: jitter(30) }] : []),
      ];
    default:
      return [{ kind: 'long', minutes: jitter(90) }];
  }
}

const isHard = (kind: SessionKind) => kind === 'tempo' || kind === 'intervals' || kind === 'long';

export interface SimulatedDay {
  date: IsoDate;
  summary: DailySummaryRecord;
  sleep: SleepRecord;
  hrv: HrvRecord;
  bodyBattery: BodyBatteryRecord;
  stress: StressRecord;
  activities: ActivityRecord[];
}

interface Morning {
  rhr: number;
  hrv: number;
  sleepSec: number;
  sleepScore: number;
  bbWake: number;
  stress: number;
}

/** Applies scenario overrides to the morning values of `date`. */
function scenarioMorning(scenario: MockScenario, offset: number, m: Morning): Morning {
  // offset: days before today (0 = today)
  if (scenario === 'well_rested' && offset === 0) {
    return { ...m, rhr: MOCK_ATHLETE.restingHr - 2, hrv: MOCK_ATHLETE.hrvMs * 1.12, sleepSec: 8.4 * 3600, sleepScore: 91, bbWake: 94, stress: 19 };
  }
  if (scenario === 'fatigued' && offset <= 1) {
    return { ...m, rhr: MOCK_ATHLETE.restingHr + 3, hrv: MOCK_ATHLETE.hrvMs * 0.88, sleepSec: 6.3 * 3600, sleepScore: 64, bbWake: 44, stress: m.stress + 6 };
  }
  if (scenario === 'illness' && offset === 0) {
    return { ...m, rhr: MOCK_ATHLETE.restingHr + 10, hrv: MOCK_ATHLETE.hrvMs * 0.62, sleepSec: 6.1 * 3600, sleepScore: 49, bbWake: 21, stress: 49 };
  }
  return m;
}

/** Applies scenario overrides to the sessions trained on `date`. */
function scenarioSessions(scenario: MockScenario, offset: number, planned: Session[]): Session[] {
  if (offset === 0) return []; // today's training has not happened yet
  if (scenario === 'well_rested' && offset <= 2) return [];
  if (scenario === 'fatigued' && offset <= 4) {
    const block: Session[] = [
      { kind: 'intervals', minutes: 70 },
      { kind: 'long', minutes: 115 },
      { kind: 'tempo', minutes: 65 },
      { kind: 'intervals', minutes: 60 },
    ];
    return [block[offset - 1]!];
  }
  return planned;
}

function buildActivity(date: IsoDate, index: number, s: Session, r: Rng): ActivityRecord {
  const durationSec = s.minutes * 60;
  const split = ZONE_SPLIT[s.kind];
  const zoneSec = split.map((f) => Math.round(f * durationSec)) as ZoneTimes;
  const avgHr = Math.round(split.reduce((sum, f, i) => sum + f * MOCK_ATHLETE.zoneMid[i]!, 0) + r.normal(0, 2));
  const isRun = s.kind !== 'strength';
  const speed = isRun ? round(SPEED_MPS[s.kind] * clamp(r.normal(1, 0.03), 0.9, 1.1), 3) : null;
  const zoneLoad = zoneSec.reduce((sum, sec, i) => sum + (sec / 60) * (i + 1), 0);
  const garminLoad = Math.round(zoneLoad * 0.55 * clamp(r.normal(1, 0.08), 0.8, 1.2));
  const startHour = s.kind === 'strength' ? 17 : 6 + (index % 2) * 11;
  const startLocal = `${date}T${String(startHour).padStart(2, '0')}:30:00`;
  const sport: Sport = isRun ? 'running' : 'strength';
  return {
    id: Number(date.replaceAll('-', '')) * 100 + index + 1,
    localDate: date,
    startAt: `${startLocal}Z`,
    startLocal,
    sport,
    garminTypeKey: isRun ? 'running' : 'strength_training',
    name: SESSION_NAME[s.kind],
    durationSec,
    movingDurationSec: isRun ? durationSec - Math.round(r.next() * 60) : null,
    distanceM: speed ? Math.round(speed * durationSec) : null,
    elevationGainM: isRun ? Math.round(clamp(r.normal(s.minutes * 0.8, 10), 0, 400)) : null,
    avgHr,
    maxHr: Math.min(MOCK_ATHLETE.maxHr, avgHr + Math.round(isHard(s.kind) ? 18 + r.next() * 6 : 10 + r.next() * 5)),
    avgSpeedMps: speed,
    maxSpeedMps: speed ? round(speed * (s.kind === 'intervals' ? 1.45 : 1.18), 3) : null,
    avgPowerW: null,
    normalizedPowerW: null,
    avgCadence: isRun ? Math.round(r.normal(170, 3)) : null,
    calories: Math.round(durationSec / 60 * (isRun ? 11 : 6)),
    aerobicTe: round(clamp(1.5 + garminLoad / 45, 0, 5), 1),
    anaerobicTe: round(s.kind === 'intervals' ? clamp(r.normal(2.1, 0.3), 0, 5) : s.kind === 'tempo' ? 0.8 : 0.2, 1),
    garminLoad,
    timeInZonesSec: zoneSec,
    rpe: null,
    hasDetails: false,
  };
}

/**
 * Simulates every day from EPOCH through `today` and returns them by date.
 * Dates before the visible history window (scenario `calibrating`) are omitted.
 */
export function simulate(today: IsoDate, scenario: MockScenario, seed: string): Map<IsoDate, SimulatedDay> {
  const out = new Map<IsoDate, SimulatedDay>();
  const visibleFrom = scenario === 'calibrating' ? addDays(today, -CALIBRATING_DAYS) : EPOCH;
  let acute = 45; // 7-day EWMA of daily load
  let chronic = 45; // 42-day EWMA of daily load
  let yesterdayLoad = 0;
  let yesterdayHard = false;
  const hrvWindow: number[] = [];

  for (let date = EPOCH; date <= today; date = addDays(date, 1)) {
    const r = rng(`${seed}|${date}`);
    const offset = daysBetween(date, today);
    const strain = Math.max(0, (acute - chronic) / Math.max(chronic, 20));
    const loadNorm = yesterdayLoad / 100;

    // --- Morning (recovery from yesterday) ---
    const weekendBonus = weekday(date) >= 6 ? 0.4 * 3600 : 0;
    const sleepSec0 = clamp(MOCK_ATHLETE.sleepNeedSec + weekendBonus + r.normal(0, 0.6 * 3600), 4.5 * 3600, 9.8 * 3600);
    const sleepDev = (sleepSec0 - MOCK_ATHLETE.sleepNeedSec) / 3600;
    const lnHrv =
      Math.log(MOCK_ATHLETE.hrvMs) + r.normal(0, 0.07) - (yesterdayHard ? 0.1 * loadNorm : 0) - 0.15 * strain + 0.03 * sleepDev;
    let morning: Morning = {
      hrv: Math.exp(lnHrv),
      rhr: MOCK_ATHLETE.restingHr + r.normal(0, 1.2) + (yesterdayHard ? 2 * loadNorm : 0) + 4 * strain,
      sleepSec: sleepSec0,
      sleepScore: clamp(80 + 9 * sleepDev + r.normal(0, 5) - 6 * strain, 30, 98),
      bbWake: 0,
      stress: clamp(27 + r.normal(0, 5) + 6 * strain, 5, 80),
    };
    morning.bbWake = clamp(78 + 6 * sleepDev + 0.3 * (morning.sleepScore - 80) - 8 * loadNorm - 10 * strain + r.normal(0, 5), 5, 100);
    morning = scenarioMorning(scenario, offset, morning);

    // --- Training ---
    const planned = plannedSessions(date, r).filter(() => !r.chance(0.08));
    const sessions = scenarioSessions(scenario, offset, planned);
    const activities = sessions.map((s, i) => buildActivity(date, i, s, r));
    const dayLoad = activities.reduce((sum, a) => sum + (a.garminLoad ?? 0), 0);

    // --- Garmin-style HRV weekly average and status ---
    const hrvMs = round(morning.hrv, 0);
    hrvWindow.push(hrvMs);
    if (hrvWindow.length > 21) hrvWindow.shift();
    const last7 = hrvWindow.slice(-7);
    const weeklyAvg = round(last7.reduce((a, b) => a + b, 0) / last7.length, 0);
    const baselineLow = Math.round(MOCK_ATHLETE.hrvMs * 0.88);
    const baselineHigh = Math.round(MOCK_ATHLETE.hrvMs * 1.1);
    const hrvStatus =
      hrvWindow.length < 7 ? 'none' : weeklyAvg < baselineLow * 0.9 ? 'low' : weeklyAvg < baselineLow || weeklyAvg > baselineHigh ? 'unbalanced' : 'balanced';

    // --- Day totals ---
    const runDistance = activities.reduce((sum, a) => sum + (a.distanceM ?? 0), 0);
    const steps = Math.round(clamp(r.normal(7200, 1500), 2000, 15000) + runDistance * 1.35);
    const bbDrain = clamp(45 + dayLoad * 0.35 + (morning.stress - 25) * 0.6 + r.normal(0, 6), 10, morning.bbWake);
    const sleepStartMs = Date.parse(`${date}T06:15:00Z`) - morning.sleepSec * 1000 - 20 * 60 * 1000;
    const deep = Math.round(morning.sleepSec * clamp(r.normal(0.19, 0.03), 0.08, 0.3));
    const rem = Math.round(morning.sleepSec * clamp(r.normal(0.22, 0.03), 0.1, 0.32));
    const awake = Math.round(clamp(r.normal(1100, 400), 120, 4000));
    const restingHr = Math.round(morning.rhr);

    if (date >= visibleFrom) {
      out.set(date, {
        date,
        summary: {
          date,
          steps,
          stepGoal: 8000,
          distanceM: Math.round(steps * 0.78),
          restingHr,
          minHr: restingHr - 4,
          maxHr: activities.length ? Math.max(...activities.map((a) => a.maxHr ?? 0)) : restingHr + 70,
          activeKcal: Math.round(steps * 0.04 + activities.reduce((s, a) => s + (a.calories ?? 0), 0)),
          totalKcal: Math.round(1750 + steps * 0.04 + activities.reduce((s, a) => s + (a.calories ?? 0), 0)),
          intensityMinModerate: Math.round(activities.reduce((s, a) => s + (a.timeInZonesSec ? a.timeInZonesSec[1] : 0), 0) / 60),
          intensityMinVigorous: Math.round(
            activities.reduce((s, a) => s + (a.timeInZonesSec ? a.timeInZonesSec[2] + a.timeInZonesSec[3] + a.timeInZonesSec[4] : 0), 0) / 60,
          ),
        },
        sleep: {
          date,
          sleepStart: new Date(sleepStartMs).toISOString().replace('.000Z', 'Z'),
          sleepEnd: `${date}T06:15:00Z`,
          durationSec: Math.round(morning.sleepSec),
          deepSec: deep,
          remSec: rem,
          lightSec: Math.round(morning.sleepSec) - deep - rem,
          awakeSec: awake,
          score: Math.round(morning.sleepScore),
          scoreQualifier: morning.sleepScore >= 90 ? 'EXCELLENT' : morning.sleepScore >= 80 ? 'GOOD' : morning.sleepScore >= 60 ? 'FAIR' : 'POOR',
          avgRespiration: round(clamp(r.normal(14, 0.6), 10, 20), 1),
          avgSpo2: Math.round(clamp(r.normal(95, 1), 88, 100)),
          avgSleepStress: Math.round(clamp(r.normal(16, 4) + 8 * strain, 0, 60)),
        },
        hrv: {
          date,
          lastNightAvgMs: hrvMs,
          lastNightHighMs: Math.round(hrvMs * 1.35),
          weeklyAvgMs: weeklyAvg,
          baselineLowMs: baselineLow,
          baselineHighMs: baselineHigh,
          status: hrvStatus,
        },
        bodyBattery: {
          date,
          charged: Math.round(clamp(morning.bbWake - 15, 0, 100)),
          drained: Math.round(bbDrain),
          highest: Math.round(morning.bbWake),
          lowest: Math.round(clamp(morning.bbWake - bbDrain, 0, 100)),
          atWake: Math.round(morning.bbWake),
          endOfDay: offset === 0 ? null : Math.round(clamp(morning.bbWake - bbDrain, 0, 100)),
        },
        stress: {
          date,
          avgStress: Math.round(morning.stress),
          maxStress: Math.round(clamp(morning.stress + 45 + r.normal(0, 8), 0, 100)),
          restSec: Math.round(clamp(r.normal(9, 1.5), 4, 14) * 3600),
          lowSec: Math.round(clamp(r.normal(4, 1), 1, 8) * 3600),
          mediumSec: Math.round(clamp(r.normal(1.5, 0.5) + strain, 0, 6) * 3600),
          highSec: Math.round(clamp(r.normal(0.4, 0.2) + strain * 0.5, 0, 4) * 3600),
        },
        activities,
      });
    }

    acute += (dayLoad - acute) / 7;
    chronic += (dayLoad - chronic) / 42;
    yesterdayLoad = dayLoad;
    yesterdayHard = sessions.some((s) => isHard(s.kind));
  }
  return out;
}
