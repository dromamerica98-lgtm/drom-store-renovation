/**
 * Training zones. Uses the user's own zones from Settings when all five are
 * set; otherwise derives them, in order of preference, from lactate threshold
 * HR, max HR, or (last resort) age. Pace zones come from Settings or from
 * threshold pace. If nothing is known, workouts fall back to RPE only.
 */
import type { AthleteSettings, Zone, ZoneNumber } from './domain';
import { round } from './stats';

export type ZoneSource = 'settings' | 'lthr' | 'max_hr' | 'age_estimate' | 'none';

export interface ResolvedZones {
  hr: Zone[] | null;
  hrSource: ZoneSource;
  pace: Zone[] | null;
  paceSource: 'settings' | 'threshold_pace' | 'none';
}

const ZONE_NAMES = ['Recovery', 'Aerobic', 'Tempo', 'Threshold', 'VO₂max'] as const;

function fromFractions(reference: number, bounds: ReadonlyArray<readonly [number, number]>): Zone[] {
  return bounds.map(([lo, hi], i) => ({
    zone: (i + 1) as ZoneNumber,
    name: ZONE_NAMES[i]!,
    min: Math.round(reference * lo),
    max: Math.round(reference * hi) - (i < 4 ? 1 : 0),
  }));
}

/** Friel-style running zones as fractions of LTHR. */
const LTHR_BOUNDS = [
  [0.65, 0.85],
  [0.85, 0.9],
  [0.9, 0.95],
  [0.95, 1.0],
  [1.0, 1.1],
] as const;

/** Garmin's default %max-HR zones. */
const MAX_HR_BOUNDS = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
] as const;

/** Pace zones as multiples of threshold pace (sec/km); [fast, slow]. */
const PACE_BOUNDS = [
  [1.3, 1.5],
  [1.15, 1.3],
  [1.06, 1.15],
  [0.98, 1.06],
  [0.9, 0.98],
] as const;

export function resolveZones(settings: AthleteSettings, referenceYear: number): ResolvedZones {
  let hr: Zone[] | null = null;
  let hrSource: ZoneSource = 'none';
  if (settings.hrZones.length === 5) {
    hr = [...settings.hrZones].sort((a, b) => a.zone - b.zone);
    hrSource = 'settings';
  } else if (settings.lthr) {
    hr = fromFractions(settings.lthr, LTHR_BOUNDS);
    hrSource = 'lthr';
  } else if (settings.maxHr) {
    hr = fromFractions(settings.maxHr, MAX_HR_BOUNDS);
    hrSource = 'max_hr';
  } else if (settings.birthYear) {
    hr = fromFractions(220 - (referenceYear - settings.birthYear), MAX_HR_BOUNDS);
    hrSource = 'age_estimate';
  }

  let pace: Zone[] | null = null;
  let paceSource: ResolvedZones['paceSource'] = 'none';
  if (settings.paceZones.length === 5) {
    pace = [...settings.paceZones].sort((a, b) => a.zone - b.zone);
    paceSource = 'settings';
  } else if (settings.thresholdPaceSecPerKm) {
    const t = settings.thresholdPaceSecPerKm;
    pace = PACE_BOUNDS.map(([fast, slow], i) => ({
      zone: (i + 1) as ZoneNumber,
      name: ZONE_NAMES[i]!,
      min: round(t * fast),
      max: round(t * slow),
    }));
    paceSource = 'threshold_pace';
  }
  return { hr, hrSource, pace, paceSource };
}

export function zone(zones: Zone[] | null, n: ZoneNumber): Zone | null {
  return zones?.find((z) => z.zone === n) ?? null;
}
