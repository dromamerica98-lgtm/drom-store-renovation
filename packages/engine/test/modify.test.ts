import { describe, expect, it } from 'vitest';
import { applyModification, assessDay } from '../src/assess';
import type { RepeatBlock } from '../src/workouts';
import { history, settings, TODAY, trainingWeeks } from './fixtures';

const s = settings();
const fresh = assessDay({ date: TODAY, metrics: history(60, { hrvLastNightMs: 66, sleepScore: 86, bodyBatteryWake: 85 }), activities: trainingWeeks(8), settings: s });
const tired = assessDay({ date: TODAY, metrics: history(60, { hrvLastNightMs: 52, sleepDurationSec: 6.5 * 3600 }), activities: trainingWeeks(8), settings: s });
const mod = (a: typeof fresh, w = a.recommendation.workout, kind: Parameters<typeof applyModification>[2]['kind'], minutes?: number) =>
  applyModification(a, w, minutes === undefined ? { kind } : { kind, minutes }, s);

describe('modifications', () => {
  it('fresh day starts as tempo (fixture sanity)', () => {
    expect(fresh.recommendation.workout.type).toBe('tempo');
    expect(fresh.recommendation.harder.qualityAllowed).toBe(true);
  });

  it('shorter: cuts ~30 % but never below the useful minimum', () => {
    const r = mod(fresh, undefined, 'shorter');
    expect(r.applied).toBe(true);
    expect(r.workout.type).toBe('tempo');
    expect(r.workout.durationSec).toBe(35 * 60);
    const again = mod(fresh, r.workout, 'shorter');
    expect(again.applied).toBe(false);
    expect(again.reasons[0]!.code).toBe('MOD_ALREADY_MINIMAL');
  });

  it('easier: steps down one level at a time to rest', () => {
    const chain = ['vo2max', 'threshold', 'tempo', 'easy', 'recovery', 'rest'];
    let w = applyModification(fresh, fresh.recommendation.workout, { kind: 'harder' }, s).workout; // tempo → threshold
    w = applyModification(fresh, w, { kind: 'harder' }, s).workout; // threshold → vo2max (readiness ≥ 75)
    expect(w.type).toBe('vo2max');
    const seen = [w.type];
    for (let i = 0; i < 5; i++) {
      w = applyModification(fresh, w, { kind: 'easier' }, s).workout;
      seen.push(w.type);
    }
    expect(seen).toEqual(chain);
    expect(applyModification(fresh, w, { kind: 'easier' }, s).applied).toBe(false);
  });

  it('harder: refused on a tired day, with the blocking reasons', () => {
    expect(tired.recommendation.workout.type).not.toBe('tempo');
    const easy = tired.recommendation.workout.type === 'easy' ? tired.recommendation.workout : mod(tired, undefined, 'harder').workout;
    const r = mod(tired, easy, 'harder');
    expect(r.applied).toBe(false);
    expect(r.workout).toBe(easy);
    expect(r.reasons[0]!.code).toBe('MOD_HARDER_REFUSED');
    expect(r.reasons.map((x) => x.code)).toContain('READINESS_TOO_LOW');
  });

  it('harder: refused after illness signals, even from rest', () => {
    const sick = assessDay({ date: TODAY, metrics: history(60, { restingHr: 57, hrvLastNightMs: 41 }), activities: trainingWeeks(8), settings: s });
    expect(sick.recommendation.workout.type).toBe('rest');
    const r = mod(sick, undefined, 'harder');
    expect(r.applied).toBe(false);
    expect(r.reasons.map((x) => x.code)).toContain('ILLNESS_PATTERN');
  });

  it('time limit: fits the session, converting quality to easy when it cannot fit', () => {
    const r40 = mod(fresh, undefined, 'time_limit', 40);
    expect(r40.workout).toMatchObject({ type: 'tempo', durationSec: 40 * 60 });
    const r25 = mod(fresh, undefined, 'time_limit', 25);
    expect(r25.workout).toMatchObject({ type: 'easy', durationSec: 25 * 60 });
    expect(r25.reasons[0]!.message).toMatch(/doesn't fit/);
    expect(mod(fresh, undefined, 'time_limit', 15).workout.type).toBe('recovery');
    expect(mod(fresh, undefined, 'time_limit', 5).applied).toBe(false);
    expect(mod(fresh, undefined, 'time_limit', 120).reasons[0]!.code).toBe('MOD_ALREADY_FITS');
  });

  it('rest and alternative', () => {
    const rest = mod(fresh, undefined, 'rest');
    expect(rest.workout.type).toBe('rest');
    const alt = mod(fresh, undefined, 'alternative');
    expect(alt.workout).toMatchObject({ type: 'tempo', modality: 'bike', durationSec: fresh.recommendation.workout.durationSec });
    expect(mod(fresh, alt.workout, 'alternative').workout.modality).toBe('elliptical');
    expect(mod(fresh, rest.workout, 'alternative').workout.type).toBe('mobility');
  });

  it('interval structure shrinks rather than disappears when shortened', () => {
    const vo2 = applyModification(fresh, mod(fresh, undefined, 'harder').workout, { kind: 'harder' }, s).workout;
    const shorter = mod(fresh, vo2, 'shorter').workout;
    const workSec = (w: typeof vo2) => {
      const r = w.blocks[1] as RepeatBlock;
      return r.times * r.steps[0]!.durationSec;
    };
    expect((shorter.blocks[1] as RepeatBlock).kind).toBe('repeat');
    expect(workSec(shorter)).toBeLessThan(workSec(vo2));
    expect(shorter.durationSec).toBeLessThan(vo2.durationSec);
  });
});
