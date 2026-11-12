import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { repositories, type Repositories } from '../src/db';
import type { ActivityRecord, WriteMeta } from '../src/domain/records';
import { createTestDb, resetDb, type TestDb } from './helpers/db';

let t: TestDb;
let repo: Repositories;
beforeAll(async () => {
  t = await createTestDb();
  repo = repositories(t.db);
});
afterAll(() => t.dispose());
beforeEach(() => resetDb(t.db));

const META: WriteMeta = { source: 'mock', fetchedAt: '2026-11-12T07:00:00Z' };
const LATER: WriteMeta = { source: 'mock', fetchedAt: '2026-11-12T08:00:00Z' };

function activity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: 1001,
    localDate: '2026-11-11',
    startAt: '2026-11-11T06:00:00Z',
    startLocal: '2026-11-11T07:00:00',
    sport: 'running',
    garminTypeKey: 'running',
    name: 'Morning Run',
    durationSec: 2700,
    movingDurationSec: 2650,
    distanceM: 8000,
    elevationGainM: 40,
    avgHr: 142,
    maxHr: 161,
    avgSpeedMps: 2.96,
    maxSpeedMps: 3.6,
    avgPowerW: null,
    normalizedPowerW: null,
    avgCadence: 168,
    calories: 540,
    aerobicTe: 2.8,
    anaerobicTe: 0.4,
    garminLoad: 62,
    timeInZonesSec: [300, 1900, 400, 100, 0],
    rpe: null,
    hasDetails: false,
    ...overrides,
  };
}

describe('HealthRepository', () => {
  it('upserts idempotently: a re-fetched day replaces the old values', async () => {
    const sleep = {
      date: '2026-11-12',
      sleepStart: '2026-11-11T22:30:00Z',
      sleepEnd: '2026-11-12T06:10:00Z',
      durationSec: 27600,
      deepSec: 5400,
      lightSec: 15000,
      remSec: 6000,
      awakeSec: 1200,
      score: 78,
      scoreQualifier: 'FAIR',
      avgRespiration: 14.2,
      avgSpo2: null,
      avgSleepStress: 18,
      raw: { dailySleepDTO: { sleepScores: { overall: { value: 78 } } } },
    };
    await repo.health.upsertSleep([sleep], META);
    await repo.health.upsertSleep([{ ...sleep, score: 81 }], LATER);
    const rows = await t.db.prepare('SELECT score, fetched_at, raw_json FROM sleep_daily').all<{ score: number; fetched_at: string; raw_json: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.score).toBe(81);
    expect(rows.results[0]?.fetched_at).toBe(LATER.fetchedAt);
    expect(JSON.parse(rows.results[0]!.raw_json)).toEqual(sleep.raw);
  });

  it('merges domains into one row per day and keeps missing data as null', async () => {
    await repo.health.upsertDailySummaries(
      [
        { date: '2026-11-11', steps: 9000, stepGoal: 8000, distanceM: 7000, restingHr: 49, minHr: 45, maxHr: 165, activeKcal: 700, totalKcal: 2600, intensityMinModerate: 20, intensityMinVigorous: 30 },
      ],
      META,
    );
    await repo.health.upsertHrv(
      [{ date: '2026-11-12', lastNightAvgMs: 61, lastNightHighMs: 88, weeklyAvgMs: 58, baselineLowMs: 50, baselineHighMs: 66, status: 'balanced' }],
      META,
    );
    await repo.health.upsertBodyBattery(
      [{ date: '2026-11-12', charged: 60, drained: 0, highest: 82, lowest: 25, atWake: 80, endOfDay: null }],
      META,
    );
    const days = await repo.health.getDailyMetrics('2026-11-01', '2026-11-30');
    expect(days.map((d) => d.date)).toEqual(['2026-11-11', '2026-11-12']);
    expect(days[0]).toMatchObject({ restingHr: 49, steps: 9000, hrvLastNightMs: null, bodyBatteryWake: null });
    expect(days[1]).toMatchObject({ restingHr: null, hrvLastNightMs: 61, hrvStatus: 'balanced', bodyBatteryWake: 80, sleepScore: null });
  });

  it('round-trips intraday series with gaps', async () => {
    await repo.health.upsertIntraday(
      [{ date: '2026-11-12', metric: 'heart_rate', startAt: '2026-11-11T23:00:00Z', intervalSec: 120, samples: [52, 51, null, 50] }],
      META,
    );
    expect(await repo.health.getIntraday('2026-11-12', 'heart_rate')).toEqual({
      date: '2026-11-12',
      metric: 'heart_rate',
      startAt: '2026-11-11T23:00:00Z',
      intervalSec: 120,
      samples: [52, 51, null, 50],
    });
    expect(await repo.health.getIntraday('2026-11-12', 'stress')).toBeNull();
  });
});

describe('ActivityRepository', () => {
  it('round-trips an activity including zone times', async () => {
    await repo.activities.upsertMany([{ ...activity(), raw: { activityId: 1001 } }], META);
    expect(await repo.activities.getById(1001)).toEqual(activity());
  });

  it('keeps user-entered RPE and detail flag when the provider re-syncs', async () => {
    await repo.activities.upsertMany([activity()], META);
    await t.db.prepare('UPDATE activities SET rpe = 6 WHERE id = 1001').run();
    await repo.activities.upsertDetails(
      { activityId: 1001, laps: [{ index: 0, startOffsetSec: 0, durationSec: 2700, distanceM: 8000, avgHr: 142, maxHr: 161, avgSpeedMps: 2.96 }], streams: null, fitObjectKey: null, fitSizeBytes: null },
      META,
    );
    await repo.activities.upsertMany([activity({ name: 'Renamed run' })], LATER);
    const a = await repo.activities.getById(1001);
    expect(a).toMatchObject({ name: 'Renamed run', rpe: 6, hasDetails: true });
  });

  it('returns null zone times unless all five zones are known', async () => {
    await repo.activities.upsertMany([activity({ timeInZonesSec: null })], META);
    expect((await repo.activities.getById(1001))?.timeInZonesSec).toBeNull();
  });

  it('lists by local date range and finds activities still missing details', async () => {
    await repo.activities.upsertMany(
      [
        activity({ id: 1, localDate: '2026-11-01', startAt: '2026-11-01T06:00:00Z' }),
        activity({ id: 2, localDate: '2026-11-05', startAt: '2026-11-05T06:00:00Z' }),
        activity({ id: 3, localDate: '2026-11-09', startAt: '2026-11-09T06:00:00Z' }),
      ],
      META,
    );
    await repo.activities.upsertDetails({ activityId: 2, laps: null, streams: { t: [0, 10], hr: [120, 125] }, fitObjectKey: null, fitSizeBytes: null }, META);
    expect((await repo.activities.listBetween('2026-11-02', '2026-11-09')).map((a) => a.id)).toEqual([2, 3]);
    expect(await repo.activities.idsMissingDetails('2026-11-01', '2026-11-30')).toEqual([1, 3]);
    expect((await repo.activities.getDetails(2))?.streams).toEqual({ t: [0, 10], hr: [120, 125] });
  });

  it('cascades details when an activity is deleted', async () => {
    await repo.activities.upsertMany([activity()], META);
    await repo.activities.upsertDetails({ activityId: 1001, laps: [], streams: null, fitObjectKey: null, fitSizeBytes: null }, META);
    await t.db.prepare('DELETE FROM activities WHERE id = 1001').run();
    expect(await repo.activities.getDetails(1001)).toBeNull();
  });
});

describe('SettingsRepository', () => {
  it('returns defaults, applies partial updates and replaces zones', async () => {
    const defaults = await repo.settings.get();
    expect(defaults).toMatchObject({ timezone: 'UTC', preferredDurationMin: 45, availableDays: [1, 2, 3, 4, 5, 6, 7], hrZones: [] });

    await repo.settings.update({ timezone: 'Europe/Helsinki', availableDays: [1, 3, 5, 6], maxHr: 188 }, '2026-11-12T07:00:00Z');
    await repo.settings.replaceZones(
      'hr',
      [
        { zone: 1, name: 'Recovery', min: 0, max: 128 },
        { zone: 2, name: 'Aerobic', min: 129, max: 146 },
      ],
      '2026-11-12T07:00:00Z',
    );
    const s = await repo.settings.get();
    expect(s).toMatchObject({ timezone: 'Europe/Helsinki', availableDays: [1, 3, 5, 6], maxHr: 188, preferredDurationMin: 45 });
    expect(s.hrZones.map((z) => z.name)).toEqual(['Recovery', 'Aerobic']);
  });

  it('enforces preferred ≤ max duration', async () => {
    await expect(repo.settings.update({ preferredDurationMin: 120, maxDurationMin: 60 }, '2026-11-12T07:00:00Z')).rejects.toThrow(/CHECK/);
  });
});

describe('SyncRepository', () => {
  it('widens the synced window and clears errors on success', async () => {
    await repo.sync.markSuccess('sleep', '2026-11-01', '2026-11-10', '2026-11-10T07:00:00Z');
    await repo.sync.markError('sleep', 'HTTP 503', '2026-11-11T07:00:00Z');
    expect((await repo.sync.getStates()).get('sleep')).toMatchObject({ lastError: 'HTTP 503', newestSyncedDate: '2026-11-10' });

    await repo.sync.markSuccess('sleep', '2026-11-08', '2026-11-12', '2026-11-12T07:00:00Z');
    expect((await repo.sync.getStates()).get('sleep')).toEqual({
      domain: 'sleep',
      newestSyncedDate: '2026-11-12',
      oldestSyncedDate: '2026-11-01',
      lastSuccessAt: '2026-11-12T07:00:00Z',
      lastError: null,
      lastErrorAt: null,
    });
  });

  it('records sync runs newest first', async () => {
    const id = await repo.sync.startRun('manual', 'mock', { from: '2026-11-01', to: '2026-11-12' }, '2026-11-12T07:00:00Z');
    await repo.sync.finishRun(id, 'success', { sleep: 12 }, null, '2026-11-12T07:00:05Z');
    await repo.sync.startRun('cron', 'mock', { from: '2026-11-10', to: '2026-11-12' }, '2026-11-12T08:00:00Z');
    const runs = await repo.sync.recentRuns();
    expect(runs.map((r) => r.status)).toEqual(['running', 'success']);
    expect(runs[1]).toMatchObject({ trigger: 'manual', stats: { sleep: 12 }, finishedAt: '2026-11-12T07:00:05Z' });
  });
});
