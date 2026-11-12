import { describe, expect, it } from 'vitest';
import { assessDay } from '../src/assess';
import { addDays } from '../src/dates';
import type { ActivitySummary, AthleteSettings, DailyMetrics } from '../src/domain';
import { history, run, settings, TODAY, trainingWeeks } from './fixtures';

function assess(opts: { metrics?: DailyMetrics[]; activities?: ActivitySummary[]; settings?: Partial<AthleteSettings>; date?: string } = {}) {
  return assessDay({
    date: opts.date ?? TODAY,
    metrics: opts.metrics ?? history(60),
    activities: opts.activities ?? trainingWeeks(8),
    settings: settings(opts.settings),
  });
}

/** History where yesterday (Wed) was easy and the last hard day was Tuesday. */
const normalWeek = () => trainingWeeks(8);

describe('decision rules', () => {
  it('R1: illness pattern → rest', () => {
    const a = assess({ metrics: history(60, { restingHr: 57, hrvLastNightMs: 41 }) });
    expect(a.recommendation.ruleId).toBe('R1_ILLNESS');
    expect(a.recommendation.workout.type).toBe('rest');
    expect(a.recommendation.reasons[0]!.code).toBe('ILLNESS_PATTERN');
  });

  it('R2: very low readiness → rest', () => {
    const a = assess({ metrics: history(60, { hrvLastNightMs: 45, sleepDurationSec: 5.5 * 3600, sleepScore: 50, bodyBatteryWake: 20 }) });
    expect(a.readiness.score).toBeLessThan(35);
    expect(a.recommendation.ruleId).toBe('R2_VERY_LOW_READINESS');
  });

  it('R3: not an available day → rest', () => {
    const a = assess({ settings: { availableDays: [1, 2, 3, 5, 6, 7] } }); // Thursday excluded
    expect(a.recommendation.ruleId).toBe('R3_UNAVAILABLE_DAY');
    expect(a.recommendation.workout.type).toBe('rest');
  });

  it('R4: low readiness → short recovery session', () => {
    const a = assess({ metrics: history(60, { hrvLastNightMs: 56, sleepDurationSec: 6.8 * 3600, sleepScore: 72, bodyBatteryWake: 62 }) });
    expect(a.readiness.score).toBeGreaterThanOrEqual(35);
    expect(a.readiness.score).toBeLessThan(50);
    expect(a.recommendation.ruleId).toBe('R4_RECOVERY_NEEDED');
    expect(a.recommendation.workout.type).toBe('recovery');
    expect(a.recommendation.workout.durationSec).toBeLessThanOrEqual(30 * 60);
  });

  it('R4: load spike → recovery even when readiness is fine', () => {
    const spike = [1, 2, 3, 4, 5, 6].map((i) => run(addDays(TODAY, -i), 'easy', 120));
    const a = assess({ activities: [...normalWeek().filter((x) => x.localDate < addDays(TODAY, -6)), ...spike] });
    expect(a.flags.map((f) => f.code)).toContain('load_spike');
    expect(a.recommendation.ruleId).toBe('R4_RECOVERY_NEEDED');
    expect(a.recommendation.reasons[0]!.code).toBe('LOAD_SPIKE');
  });

  it('R5: six training days in a row → rest', () => {
    const acts = [...normalWeek().filter((x) => x.localDate < addDays(TODAY, -6)), ...[1, 2, 3, 4, 5, 6].map((i) => run(addDays(TODAY, -i), 'easy', 40))];
    const a = assess({ activities: acts });
    expect(a.recommendation.ruleId).toBe('R5_REST_OVERDUE');
    expect(a.recommendation.workout.type).toBe('rest');
  });

  it('R6: yesterday hard → easy', () => {
    // Tuesday's session becomes easy so only yesterday was hard.
    const acts = [
      ...normalWeek().filter((x) => x.localDate !== addDays(TODAY, -1) && x.localDate !== addDays(TODAY, -2)),
      run(addDays(TODAY, -2), 'easy', 40),
      run(addDays(TODAY, -1), 'threshold', 55),
    ];
    const a = assess({ activities: acts });
    expect(a.recommendation.ruleId).toBe('R6_AFTER_HARD_DAY');
    expect(a.recommendation.workout.type).toBe('easy');
    expect(a.recommendation.reasons[0]!.message).toContain('Threshold run');
  });

  it('R7: long-session day → long run, progressing at most ~10 %', () => {
    const a = assess({ settings: { longSessionDay: 4 } });
    expect(a.recommendation.ruleId).toBe('R7_LONG_DAY');
    expect(a.recommendation.workout.type).toBe('long');
    expect(a.recommendation.workout.durationSec / 60).toBe(100); // longest 90 min → 99 → rounded to 100
  });

  it('R8: recovered with quality due → a quality session, rotated away from the last one', () => {
    const a = assess({ metrics: history(60, { hrvLastNightMs: 66, sleepScore: 86, bodyBatteryWake: 85 }) });
    expect(a.recommendation.ruleId).toBe('R8_QUALITY_DAY');
    // last quality was Tuesday's threshold session → general_fitness rotation picks tempo
    expect(a.recommendation.workout.type).toBe('tempo');
    expect(a.recommendation.reasons.map((r) => r.code)).toContain('QUALITY_ROTATION');
  });

  it('R8: goal shapes the session (5k + primed → VO₂max)', () => {
    const acts = normalWeek().map((x) => (x.name === 'Threshold run' ? { ...x, timeInZonesSec: [1500, 600, 300, 600, 0] as [number, number, number, number, number] } : x));
    const a = assess({ activities: acts, settings: { goalType: '5k' }, metrics: history(60, { hrvLastNightMs: 70, sleepScore: 90, bodyBatteryWake: 92, restingHr: 46 }) });
    expect(a.readiness.score).toBeGreaterThanOrEqual(75);
    expect(a.recommendation.workout.type).toBe('vo2max');
  });

  it('R9: quality quota met → easy, and says why', () => {
    const a = assess({ settings: { qualitySessionsPerWeek: 1 }, metrics: history(60, { hrvLastNightMs: 66 }) });
    expect(a.recommendation.ruleId).toBe('R9_EASY_DEFAULT');
    expect(a.recommendation.reasons[0]!.message).toMatch(/already done 1 hard session in the past 6 days/);
  });

  it('guard: never prescribes intensity while baselines are calibrating', () => {
    const short = history(10, { hrvLastNightMs: 70, sleepScore: 92, bodyBatteryWake: 95 });
    const a = assess({ metrics: short, activities: trainingWeeks(2) });
    expect(a.flags.map((f) => f.code)).toContain('calibrating');
    expect(['easy', 'recovery', 'rest', 'long']).toContain(a.recommendation.workout.type);
  });

  it('every recommendation explains itself, decisive reason first', () => {
    const a = assess();
    expect(a.recommendation.reasons.length).toBeGreaterThan(1);
    expect(a.recommendation.summary).toContain(a.recommendation.reasons[0]!.message);
    expect(a.recommendation.reasons.some((r) => r.code.startsWith('READINESS_'))).toBe(true);
  });
});
