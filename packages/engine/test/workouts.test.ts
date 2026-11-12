import { describe, expect, it } from 'vitest';
import { buildWorkout, totalDurationSec, WORKOUT_TYPES, type RepeatBlock, type WorkoutStep } from '../src/workouts';
import { resolveZones } from '../src/zones';
import { settings } from './fixtures';

const zones = resolveZones(settings(), 2026);
const ctx = { zones, modality: 'run' as const };

describe('workout builder', () => {
  it.each(WORKOUT_TYPES.filter((t) => t !== 'rest'))('%s fills the requested time (50 min, capped for mobility/recovery)', (type) => {
    const w = buildWorkout(type, 50, ctx);
    expect(w.durationSec).toBe(type === 'mobility' ? 45 * 60 : type === 'recovery' ? 40 * 60 : 50 * 60);
    expect(totalDurationSec(w.blocks)).toBe(w.durationSec);
  });

  it('builds warm-up, main set and cool-down for an easy run with HR and pace targets', () => {
    const w = buildWorkout('easy', 45, ctx);
    expect(w.blocks.map((b) => b.kind)).toEqual(['warmup', 'main', 'cooldown']);
    const main = w.blocks[1] as WorkoutStep;
    expect(main.durationSec).toBe(30 * 60);
    expect(main.target).toMatchObject({ zone: 2, hrBpm: [113, 131], rpe: [3, 4] });
    expect(main.target.paceSecPerKm).toEqual([311, 351]);
    expect(w.summary).toContain('Zone 2 (113–131 bpm)');
  });

  it('builds repeat blocks with recovery intervals', () => {
    const w = buildWorkout('vo2max', 50, ctx);
    const rep = w.blocks[1] as RepeatBlock;
    expect(rep.kind).toBe('repeat');
    expect(rep.times).toBe(4);
    expect(rep.steps.map((s) => [s.kind, s.durationSec / 60, s.target.zone])).toEqual([
      ['work', 3, 5],
      ['recovery', 3, 1],
    ]);
    expect(w.intensity).toBe('very_hard');
    expect(w.summary).toMatch(/^4 × 3 min in Zone 5/);
  });

  it('keeps threshold sessions sensible when time is short', () => {
    const w = buildWorkout('threshold', 35, ctx);
    expect(w.durationSec).toBe(35 * 60);
    expect((w.blocks[1] as RepeatBlock).times).toBe(2);
  });

  it('drops pace targets for other modalities and adds the cycling HR note', () => {
    const w = buildWorkout('easy', 45, { zones, modality: 'bike' });
    expect((w.blocks[1] as WorkoutStep).target.paceSecPerKm).toBeNull();
    expect(w.title).toBe('Easy aerobic ride');
    expect(w.notes.join(' ')).toMatch(/Cycling heart rate/);
  });

  it('falls back to RPE when no HR zones are known', () => {
    const w = buildWorkout('tempo', 45, { zones: resolveZones(settings({ maxHr: null, thresholdPaceSecPerKm: null }), 2026), modality: 'run' });
    const work = w.blocks[1] as WorkoutStep;
    expect(work.target).toMatchObject({ hrBpm: null, paceSecPerKm: null, rpe: [5, 6] });
    expect(w.notes.join(' ')).toMatch(/Set your max HR/);
  });

  it('represents rest as an empty plan', () => {
    const w = buildWorkout('rest', 0, ctx);
    expect(w).toMatchObject({ type: 'rest', durationSec: 0, blocks: [], modality: 'none', intensity: 'rest' });
  });
});
