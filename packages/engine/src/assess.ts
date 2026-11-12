/**
 * Engine entry points.
 *
 *   assessDay(input)              → readiness, baselines, load, flags, recommendation
 *   applyModification(...)        → a guarded, deterministic change to the current workout
 *
 * Inputs are plain data; outputs are plain data. No clock, no I/O, no randomness.
 */
import { addDays } from './dates';
import type { IsoDate } from './domain';
import type { ActivitySummary, AthleteSettings, DailyMetrics } from './domain';
import { decide, loadFlags, type Decision, type Reason, type RuleId } from './decision';
import { computeLoad, type LoadSummary } from './load';
import { harderGuard, modifyWorkout, type HarderGuard, type ModificationRequest, type ModificationResult } from './modify';
import { computeReadiness, type Flag, type Readiness } from './readiness';
import type { Baseline, BaselineMetric } from './baselines';
import { fnv1a } from './stats';
import { ENGINE_VERSION } from './version';
import { buildWorkout, type Workout } from './workouts';
import { resolveZones, type ResolvedZones } from './zones';

export interface EngineInput {
  /** The day being planned (user's local date). */
  date: IsoDate;
  /** Daily metrics; at least the last ~60 days for good baselines. */
  metrics: readonly DailyMetrics[];
  /** Activities; only those before `date` are used. */
  activities: readonly ActivitySummary[];
  settings: AthleteSettings;
}

export interface Recommendation {
  ruleId: RuleId;
  workout: Workout;
  /** Decisive reason first. */
  reasons: Reason[];
  /** One deterministic paragraph; the AI layer may rephrase it. */
  summary: string;
  /** Whether "Make it harder" can succeed today, and why not. */
  harder: HarderGuard;
}

export interface DailyAssessment {
  date: IsoDate;
  engineVersion: string;
  inputsHash: string;
  readiness: Readiness;
  baselines: Record<BaselineMetric, Baseline>;
  load: LoadSummary;
  flags: Flag[];
  zones: ResolvedZones;
  recommendation: Recommendation;
}

/** Days of history the engine reads (baselines need 42 + today; load 42 + seed). */
export const ENGINE_LOOKBACK_DAYS = 120;

/** Fingerprint of everything that can influence the assessment. */
export function inputsHash(input: EngineInput): string {
  const from = addDays(input.date, -ENGINE_LOOKBACK_DAYS);
  const metrics = input.metrics
    .filter((m) => m.date >= from && m.date <= input.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => [m.date, m.restingHr, m.sleepDurationSec, m.sleepScore, m.hrvLastNightMs, m.hrvStatus, m.bodyBatteryWake, m.stressAvg]);
  const activities = input.activities
    .filter((a) => a.localDate >= from && a.localDate < input.date)
    .sort((a, b) => a.id - b.id)
    .map((a) => [a.id, a.localDate, a.sport, a.durationSec, a.distanceM, a.avgHr, a.timeInZonesSec, a.aerobicTe, a.anaerobicTe]);
  return fnv1a(JSON.stringify([ENGINE_VERSION, input.date, metrics, activities, input.settings]));
}

function summarize(readiness: Readiness, decision: Decision, workout: Workout): string {
  const lead =
    readiness.score === null
      ? 'Not enough recovery data yet to score readiness.'
      : `Readiness ${readiness.score}/100 (${readiness.band.replace('_', ' ')}).`;
  return `${lead} ${decision.reasons[0]!.message} Today: ${workout.summary}`;
}

export function assessDay(rawInput: EngineInput): DailyAssessment {
  // Canonical order, so the result never depends on how callers sorted their data
  // (floating-point sums are order-sensitive).
  const input: EngineInput = {
    ...rawInput,
    metrics: [...rawInput.metrics].sort((a, b) => a.date.localeCompare(b.date)),
    activities: [...rawInput.activities].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id - b.id),
  };
  const { date, settings } = input;
  const { readiness, baselines, flags: recoveryFlags } = computeReadiness(date, input.metrics);

  const rhrBaseline = baselines.restingHr.mean;
  const firstDataDate =
    [...input.metrics.map((m) => m.date), ...input.activities.map((a) => a.localDate)].sort()[0] ?? null;
  const load = computeLoad(
    date,
    input.activities,
    { maxHr: settings.maxHr, restingHr: settings.restingHrOverride ?? (rhrBaseline === null ? null : Math.round(rhrBaseline)) },
    firstDataDate,
  );
  const flags = [...recoveryFlags, ...loadFlags(load)];
  const zones = resolveZones(settings, Number(date.slice(0, 4)));
  const decision = decide({ date, readiness, flags, load, settings });
  const workout = buildWorkout(decision.type, decision.durationMin, { zones, modality: decision.modality });

  return {
    date,
    engineVersion: ENGINE_VERSION,
    inputsHash: inputsHash(input),
    readiness,
    baselines,
    load,
    flags,
    zones,
    recommendation: {
      ruleId: decision.ruleId,
      workout,
      reasons: decision.reasons,
      summary: summarize(readiness, decision, workout),
      harder: harderGuard({ readiness, flags, load, settings }),
    },
  };
}

/** Applies a user-requested modification to the current workout of an assessment. */
export function applyModification(
  assessment: DailyAssessment,
  current: Workout,
  request: ModificationRequest,
  settings: AthleteSettings,
): ModificationResult {
  return modifyWorkout(current, request, {
    readiness: assessment.readiness,
    flags: assessment.flags,
    load: assessment.load,
    settings,
    zones: assessment.zones,
  });
}
