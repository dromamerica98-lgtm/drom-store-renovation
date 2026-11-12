import { describe, expect, it } from 'vitest';
import { addDays } from '../src/dates';
import { activityLoad, classifyActivity, computeLoad, qualityTypeOf } from '../src/load';
import { run, TODAY, trainingWeeks } from './fixtures';

const refs = { maxHr: 188, restingHr: 48 };

describe('activity load', () => {
  it('uses Edwards TRIMP from zone times', () => {
    const a = run(TODAY, 'easy', 60, { timeInZonesSec: [600, 2400, 600, 0, 0] });
    expect(activityLoad(a, refs)).toBe(10 * 1 + 40 * 2 + 10 * 3);
  });

  it('falls back to Banister TRIMP from average HR, then to duration', () => {
    const noZones = run(TODAY, 'easy', 60, { timeInZonesSec: null, avgHr: 140 });
    expect(activityLoad(noZones, refs)).toBeGreaterThan(70);
    expect(activityLoad(noZones, refs)).toBeLessThan(140);
    const noHr = run(TODAY, 'easy', 60, { timeInZonesSec: null, avgHr: null });
    expect(activityLoad(noHr, refs)).toBe(120);
  });

  it('classifies intensity', () => {
    expect(classifyActivity(run(TODAY, 'easy'))).toBe('easy');
    expect(classifyActivity(run(TODAY, 'long', 100))).toBe('long');
    expect(classifyActivity(run(TODAY, 'tempo'))).toBe('hard');
    expect(classifyActivity(run(TODAY, 'threshold'))).toBe('hard');
    expect(classifyActivity(run(TODAY, 'easy', 45, { sport: 'strength' }))).toBe('easy');
    expect(classifyActivity(run(TODAY, 'easy', 45, { timeInZonesSec: null, anaerobicTe: 2.5 }))).toBe('hard');
  });

  it('identifies the quality stimulus', () => {
    expect(qualityTypeOf(run(TODAY, 'tempo'))).toBe('tempo');
    expect(qualityTypeOf(run(TODAY, 'threshold'))).toBe('threshold');
    expect(qualityTypeOf(run(TODAY, 'vo2max'))).toBe('vo2max');
    expect(qualityTypeOf(run(TODAY, 'easy'))).toBeNull();
  });
});

describe('load summary', () => {
  it('reaches ATL ≈ CTL (ACWR ≈ 1) on a steady routine', () => {
    const load = computeLoad(TODAY, trainingWeeks(12), refs, addDays(TODAY, -84));
    expect(load.sufficientHistory).toBe(true);
    expect(load.acwr).toBeGreaterThan(0.8);
    expect(load.acwr).toBeLessThan(1.3);
    expect(load.dailyLoads).toHaveLength(42);
    expect(load.last7.sessions).toBe(5);
  });

  it('detects a load spike', () => {
    const base = trainingWeeks(8);
    const spike = [1, 2, 3, 4, 5, 6].map((i) => run(addDays(TODAY, -i), 'threshold', 80));
    const load = computeLoad(TODAY, [...base, ...spike], refs, addDays(TODAY, -56));
    expect(load.acwr).toBeGreaterThan(1.5);
  });

  it('withholds ACWR with too little history', () => {
    const load = computeLoad(TODAY, [run(addDays(TODAY, -2), 'easy')], refs, addDays(TODAY, -10));
    expect(load.sufficientHistory).toBe(false);
    expect(load.acwr).toBeNull();
  });

  it('tracks yesterday, streaks and recency (today ignored)', () => {
    const acts = [
      run(addDays(TODAY, -4), 'easy'),
      run(addDays(TODAY, -3), 'threshold'),
      run(addDays(TODAY, -2), 'long', 100),
      run(addDays(TODAY, -1), 'tempo'),
      run(TODAY, 'vo2max'), // today's training must not count
    ];
    const load = computeLoad(TODAY, acts, refs, addDays(TODAY, -30));
    expect(load.yesterday.dayClass).toBe('hard');
    expect(load.yesterday.activities).toHaveLength(1);
    expect(load.consecutiveHardDays).toBe(3);
    expect(load.daysSinceRest).toBe(4);
    expect(load.daysSinceHard).toBe(1);
    expect(load.daysSinceLong).toBe(2);
    expect(load.hardDaysLast7).toBe(2);
    expect(load.lastQualityType).toBe('tempo');
    expect(load.longestSessionSec28).toBe(6000);
  });

  it('computes 28-day intensity distribution and weekly volume', () => {
    const load = computeLoad(TODAY, trainingWeeks(5), refs, addDays(TODAY, -35));
    const d = load.intensityDistribution28!;
    expect(d.low + d.moderate + d.high).toBeCloseTo(1, 2);
    expect(d.low).toBeGreaterThan(0.6);
    expect(load.avgWeek28.sessions).toBe(5);
    expect(load.previous7.sessions).toBe(5);
  });
});
