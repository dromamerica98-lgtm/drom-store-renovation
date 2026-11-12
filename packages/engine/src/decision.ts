/**
 * The decision: an ordered list of rules, first match wins.
 *
 *   R1  illness pattern (RHR up + HRV down)          → rest
 *   R2  readiness very low (< 35)                     → rest
 *   R3  not one of your available training days       → rest
 *   R4  low readiness / load spike / < 5 h sleep      → recovery
 *   R5  6+ training days without rest                 → rest (or recovery if primed)
 *   R6  yesterday hard or long, or 2+ hard days       → easy
 *   R7  long-session day and readiness ≥ 55           → long
 *   R8  recovered, quality due, load OK               → tempo / threshold / vo2max
 *   R9  otherwise                                     → easy
 *
 * A final guard downgrades quality to easy while baselines are calibrating or
 * last night's data is missing. Every rule emits machine-readable reason codes
 * plus a deterministic sentence; the AI layer may rephrase, never decide.
 */
import { weekday } from './dates';
import type { IsoDate } from './domain';
import type { AthleteSettings, GoalType } from './domain';
import type { LoadSummary, QualityType } from './load';
import type { Flag, FlagCode, Readiness } from './readiness';
import { clamp, round5 } from './stats';
import { isQuality, QUALITY_MIN_MINUTES, type WorkoutModality, type WorkoutType } from './workouts';

export type RuleId =
  | 'R1_ILLNESS'
  | 'R2_VERY_LOW_READINESS'
  | 'R3_UNAVAILABLE_DAY'
  | 'R4_RECOVERY_NEEDED'
  | 'R5_REST_OVERDUE'
  | 'R6_AFTER_HARD_DAY'
  | 'R7_LONG_DAY'
  | 'R8_QUALITY_DAY'
  | 'R9_EASY_DEFAULT';

export type ReasonTone = 'positive' | 'neutral' | 'caution' | 'warning';

export interface Reason {
  /** Stable machine code, e.g. HRV_BELOW_BASELINE. The AI layer keys off these. */
  code: string;
  tone: ReasonTone;
  message: string;
  data?: Record<string, number | string | null>;
}

export interface DecisionContext {
  date: IsoDate;
  readiness: Readiness;
  flags: Flag[];
  load: LoadSummary;
  settings: AthleteSettings;
}

export interface Decision {
  ruleId: RuleId;
  type: WorkoutType;
  durationMin: number;
  modality: WorkoutModality;
  /** Decisive reason first, then supporting context. */
  reasons: Reason[];
}

const QUALITY_ROTATION: Record<GoalType, QualityType[]> = {
  '5k': ['vo2max', 'threshold', 'tempo'],
  '10k': ['threshold', 'vo2max', 'tempo'],
  half_marathon: ['threshold', 'tempo'],
  marathon: ['tempo', 'threshold'],
  general_fitness: ['tempo', 'threshold', 'vo2max'],
  base_building: ['tempo'],
  weight_loss: ['tempo', 'threshold'],
};

const QUALITY_LABEL: Record<QualityType, string> = {
  tempo: 'a tempo run',
  threshold: 'threshold intervals',
  vo2max: 'VO₂max intervals',
};

export const has = (flags: readonly Flag[], code: FlagCode) => flags.some((f) => f.code === code);

export function modalityFor(settings: AthleteSettings): WorkoutModality {
  return settings.primarySport === 'cycling' ? 'bike' : 'run';
}

/** Flags derived from the load model. */
export function loadFlags(load: LoadSummary): Flag[] {
  const flags: Flag[] = [];
  if (!load.sufficientHistory) {
    flags.push({ code: 'load_history_short', severity: 'info', message: `Only ${load.historyDays} days of training history; load ratios are not reliable yet.` });
  }
  if (load.acwr !== null && load.acwr > 1.5) {
    flags.push({ code: 'load_spike', severity: 'warning', message: `Acute load is ${load.acwr}× your chronic load — a sharp spike.` });
  } else if (load.acwr !== null && load.acwr > 1.3) {
    flags.push({ code: 'load_high', severity: 'caution', message: `Acute load is ${load.acwr}× your chronic load — on the high side.` });
  } else if (load.acwr !== null && load.acwr < 0.8) {
    flags.push({ code: 'load_low', severity: 'info', message: `Acute load is ${load.acwr}× your chronic load — room to build.` });
  }
  if (load.consecutiveHardDays >= 2) {
    flags.push({ code: 'consecutive_hard_days', severity: 'caution', message: `${load.consecutiveHardDays} hard or long days in a row.` });
  }
  if (load.daysSinceRest >= 6) {
    flags.push({ code: 'no_rest_day', severity: 'caution', message: `${load.daysSinceRest} training days without a rest day.` });
  }
  return flags;
}

function durationFor(type: WorkoutType, ctx: DecisionContext): number {
  const { preferredDurationMin: pref, maxDurationMin: max } = ctx.settings;
  const score = ctx.readiness.score ?? 60;
  const acwr = ctx.load.acwr;
  switch (type) {
    case 'rest':
      return 0;
    case 'mobility':
      return 20;
    case 'recovery':
      return clamp(round5(pref * 0.6), 20, 30);
    case 'easy': {
      let m = pref;
      if (score < 65) m *= 0.85;
      if (acwr !== null && acwr < 0.8) m *= 1.1;
      if (acwr !== null && acwr > 1.3) m *= 0.85;
      return clamp(round5(m), 20, max);
    }
    case 'long': {
      const longest = ctx.load.longestSessionSec28 / 60;
      // Progress at most ~10 % beyond the longest session of the last 4 weeks.
      const target = longest > 0 ? Math.min(longest * 1.1, pref * 2.2) : pref * 1.5;
      return clamp(round5(Math.max(target, pref + 15)), Math.min(pref + 15, max), max);
    }
    default:
      return clamp(round5(Math.max(pref, 40)), Math.min(QUALITY_MIN_MINUTES, max), max);
  }
}

/** Context reasons: notable readiness components and load state. */
function contextReasons(ctx: DecisionContext): Reason[] {
  const out: Reason[] = [];
  const { score, band } = ctx.readiness;
  if (score !== null) {
    const tone: ReasonTone = score >= 65 ? 'positive' : score >= 50 ? 'neutral' : score >= 35 ? 'caution' : 'warning';
    out.push({
      code: `READINESS_${band.toUpperCase()}`,
      tone,
      message: `Readiness ${score}/100 (${band.replace('_', ' ')}), compared with your own recent baseline.`,
      data: { score, confidence: ctx.readiness.confidence },
    });
  }
  for (const c of ctx.readiness.components) {
    if (c.status === 'better' || c.status === 'worse' || c.status === 'much_worse') {
      const better = c.status === 'better';
      out.push({
        code: `${c.key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}_${better ? 'ABOVE' : 'BELOW'}_NORMAL`,
        tone: better ? 'positive' : c.status === 'much_worse' ? 'warning' : 'caution',
        message: c.note,
        data: { value: c.value, baseline: c.baseline, z: c.z },
      });
    }
  }
  const acwr = ctx.load.acwr;
  if (acwr !== null) {
    const state = acwr > 1.5 ? 'SPIKE' : acwr > 1.3 ? 'HIGH' : acwr < 0.8 ? 'LOW' : 'BALANCED';
    out.push({
      code: `LOAD_${state}`,
      tone: state === 'SPIKE' ? 'warning' : state === 'HIGH' ? 'caution' : state === 'LOW' ? 'neutral' : 'positive',
      message:
        state === 'BALANCED'
          ? `Training load is balanced: last 7 days are ${acwr}× your 6-week average.`
          : state === 'LOW'
            ? `Training load is below your usual (${acwr}×) — there is room to build.`
            : `Recent load is ${acwr}× your 6-week average — ${state === 'SPIKE' ? 'a sharp spike' : 'on the high side'}.`,
      data: { acwr, atl: ctx.load.atl, ctl: ctx.load.ctl },
    });
  }
  return out;
}

const hardLabel = (load: LoadSummary) => {
  const a = [...load.yesterday.activities].sort((x, y) => y.load - x.load)[0];
  return a?.name ? `"${a.name}"` : 'a hard session';
};

export function decide(ctx: DecisionContext): Decision {
  const { readiness, flags, load, settings, date } = ctx;
  const score = readiness.score;
  const modality = modalityFor(settings);
  const make = (ruleId: RuleId, type: WorkoutType, decisive: Reason): Decision => ({
    ruleId,
    type,
    durationMin: durationFor(type, ctx),
    modality,
    reasons: [decisive, ...contextReasons(ctx)],
  });

  // R1 — illness pattern
  if (has(flags, 'illness_pattern')) {
    return make('R1_ILLNESS', 'rest', {
      code: 'ILLNESS_PATTERN',
      tone: 'warning',
      message:
        'Resting heart rate is up and HRV is down at the same time. That pattern often precedes illness or signals deep fatigue, so today is a full rest day.',
    });
  }

  // R2 — very low readiness
  if (score !== null && score < 35) {
    return make('R2_VERY_LOW_READINESS', 'rest', {
      code: 'READINESS_VERY_LOW',
      tone: 'warning',
      message: `Readiness is very low (${score}). Training today would dig a deeper hole; rest lets you bounce back faster.`,
      data: { score },
    });
  }

  // R3 — not an available training day
  if (!settings.availableDays.includes(weekday(date))) {
    return make('R3_UNAVAILABLE_DAY', 'rest', {
      code: 'UNAVAILABLE_DAY',
      tone: 'neutral',
      message: "Today isn't one of your training days (Settings → available days). Enjoy the rest.",
    });
  }

  // R4 — recovery needed
  const lowReadiness = score !== null && score < 50;
  if (lowReadiness || has(flags, 'load_spike') || has(flags, 'very_short_sleep')) {
    const reason: Reason = lowReadiness
      ? {
          code: 'READINESS_LOW',
          tone: 'caution',
          message: `Readiness is low (${score}), so today is a short, very easy session that helps recovery without adding fatigue.`,
          data: { score },
        }
      : has(flags, 'load_spike')
        ? {
            code: 'LOAD_SPIKE',
            tone: 'warning',
            message: `Your last 7 days were ${load.acwr}× your 6-week average. Spikes like this raise injury risk, so today stays very easy.`,
            data: { acwr: load.acwr },
          }
        : {
            code: 'SLEEP_VERY_SHORT',
            tone: 'warning',
            message: 'You slept under 5 hours. Intensity today would add stress without much benefit, so keep it short and very easy.',
          };
    return make('R4_RECOVERY_NEEDED', 'recovery', reason);
  }

  // R5 — rest overdue
  if (load.daysSinceRest >= 6) {
    const primed = score !== null && score >= 80;
    return make('R5_REST_OVERDUE', primed ? 'recovery' : 'rest', {
      code: 'REST_OVERDUE',
      tone: 'caution',
      message: `You've trained ${load.daysSinceRest} days in a row. ${primed ? 'You feel fresh, but keep today to a short recovery session' : 'A rest day now protects the gains from that block'}.`,
      data: { daysSinceRest: load.daysSinceRest },
    });
  }

  // R6 — after a hard day
  const yesterdayHard = load.yesterday.dayClass === 'hard' || load.yesterday.dayClass === 'long';
  if (yesterdayHard || has(flags, 'consecutive_hard_days')) {
    return make('R6_AFTER_HARD_DAY', 'easy', {
      code: load.consecutiveHardDays >= 2 ? 'CONSECUTIVE_HARD_DAYS' : 'YESTERDAY_HARD',
      tone: 'neutral',
      message:
        load.consecutiveHardDays >= 2
          ? `${load.consecutiveHardDays} hard or long days in a row. Today is easy aerobic work so your body can absorb them.`
          : `Yesterday was ${hardLabel(load)}. An easy aerobic day today lets you absorb it — hard days work best with easy days between them.`,
      data: { consecutiveHardDays: load.consecutiveHardDays },
    });
  }

  // R7 — long-session day
  const longDay = settings.longSessionDay
    ? weekday(date) === settings.longSessionDay
    : weekday(date) >= 6 && (load.daysSinceLong === null || load.daysSinceLong >= 6);
  if (longDay && (score === null || score >= 55) && !has(flags, 'load_high')) {
    return make('R7_LONG_DAY', 'long', {
      code: 'LONG_DAY',
      tone: 'positive',
      message: `${settings.longSessionDay ? "It's your long-session day" : "It's the weekend and your last long session was a while ago"}, and readiness supports it. Long, steady aerobic work is the backbone of endurance.`,
      data: { daysSinceLong: load.daysSinceLong },
    });
  }

  // R8 — quality day
  const quota = settings.qualitySessionsPerWeek;
  const blockers: string[] = [];
  if (score === null || score < 65) blockers.push('readiness');
  if (has(flags, 'hrv_trend_low')) blockers.push('hrv_trend');
  if (has(flags, 'load_high')) blockers.push('load');
  if (load.daysSinceHard !== null && load.daysSinceHard < 2) blockers.push('recent_hard');
  if (load.hardDaysPrev6 >= quota) blockers.push('quota');
  if (blockers.length === 0) {
    const rotation = QUALITY_ROTATION[settings.goalType];
    const allowed = rotation.filter((q) => q !== 'vo2max' || (score ?? 0) >= 75);
    const choice = allowed.find((q) => q !== load.lastQualityType) ?? allowed[0] ?? 'tempo';
    const decision = make('R8_QUALITY_DAY', choice, {
      code: 'QUALITY_DUE',
      tone: 'positive',
      message:
        `You're recovered (readiness ${score}), your last hard session was ${load.daysSinceHard === null ? 'more than two weeks' : `${load.daysSinceHard} days`} ago, ` +
        `and you've done ${load.hardDaysPrev6} of your ${quota} weekly quality sessions in the past 6 days — time for ${QUALITY_LABEL[choice]}.`,
      data: { hardDaysPrev6: load.hardDaysPrev6, quota, lastQualityType: load.lastQualityType },
    });
    if (load.lastQualityType && load.lastQualityType !== choice) {
      decision.reasons.splice(1, 0, {
        code: 'QUALITY_ROTATION',
        tone: 'neutral',
        message: `Your last quality session was ${QUALITY_LABEL[load.lastQualityType]}, so today rotates to a different stimulus.`,
      });
    }
    return guard(decision, ctx);
  }

  // R9 — default easy
  const why =
    blockers.includes('quota')
      ? `You've already done ${load.hardDaysPrev6} hard session${load.hardDaysPrev6 === 1 ? '' : 's'} in the past 6 days (weekly target ${quota}).`
      : blockers.includes('recent_hard')
        ? 'Your last hard session was only a day ago.'
        : blockers.includes('load')
          ? 'Recent load is already on the high side.'
          : blockers.includes('hrv_trend')
            ? 'Your HRV has been trending below baseline this week.'
            : 'Readiness is fine but not high enough for a quality session.';
  return make('R9_EASY_DEFAULT', 'easy', {
    code: 'EASY_DEFAULT',
    tone: 'neutral',
    message: `${why} An easy aerobic session builds your base without adding fatigue.`,
    data: { blockers: blockers.join(',') },
  });
}

/** Downgrades quality to easy when the data behind the decision is thin. */
function guard(decision: Decision, ctx: DecisionContext): Decision {
  if (!isQuality(decision.type)) return decision;
  const thin = ctx.readiness.confidence < 0.5 || has(ctx.flags, 'calibrating') || has(ctx.flags, 'missing_today_data');
  if (!thin) return decision;
  return {
    ...decision,
    ruleId: 'R9_EASY_DEFAULT',
    type: 'easy',
    durationMin: durationFor('easy', ctx),
    reasons: [
      {
        code: 'CONSERVATIVE_LOW_CONFIDENCE',
        tone: 'caution',
        message: has(ctx.flags, 'missing_today_data')
          ? "Last night's data hasn't synced yet, so the plan stays easy. Sync your watch and refresh to unlock a quality session."
          : 'Your personal baselines are still calibrating, so the plan stays easy rather than prescribing intensity on thin data.',
      },
      ...decision.reasons,
    ],
  };
}
