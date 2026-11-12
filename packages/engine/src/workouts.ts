/**
 * Structured workout builder.
 *
 * Turns (type, total minutes, zones, modality) into warm-up, main set,
 * repeat blocks with recoveries, and cool-down — each step with an HR zone,
 * bpm range, pace range (running only, when pace zones are known), RPE range
 * and a plain-language effort cue.
 */
import type { ZoneNumber } from './domain';
import { fmtDuration, fmtPace } from './format';
import { clamp } from './stats';
import { zone, type ResolvedZones } from './zones';

export const WORKOUT_TYPES = ['rest', 'mobility', 'recovery', 'easy', 'long', 'tempo', 'threshold', 'vo2max'] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];
export type QualityWorkoutType = Extract<WorkoutType, 'tempo' | 'threshold' | 'vo2max'>;

export type WorkoutModality = 'run' | 'bike' | 'elliptical' | 'mobility' | 'none';
export type Intensity = 'rest' | 'very_easy' | 'easy' | 'moderate' | 'hard' | 'very_hard';

/** Quality sessions need at least this long to fit warm-up, work and cool-down. */
export const QUALITY_MIN_MINUTES = 35;

export interface Target {
  zone: ZoneNumber | null;
  zoneName: string | null;
  hrBpm: [number, number] | null;
  /** [fastest, slowest] sec/km. */
  paceSecPerKm: [number, number] | null;
  rpe: [number, number];
  cue: string;
}

export type StepKind = 'warmup' | 'main' | 'work' | 'recovery' | 'cooldown';

export interface WorkoutStep {
  kind: StepKind;
  label: string;
  durationSec: number;
  target: Target;
}

export interface RepeatBlock {
  kind: 'repeat';
  times: number;
  steps: WorkoutStep[];
}

export type WorkoutBlock = WorkoutStep | RepeatBlock;

export interface Workout {
  type: WorkoutType;
  modality: WorkoutModality;
  title: string;
  summary: string;
  intensity: Intensity;
  durationSec: number;
  primaryZone: ZoneNumber | null;
  blocks: WorkoutBlock[];
  notes: string[];
}

export interface BuildContext {
  zones: ResolvedZones;
  modality: WorkoutModality;
}

export const isQuality = (t: WorkoutType): t is QualityWorkoutType => t === 'tempo' || t === 'threshold' || t === 'vo2max';

const RPE: Record<ZoneNumber, [number, number]> = { 1: [2, 3], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [8, 9] };
const CUE: Record<ZoneNumber, string> = {
  1: 'Very easy — you could chat in full sentences.',
  2: 'Easy and conversational — nose breathing is possible.',
  3: 'Comfortably hard — a few words at a time.',
  4: 'Hard but controlled — an effort you could hold for about an hour.',
  5: 'Very hard — only a word or two.',
};

const INTENSITY: Record<WorkoutType, Intensity> = {
  rest: 'rest',
  mobility: 'very_easy',
  recovery: 'very_easy',
  easy: 'easy',
  long: 'moderate',
  tempo: 'hard',
  threshold: 'hard',
  vo2max: 'very_hard',
};

function target(n: ZoneNumber, ctx: BuildContext): Target {
  const hr = zone(ctx.zones.hr, n);
  const pace = ctx.modality === 'run' ? zone(ctx.zones.pace, n) : null;
  return {
    zone: n,
    zoneName: hr?.name ?? null,
    hrBpm: hr ? [hr.min, hr.max] : null,
    paceSecPerKm: pace ? [pace.min, pace.max] : null,
    rpe: RPE[n],
    cue: CUE[n],
  };
}

const step = (kind: StepKind, label: string, minutes: number, z: ZoneNumber, ctx: BuildContext): WorkoutStep => ({
  kind,
  label,
  durationSec: Math.round(minutes * 60),
  target: target(z, ctx),
});

function noun(modality: WorkoutModality): string {
  switch (modality) {
    case 'bike':
      return 'ride';
    case 'elliptical':
      return 'elliptical session';
    default:
      return 'run';
  }
}

function zoneText(t: Target): string {
  if (t.hrBpm) return `Zone ${t.zone} (${t.hrBpm[0]}–${t.hrBpm[1]} bpm)`;
  if (t.paceSecPerKm) return `Zone ${t.zone} (${fmtPace(t.paceSecPerKm[0])}–${fmtPace(t.paceSecPerKm[1])})`;
  return `RPE ${t.rpe[0]}–${t.rpe[1]}`;
}

/** Sums step durations, expanding repeat blocks. */
export function totalDurationSec(blocks: readonly WorkoutBlock[]): number {
  return blocks.reduce(
    (sum, b) => sum + (b.kind === 'repeat' ? b.times * b.steps.reduce((s, x) => s + x.durationSec, 0) : b.durationSec),
    0,
  );
}

export function buildWorkout(type: WorkoutType, minutes: number, ctx: BuildContext): Workout {
  const notes: string[] = [];
  const blocks: WorkoutBlock[] = [];
  const thing = noun(ctx.modality);
  let title: string;
  let summary: string;
  let primaryZone: ZoneNumber | null = null;

  switch (type) {
    case 'rest': {
      title = 'Rest day';
      summary = 'No training today. Recovery is where the adaptation happens.';
      notes.push('Optional: an easy 10–20 min walk or light mobility if you feel like moving.');
      break;
    }
    case 'mobility': {
      const t = clamp(minutes, 10, 45);
      title = 'Mobility & stretching';
      summary = `${t} min of gentle mobility, stretching or yoga.`;
      blocks.push({
        kind: 'main',
        label: 'Mobility flow: hips, calves, hamstrings, thoracic spine',
        durationSec: t * 60,
        target: { zone: null, zoneName: null, hrBpm: null, paceSecPerKm: null, rpe: [1, 2], cue: 'Relaxed and slow; nothing should hurt.' },
      });
      break;
    }
    case 'recovery': {
      const t = clamp(minutes, 10, 40);
      primaryZone = 1;
      const s = step('main', `Very easy ${thing}`, t, 1, ctx);
      blocks.push(s);
      title = `Recovery ${thing}`;
      summary = `${t} min very easy ${thing} in ${zoneText(s.target)}.`;
      notes.push('If even this feels hard, stop and walk — the goal is circulation, not fitness.');
      break;
    }
    case 'easy':
    case 'long': {
      const t = Math.max(minutes, 15);
      primaryZone = 2;
      if (t < 25) {
        blocks.push(step('main', `Easy ${thing}, start very gently`, t, 2, ctx));
      } else {
        const cool = type === 'long' ? 10 : 5;
        blocks.push(step('warmup', 'Warm up gradually', 10, 1, ctx));
        blocks.push(step('main', type === 'long' ? `Steady aerobic ${thing}` : `Easy aerobic ${thing}`, t - 10 - cool, 2, ctx));
        blocks.push(step('cooldown', 'Cool down', cool, 1, ctx));
      }
      const main = blocks.find((b): b is WorkoutStep => b.kind === 'main')!;
      title = type === 'long' ? `Long ${thing}` : `Easy aerobic ${thing}`;
      summary = `${fmtDuration(t * 60)} ${type === 'long' ? 'long, steady' : 'easy'} ${thing} in ${zoneText(main.target)}.`;
      if (type === 'long') notes.push('Bring water, and fuel if you go beyond 75 minutes. Keep the effort steady, not the pace.');
      break;
    }
    case 'tempo': {
      const t = Math.max(minutes, QUALITY_MIN_MINUTES);
      const warm = t >= 45 ? 15 : 10;
      const coolMin = t >= 45 ? 10 : 8;
      const work = Math.min(40, t - warm - coolMin);
      primaryZone = 3;
      blocks.push(step('warmup', 'Warm up, building from very easy to easy', warm, 1, ctx));
      blocks.push(step('work', 'Continuous tempo', work, 3, ctx));
      blocks.push(step('cooldown', 'Cool down easy', t - warm - work, 1, ctx));
      title = `Tempo ${thing}`;
      summary = `${work} min continuous tempo in ${zoneText(target(3, ctx))}, with warm-up and cool-down (${t} min total).`;
      break;
    }
    case 'threshold':
    case 'vo2max': {
      const t = Math.max(minutes, QUALITY_MIN_MINUTES);
      const long = t >= 45;
      const warm = long ? 15 : 10;
      const coolMin = long ? 10 : 8;
      const [work, rec, minReps, maxReps, z] =
        type === 'threshold'
          ? ([long ? 8 : 6, 2, 2, 5, 4] as const)
          : ([long ? 3 : 2, long ? 3 : 2, 3, 6, 5] as const);
      const reps = clamp(Math.floor((t - warm - coolMin) / (work + rec)), minReps, maxReps);
      const cool = Math.max(coolMin, t - warm - reps * (work + rec));
      primaryZone = z;
      blocks.push(step('warmup', type === 'vo2max' ? 'Warm up, finish with 4 × 20 s relaxed strides' : 'Warm up, building to easy', warm, 1, ctx));
      blocks.push({
        kind: 'repeat',
        times: reps,
        steps: [
          step('work', type === 'threshold' ? 'Threshold effort' : 'Hard interval', work, z, ctx),
          step('recovery', 'Easy recovery jog', rec, 1, ctx),
        ],
      });
      blocks.push(step('cooldown', 'Cool down easy', cool, 1, ctx));
      title = type === 'threshold' ? 'Threshold intervals' : 'VO₂max intervals';
      summary = `${reps} × ${work} min in ${zoneText(target(z, ctx))} with ${rec} min easy between (${fmtDuration(totalDurationSec(blocks))} total).`;
      if (type === 'vo2max') notes.push('Run the intervals evenly — the last one should be as fast as the first.');
      break;
    }
  }

  if (ctx.modality === 'bike') {
    notes.push('Cycling heart rate usually runs 5–10 bpm lower than running at the same effort. If the zone feels too hard, go by the effort cue.');
  }
  if (type !== 'rest' && type !== 'mobility') {
    if (ctx.zones.hrSource === 'age_estimate') {
      notes.push('Heart-rate zones are estimated from your age. Set max HR or lactate-threshold HR in Settings for accurate targets.');
    } else if (ctx.zones.hrSource === 'none') {
      notes.push('Set your max HR in Settings to get heart-rate targets. Use the effort cues for now.');
    }
  }

  return {
    type,
    modality: type === 'rest' ? 'none' : type === 'mobility' ? 'mobility' : ctx.modality,
    title,
    summary,
    intensity: INTENSITY[type],
    durationSec: totalDurationSec(blocks),
    primaryZone,
    blocks,
    notes,
  };
}
