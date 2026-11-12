import { describe, expect, it } from 'vitest';
import { addDays } from '@coach/engine';
import { MockGarminProvider } from '../src/garmin';

const TODAY = '2026-11-12';
const all = { from: '2025-01-01', to: '2030-01-01' };

describe('MockGarminProvider', () => {
  it('is deterministic for the same options', async () => {
    const a = new MockGarminProvider({ today: TODAY });
    const b = new MockGarminProvider({ today: TODAY });
    expect(await a.sleep({ from: '2026-10-01', to: TODAY })).toEqual(await b.sleep({ from: '2026-10-01', to: TODAY }));
    expect(await a.activities({ from: '2026-10-01', to: TODAY })).toEqual(await b.activities({ from: '2026-10-01', to: TODAY }));
  });

  it('keeps past days stable as "today" moves forward', async () => {
    const range = { from: '2026-09-01', to: '2026-10-31' };
    const before = new MockGarminProvider({ today: TODAY });
    const after = new MockGarminProvider({ today: addDays(TODAY, 9) });
    expect(await after.hrv(range)).toEqual(await before.hrv(range));
  });

  it('never returns future data or activities for today', async () => {
    const p = new MockGarminProvider({ today: TODAY });
    const sleep = await p.sleep(all);
    expect(sleep.at(-1)?.date).toBe(TODAY);
    const activities = await p.activities(all);
    expect(activities.every((a) => a.localDate < TODAY)).toBe(true);
  });

  it('produces plausible values', async () => {
    const p = new MockGarminProvider({ today: TODAY });
    const range = { from: addDays(TODAY, -60), to: TODAY };
    for (const s of await p.sleep(range)) {
      expect(s.durationSec).toBeGreaterThan(4 * 3600);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect((s.deepSec ?? 0) + (s.lightSec ?? 0) + (s.remSec ?? 0)).toBe(s.durationSec);
    }
    for (const a of await p.activities(range)) {
      const zones = a.timeInZonesSec!;
      expect(zones.reduce((x, y) => x + y, 0)).toBeCloseTo(a.durationSec, -1);
      expect(a.avgHr).toBeGreaterThan(90);
    }
    const weekly = (await p.activities({ from: addDays(TODAY, -27), to: TODAY })).length / 4;
    expect(weekly).toBeGreaterThanOrEqual(3);
    expect(weekly).toBeLessThanOrEqual(8);
  });

  it('scenarios shift today in the expected direction', async () => {
    const today = { from: TODAY, to: TODAY };
    const get = async (scenario: 'normal' | 'fatigued' | 'illness' | 'well_rested') => {
      const p = new MockGarminProvider({ today: TODAY, scenario });
      return {
        hrv: (await p.hrv(today))[0]!.lastNightAvgMs!,
        rhr: (await p.dailySummaries(today))[0]!.restingHr!,
        bb: (await p.bodyBattery(today))[0]!.atWake!,
      };
    };
    const normal = await get('normal');
    const fatigued = await get('fatigued');
    const ill = await get('illness');
    const rested = await get('well_rested');
    expect(fatigued.hrv).toBeLessThan(normal.hrv);
    expect(fatigued.bb).toBeLessThan(normal.bb);
    expect(ill.rhr).toBeGreaterThanOrEqual(normal.rhr + 5);
    expect(ill.hrv).toBeLessThan(fatigued.hrv);
    expect(rested.bb).toBeGreaterThan(normal.bb);
  });

  it('fatigued scenario stacks hard sessions over the last four days', async () => {
    const p = new MockGarminProvider({ today: TODAY, scenario: 'fatigued' });
    const recent = await p.activities({ from: addDays(TODAY, -4), to: addDays(TODAY, -1) });
    expect(recent.map((a) => a.name)).toEqual(['Intervals', 'Tempo Run', 'Long Run', 'Intervals']);
  });

  it('calibrating scenario exposes only a week of history', async () => {
    const p = new MockGarminProvider({ today: TODAY, scenario: 'calibrating' });
    const days = await p.sleep(all);
    expect(days).toHaveLength(7);
    expect(days[0]?.date).toBe(addDays(TODAY, -6));
  });

  it('builds activity details and intraday curves', async () => {
    const p = new MockGarminProvider({ today: TODAY });
    const [run] = (await p.activities({ from: addDays(TODAY, -7), to: TODAY })).filter((a) => a.sport === 'running');
    const details = await p.activityDetails(run!.id);
    expect(details?.streams?.t.length).toBe(details?.streams?.hr?.length);
    expect(details?.laps?.length).toBeGreaterThan(3);
    expect(await p.activityDetails(123)).toBeNull();

    const curves = await p.intraday(TODAY);
    expect(curves.map((c) => [c.metric, c.samples.length])).toEqual([
      ['heart_rate', 720],
      ['stress', 480],
      ['body_battery', 480],
    ]);
  });
});
