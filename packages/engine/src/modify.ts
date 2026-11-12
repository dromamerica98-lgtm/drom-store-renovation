/**
 * Deterministic workout modifications with guardrails.
 *
 * The user (or later the AI coach on the user's behalf) can ask for:
 * shorter, easier, harder, "I only have X minutes", rest day, alternative.
 * Each request is a transform of the CURRENT workout, so they chain
 * (e.g. easier → then shorter). "Harder" is checked against the same
 * recovery and load signals the decision used; if they say no, the request
 * is refused with the reasons — the AI layer cannot override this.
 */
import { has, type Reason } from './decision';
import type { AthleteSettings } from './domain';
import { fmtDuration } from './format';
import type { LoadSummary } from './load';
import type { Flag, Readiness } from './readiness';
import { clamp, round5 } from './stats';
import {
  buildWorkout,
  isQuality,
  QUALITY_MIN_MINUTES,
  type Workout,
  type WorkoutModality,
  type WorkoutType,
} from './workouts';
import type { ResolvedZones } from './zones';

export const MODIFICATION_KINDS = ['shorter', 'easier', 'harder', 'time_limit', 'rest', 'alternative'] as const;
export type ModificationKind = (typeof MODIFICATION_KINDS)[number];

export interface ModificationRequest {
  kind: ModificationKind;
  /** Required for time_limit. */
  minutes?: number;
}

export interface ModificationResult {
  applied: boolean;
  workout: Workout;
  reasons: Reason[];
}

export interface GuardContext {
  readiness: Readiness;
  flags: Flag[];
  load: LoadSummary;
  settings: AthleteSettings;
}

export interface HarderGuard {
  /** May the workout be stepped up to a quality session? */
  qualityAllowed: boolean;
  /** May an easy/rest day be stepped up to (more) easy aerobic work? */
  easyAllowed: boolean;
  blockedBy: Reason[];
}

/** Recovery and load signals that forbid making the day harder. */
export function harderGuard(ctx: GuardContext): HarderGuard {
  const { readiness, flags, load, settings } = ctx;
  const block: Reason[] = [];
  const add = (code: string, message: string) => block.push({ code, tone: 'caution', message });
  const score = readiness.score;

  if (has(flags, 'illness_pattern')) add('ILLNESS_PATTERN', 'Resting HR up and HRV down together — possible illness.');
  if (score === null) add('READINESS_UNKNOWN', 'Not enough data to judge readiness today.');
  else if (score < 65) add('READINESS_TOO_LOW', `Readiness ${score} is below the 65 needed for a hard session.`);
  if (readiness.confidence < 0.5) add('LOW_CONFIDENCE', 'Personal baselines are still calibrating.');
  if (has(flags, 'load_spike')) add('LOAD_SPIKE', `Recent load is already ${load.acwr}× your usual.`);
  if (has(flags, 'load_high')) add('LOAD_HIGH', `Recent load is on the high side (${load.acwr}×).`);
  if (has(flags, 'hrv_suppressed')) add('HRV_SUPPRESSED', 'HRV is well below your normal range.');
  if (has(flags, 'hrv_trend_low')) add('HRV_TREND_LOW', 'HRV has been trending below baseline.');
  if (has(flags, 'very_short_sleep') || has(flags, 'short_sleep')) add('SLEEP_SHORT', 'Last night was short on sleep.');
  if (load.yesterday.dayClass === 'hard') add('YESTERDAY_HARD', 'Yesterday was already a hard session.');
  if (has(flags, 'consecutive_hard_days')) add('CONSECUTIVE_HARD_DAYS', `${load.consecutiveHardDays} hard days in a row already.`);
  if (load.hardDaysPrev6 >= settings.qualitySessionsPerWeek) {
    add('QUALITY_QUOTA_MET', `You've done ${load.hardDaysPrev6} hard sessions in the past 6 days (weekly target ${settings.qualitySessionsPerWeek}).`);
  }

  const easyAllowed = !has(flags, 'illness_pattern') && (score === null || score >= 35);
  return { qualityAllowed: block.length === 0, easyAllowed, blockedBy: block };
}

const EASIER: Partial<Record<WorkoutType, WorkoutType>> = {
  vo2max: 'threshold',
  threshold: 'tempo',
  tempo: 'easy',
  long: 'easy',
  easy: 'recovery',
  recovery: 'rest',
  mobility: 'rest',
};

const HARDER: Partial<Record<WorkoutType, WorkoutType>> = {
  rest: 'recovery',
  mobility: 'recovery',
  recovery: 'easy',
  easy: 'tempo',
  tempo: 'threshold',
  threshold: 'vo2max',
};

const MODALITY_CYCLE: WorkoutModality[] = ['run', 'bike', 'elliptical'];

const minutesOf = (w: Workout) => Math.round(w.durationSec / 60);

/** Minimum sensible length per workout type. */
function minMinutes(type: WorkoutType): number {
  if (isQuality(type)) return QUALITY_MIN_MINUTES;
  if (type === 'long') return 60;
  if (type === 'easy') return 20;
  return 10;
}

export interface ModifyContext extends GuardContext {
  zones: ResolvedZones;
}

export function modifyWorkout(current: Workout, request: ModificationRequest, ctx: ModifyContext): ModificationResult {
  const modality: WorkoutModality = current.modality === 'none' || current.modality === 'mobility' ? (ctx.settings.primarySport === 'cycling' ? 'bike' : 'run') : current.modality;
  const build = (type: WorkoutType, minutes: number, m: WorkoutModality = modality) =>
    buildWorkout(type, minutes, { zones: ctx.zones, modality: m });
  const T = minutesOf(current);
  const refuse = (code: string, message: string, extra: Reason[] = []): ModificationResult => ({
    applied: false,
    workout: current,
    reasons: [{ code, tone: 'caution', message }, ...extra],
  });
  const ok = (workout: Workout, code: string, message: string): ModificationResult => ({
    applied: true,
    workout,
    reasons: [{ code, tone: 'neutral', message }],
  });

  switch (request.kind) {
    case 'shorter': {
      if (current.type === 'rest') return refuse('MOD_NOTHING_TO_SHORTEN', 'It is already a rest day.');
      let type = current.type;
      let minutes = round5(T * 0.7);
      if (minutes < minMinutes(type)) {
        if (T > minMinutes(type)) minutes = minMinutes(type);
        else if (type === 'long') type = 'easy';
        else return refuse('MOD_ALREADY_MINIMAL', `${fmtDuration(T * 60)} is already the shortest useful version of this session. Try "Easier" instead.`);
      }
      if (type === 'long' && minutes < 60) type = 'easy';
      const w = build(type, minutes);
      return ok(w, 'MOD_SHORTER', `Shortened from ${fmtDuration(T * 60)} to ${fmtDuration(w.durationSec)}; warm-up and cool-down kept, main set reduced.`);
    }

    case 'easier': {
      const next = EASIER[current.type];
      if (!next) return refuse('MOD_ALREADY_EASIEST', 'It is already a rest day — nothing easier than that.');
      const minutes = next === 'easy' && current.type === 'long' ? Math.max(20, round5(T * 0.7)) : next === 'recovery' ? Math.min(T, 30) : T;
      const w = build(next, minutes);
      return ok(w, 'MOD_EASIER', `Stepped down from ${current.title.toLowerCase()} to ${w.title.toLowerCase()}.`);
    }

    case 'harder': {
      const guard = harderGuard(ctx);
      if (current.type === 'long') {
        if (!guard.easyAllowed || has(ctx.flags, 'load_spike')) {
          return refuse('MOD_HARDER_REFUSED', 'Not today — recovery signals say to keep the long session as planned.', guard.blockedBy);
        }
        const minutes = Math.min(ctx.settings.maxDurationMin, T + 15);
        if (minutes <= T) return refuse('MOD_AT_MAX_DURATION', `Already at your maximum duration (${ctx.settings.maxDurationMin} min, Settings).`);
        return ok(build('long', minutes), 'MOD_HARDER', `Extended the long session by ${minutes - T} min.`);
      }
      const next = HARDER[current.type];
      if (!next) return refuse('MOD_ALREADY_HARDEST', 'This is already the hardest session type.');
      if (isQuality(next)) {
        if (!guard.qualityAllowed) {
          return refuse('MOD_HARDER_REFUSED', "Not today — making it harder isn't supported by your recovery and load data:", guard.blockedBy);
        }
        if (next === 'vo2max' && (ctx.readiness.score ?? 0) < 75) {
          return refuse('MOD_HARDER_REFUSED', 'VO₂max work needs readiness of 75 or more.', guard.blockedBy);
        }
      } else if (!guard.easyAllowed) {
        return refuse('MOD_HARDER_REFUSED', 'Not today — your body is asking for rest.', guard.blockedBy);
      }
      const base = next === 'recovery' ? 25 : next === 'easy' ? ctx.settings.preferredDurationMin : T;
      const minutes = clamp(Math.max(base, minMinutes(next)), minMinutes(next), Math.max(ctx.settings.maxDurationMin, minMinutes(next)));
      const w = build(next, minutes);
      return ok(w, 'MOD_HARDER', `Stepped up from ${current.title.toLowerCase()} to ${w.title.toLowerCase()}.`);
    }

    case 'time_limit': {
      const m = Math.floor(request.minutes ?? 0);
      if (!Number.isFinite(m) || m < 10) return refuse('MOD_TIME_TOO_SHORT', 'Give at least 10 minutes.');
      if (current.type === 'rest') return refuse('MOD_REST_DAY', 'Today is a rest day, so no time is needed.');
      if (m >= T) return refuse('MOD_ALREADY_FITS', `The planned session (${fmtDuration(T * 60)}) already fits in ${m} minutes.`);
      let type: WorkoutType = current.type;
      if (isQuality(type) && m < QUALITY_MIN_MINUTES) type = m >= 20 ? 'easy' : 'recovery';
      else if (type === 'long' && m < 60) type = 'easy';
      else if (type === 'easy' && m < 20) type = 'recovery';
      const w = build(type, m);
      const changed = type !== current.type ? ` A full ${current.title.toLowerCase()} doesn't fit, so it becomes ${w.title.toLowerCase()}.` : '';
      return ok(w, 'MOD_TIME_LIMIT', `Fitted into ${m} minutes.${changed}`);
    }

    case 'rest': {
      if (current.type === 'rest') return refuse('MOD_ALREADY_REST', 'It is already a rest day.');
      return ok(build('rest', 0), 'MOD_REST', 'Switched to a rest day. One missed session never hurts fitness; training while run-down can.');
    }

    case 'alternative': {
      if (current.type === 'rest') {
        return ok(build('mobility', 20), 'MOD_ALTERNATIVE', 'Alternative to full rest: 20 minutes of gentle mobility.');
      }
      if (current.type === 'mobility') {
        return ok(build('rest', 0), 'MOD_ALTERNATIVE', 'Alternative: full rest.');
      }
      const i = MODALITY_CYCLE.indexOf(current.modality);
      const nextModality = MODALITY_CYCLE[(i + 1) % MODALITY_CYCLE.length]!;
      const w = build(current.type, T, nextModality);
      return ok(w, 'MOD_ALTERNATIVE', `Same training stimulus as a ${w.title.toLowerCase()} — the zones and duration stay the same.`);
    }
  }
}
