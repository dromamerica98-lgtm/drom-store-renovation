import type { Flag, ReadinessComponent, TodayResponse, Workout } from '@coach/shared';
import type { Tone } from '../../components/Status';

type Band = TodayResponse['readiness']['band'];

export const BAND: Record<Band, { label: string; tone: Tone; color: string }> = {
  primed: { label: 'Primed', tone: 'good', color: 'var(--good)' },
  good: { label: 'Good', tone: 'good', color: 'var(--good)' },
  moderate: { label: 'Moderate', tone: 'warning', color: 'var(--warning)' },
  low: { label: 'Low', tone: 'serious', color: 'var(--serious)' },
  very_low: { label: 'Very low', tone: 'critical', color: 'var(--critical)' },
  unknown: { label: 'Not enough data', tone: 'neutral', color: 'var(--muted)' },
};

export function componentStatus(c: ReadinessComponent): { tone: Tone; label: string } {
  const lowerIsBetter = c.key === 'restingHr' || c.key === 'stress';
  switch (c.status) {
    case 'better':
      return { tone: 'good', label: lowerIsBetter ? 'Lower than usual' : 'Above usual' };
    case 'normal':
      return { tone: 'neutral', label: 'Normal for you' };
    case 'worse':
      return { tone: 'warning', label: lowerIsBetter ? 'Higher than usual' : 'Below usual' };
    case 'much_worse':
      return { tone: 'serious', label: lowerIsBetter ? 'Well above usual' : 'Well below usual' };
    default:
      return { tone: 'neutral', label: c.value === null ? 'No data yet' : 'Calibrating' };
  }
}

export const SEVERITY_TONE: Record<Flag['severity'], Tone> = {
  critical: 'critical',
  warning: 'serious',
  caution: 'warning',
  info: 'neutral',
};

export const INTENSITY_LABEL: Record<Workout['intensity'], string> = {
  rest: 'Rest',
  very_easy: 'Very easy',
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  very_hard: 'Very hard',
};

export const MODALITY_LABEL: Record<Workout['modality'], string> = {
  run: 'Run',
  bike: 'Bike',
  elliptical: 'Elliptical',
  mobility: 'Mobility',
  none: 'Rest',
};

export const ZONE_COLOR = (zone: number | null) => (zone ? `var(--z${zone})` : 'var(--track)');

export const MOD_LABEL: Record<string, string> = {
  shorter: 'Shorter',
  easier: 'Easier',
  harder: 'Harder',
  time_limit: 'Time limit',
  rest: 'Rest day',
  alternative: 'Alternative',
};

export const RULE_LABEL: Record<string, string> = {
  R1_ILLNESS: 'Signs of illness',
  R2_VERY_LOW_READINESS: 'Very low readiness',
  R3_UNAVAILABLE_DAY: 'Not a training day',
  R4_RECOVERY_NEEDED: 'Recovery needed',
  R5_REST_OVERDUE: 'Rest overdue',
  R6_AFTER_HARD_DAY: 'After a hard day',
  R7_LONG_DAY: 'Long-session day',
  R8_QUALITY_DAY: 'Quality day',
  R9_EASY_DEFAULT: 'Easy by default',
};
