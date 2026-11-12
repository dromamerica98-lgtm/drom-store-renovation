import { describe, expect, it } from 'vitest';
import { computeBaseline, MIN_BASELINE_SAMPLES, zScore } from '../src/baselines';
import { addDays } from '../src/dates';
import { day, history, TODAY } from './fixtures';

describe('personal baselines', () => {
  it("uses the 42 days before today and excludes today's value", () => {
    const h = history(60, { restingHr: 90 });
    const b = computeBaseline(h, 'restingHr', TODAY);
    expect(b.n).toBe(42);
    expect(b.sufficient).toBe(true);
    expect(b.mean).toBeGreaterThan(47);
    expect(b.mean).toBeLessThan(49); // the 90 bpm today is not in its own baseline
  });

  it('uses a geometric mean and log-space SD for HRV', () => {
    const h = [40, 90].flatMap((v, i) => Array.from({ length: 10 }, (_, k) => day(addDays(TODAY, -(i * 10 + k + 1)), { hrvLastNightMs: v })));
    const b = computeBaseline(h, 'hrv', TODAY);
    expect(b.mean).toBeCloseTo(Math.sqrt(40 * 90), 5);
    expect(zScore(b, Math.sqrt(40 * 90))).toBeCloseTo(0, 5);
  });

  it('floors the SD so tiny changes on a very stable history are not dramatic', () => {
    const flat = Array.from({ length: 30 }, (_, i) => day(addDays(TODAY, -(i + 1)), { restingHr: 50 }));
    const b = computeBaseline(flat, 'restingHr', TODAY);
    expect(b.sd).toBe(1.5);
    expect(zScore(b, 51)).toBeCloseTo(0.67, 2);
  });

  it(`is insufficient with fewer than ${MIN_BASELINE_SAMPLES} days and ignores nulls`, () => {
    const h = history(20).map((d, i) => (i % 2 ? { ...d, hrvLastNightMs: null } : d));
    const b = computeBaseline(h, 'hrv', TODAY);
    expect(b.n).toBe(10);
    expect(b.sufficient).toBe(false);
  });
});
