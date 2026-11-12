import { describe, expect, it } from 'vitest';
import { assessDay, inputsHash } from '../src/assess';
import { addDays } from '../src/dates';
import { history, run, settings, TODAY, trainingWeeks } from './fixtures';

const input = () => ({ date: TODAY, metrics: history(60), activities: trainingWeeks(8), settings: settings() });

describe('assessDay', () => {
  it('is deterministic: same input, same output', () => {
    expect(assessDay(input())).toEqual(assessDay(input()));
  });

  it('does not depend on input order', () => {
    const a = input();
    const b = { ...a, metrics: [...a.metrics].reverse(), activities: [...a.activities].reverse() };
    expect(assessDay(b)).toEqual(assessDay(a));
  });

  it('fingerprints inputs: changes when data changes, not when today’s training is added', () => {
    const base = inputsHash(input());
    const changed = input();
    changed.metrics = changed.metrics.map((m) => (m.date === TODAY ? { ...m, sleepScore: 50 } : m));
    expect(inputsHash(changed)).not.toBe(base);
    const withToday = input();
    withToday.activities = [...withToday.activities, run(TODAY, 'easy')];
    expect(inputsHash(withToday)).toBe(base);
    expect(assessDay(withToday).recommendation).toEqual(assessDay(input()).recommendation);
  });

  it('exposes everything the Today screen needs', () => {
    const a = assessDay(input());
    expect(a.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(a.readiness.components.map((c) => c.key)).toEqual(['hrv', 'sleep', 'restingHr', 'bodyBattery', 'stress']);
    expect(a.load.yesterday.date).toBe(addDays(TODAY, -1));
    expect(a.load.last7.sessions).toBeGreaterThan(0);
    expect(a.recommendation.workout.blocks.length).toBeGreaterThan(0);
    expect(a.recommendation.harder).toHaveProperty('qualityAllowed');
  });
});
