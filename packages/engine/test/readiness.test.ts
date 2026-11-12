import { describe, expect, it } from 'vitest';
import { addDays } from '../src/dates';
import { bandFor, computeReadiness, scoreFromZ } from '../src/readiness';
import { day, history, TODAY } from './fixtures';

const codes = (r: ReturnType<typeof computeReadiness>) => r.flags.map((f) => f.code);

describe('readiness', () => {
  it('maps z-scores and bands as documented', () => {
    expect(scoreFromZ(0)).toBe(70);
    expect(scoreFromZ(1)).toBe(90);
    expect(scoreFromZ(-1)).toBe(50);
    expect(scoreFromZ(-5)).toBe(0);
    expect([85, 70, 55, 40, 20, null].map(bandFor)).toEqual(['primed', 'good', 'moderate', 'low', 'very_low', 'unknown']);
  });

  it('scores a typical day as "good" with full confidence', () => {
    const r = computeReadiness(TODAY, history(60));
    expect(r.readiness.score).toBeGreaterThanOrEqual(65);
    expect(r.readiness.score).toBeLessThan(80);
    expect(r.readiness.band).toBe('good');
    expect(r.readiness.confidence).toBe(1);
    expect(r.readiness.components.every((c) => c.basis === 'baseline')).toBe(true);
    expect(r.flags).toEqual([]);
  });

  it('scores a great morning as "primed"', () => {
    const r = computeReadiness(TODAY, history(60, { hrvLastNightMs: 72, restingHr: 45, sleepDurationSec: 8.4 * 3600, sleepScore: 92, bodyBatteryWake: 95 }));
    expect(r.readiness.band).toBe('primed');
    expect(r.readiness.components.find((c) => c.key === 'hrv')?.status).toBe('better');
  });

  it('flags the illness pattern when RHR is up and HRV is down together', () => {
    const r = computeReadiness(TODAY, history(60, { restingHr: 56, hrvLastNightMs: 42 }));
    expect(codes(r)).toContain('illness_pattern');
    expect(r.readiness.score).toBeLessThan(50);
  });

  it('needs a clear absolute RHR rise (≥ 4 bpm) before calling it illness', () => {
    const r = computeReadiness(TODAY, history(60, { restingHr: 51, hrvLastNightMs: 45 }));
    expect(codes(r)).toContain('rhr_elevated');
    expect(codes(r)).toContain('hrv_suppressed');
    expect(codes(r)).not.toContain('illness_pattern');
  });

  it('flags elevated RHR alone without calling it illness', () => {
    const r = computeReadiness(TODAY, history(60, { restingHr: 55 }));
    expect(codes(r)).toContain('rhr_elevated');
    expect(codes(r)).not.toContain('illness_pattern');
  });

  it('caps the sleep component after a very short night', () => {
    const r = computeReadiness(TODAY, history(60, { sleepDurationSec: 4.5 * 3600, sleepScore: 85 }));
    expect(r.readiness.components.find((c) => c.key === 'sleep')?.score).toBeLessThanOrEqual(30);
    expect(codes(r)).toContain('very_short_sleep');
  });

  it('detects a sustained HRV dip over the week', () => {
    const h = history(60).map((d) => (d.date >= addDays(TODAY, -5) ? { ...d, hrvLastNightMs: 54 } : d));
    expect(codes(computeReadiness(TODAY, h))).toContain('hrv_trend_low');
  });

  it("judges stress on yesterday's full day", () => {
    const h = history(60).map((d) => (d.date === addDays(TODAY, -1) ? { ...d, stressAvg: 45 } : d));
    const r = computeReadiness(TODAY, h);
    expect(r.readiness.components.find((c) => c.key === 'stress')?.value).toBe(45);
    expect(codes(r)).toContain('high_stress');
  });

  it('reports missing overnight data', () => {
    const h = history(60, { sleepDurationSec: null, sleepScore: null, hrvLastNightMs: null });
    const r = computeReadiness(TODAY, h);
    expect(codes(r)).toContain('missing_today_data');
    expect(r.readiness.confidence).toBeLessThan(0.5);
  });

  it('falls back to Garmin status and raw values while calibrating, with lower confidence', () => {
    const r = computeReadiness(TODAY, history(6, { hrvStatus: 'unbalanced' }));
    expect(codes(r)).toContain('calibrating');
    const hrv = r.readiness.components.find((c) => c.key === 'hrv')!;
    expect(hrv).toMatchObject({ basis: 'fallback', score: 50 });
    expect(r.readiness.components.find((c) => c.key === 'restingHr')?.basis).toBe('missing');
    expect(r.readiness.confidence).toBeLessThan(0.6);
    expect(r.readiness.score).not.toBeNull();
  });

  it('returns no score when there is essentially no data', () => {
    const r = computeReadiness(TODAY, [day(TODAY, { hrvLastNightMs: null, sleepDurationSec: null, sleepScore: null, bodyBatteryWake: null, restingHr: null })]);
    expect(r.readiness.score).toBeNull();
    expect(r.readiness.band).toBe('unknown');
  });
});
