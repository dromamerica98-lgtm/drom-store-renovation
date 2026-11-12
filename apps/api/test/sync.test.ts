import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SyncResultResponse, SyncStatusResponse } from '@coach/shared';
import { createApp } from '../src/app';
import { repositories, type Repositories } from '../src/db';
import { MockGarminProvider, type GarminProvider } from '../src/garmin';
import { chunkRange, planWindows, SyncService } from '../src/garmin/sync';
import { createTestDb, resetDb, type TestDb } from './helpers/db';

const TODAY = '2026-11-12';
const NOW = new Date('2026-11-12T07:00:00Z');
const clock = () => NOW;

let t: TestDb;
let repos: Repositories;
beforeAll(async () => {
  t = await createTestDb();
  repos = repositories(t.db);
});
afterAll(() => t.dispose());
beforeEach(() => resetDb(t.db));

const count = async (table: string) =>
  (await t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const defaults = {
  today: TODAY,
  overlapDays: 3,
  initialDays: 14,
  historyDays: 180,
  backfillChunkDays: 28,
  maxDetailFetches: 10,
  detailLookbackDays: 14,
  intradayDays: 2,
};

describe('window planning', () => {
  it('chunks ranges newest first', () => {
    expect(chunkRange({ from: '2026-11-01', to: '2026-11-12' }, 5)).toEqual([
      { from: '2026-11-08', to: '2026-11-12' },
      { from: '2026-11-03', to: '2026-11-07' },
      { from: '2026-11-01', to: '2026-11-02' },
    ]);
  });

  it('first sync: recent window plus one backfill chunk', () => {
    expect(planWindows(undefined, defaults)).toEqual([
      { from: '2026-10-30', to: '2026-11-12' },
      { from: '2026-10-02', to: '2026-10-29' },
    ]);
  });

  it('later syncs: overlap re-fetch and continued backfill', () => {
    const state = {
      domain: 'sleep' as const,
      newestSyncedDate: '2026-11-11',
      oldestSyncedDate: '2026-10-02',
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    expect(planWindows(state, defaults)).toEqual([
      { from: '2026-11-08', to: '2026-11-12' },
      { from: '2026-09-04', to: '2026-10-01' },
    ]);
  });

  it('stops backfilling once the history target is reached', () => {
    const state = {
      domain: 'sleep' as const,
      newestSyncedDate: TODAY,
      oldestSyncedDate: '2026-05-17',
      lastSuccessAt: null,
      lastError: null,
      lastErrorAt: null,
    };
    expect(planWindows(state, defaults)).toEqual([{ from: '2026-11-09', to: '2026-11-12' }]);
  });
});

describe('SyncService', () => {
  it('syncs every domain into D1 and records the run', async () => {
    const result = await new SyncService(repos, new MockGarminProvider({ today: TODAY }), clock).run({ trigger: 'manual', today: TODAY });
    expect(result.status).toBe('success');
    expect(result.counts.sleep).toBe(42); // 14-day window + 28-day backfill chunk
    expect(await count('sleep_daily')).toBe(42);
    expect(await count('hrv_daily')).toBe(42);
    expect(await count('activities')).toBe(result.counts.activities);
    expect(result.counts.activity_details).toBeGreaterThan(0);
    expect(result.counts.activity_details).toBeLessThanOrEqual(10);
    expect(result.counts.intraday).toBe(6);

    const state = (await repos.sync.getStates()).get('sleep');
    expect(state).toMatchObject({ newestSyncedDate: TODAY, oldestSyncedDate: '2026-10-02', lastError: null });
    const [run] = await repos.sync.recentRuns(1);
    expect(run).toMatchObject({ status: 'success', trigger: 'manual', provider: 'mock' });
  });

  it('is idempotent and extends history on the next run', async () => {
    const service = new SyncService(repos, new MockGarminProvider({ today: TODAY }), clock);
    await service.run({ trigger: 'manual', today: TODAY });
    const sleepBefore = await repos.health.getDailyMetrics('2026-10-02', TODAY);
    await service.run({ trigger: 'cron', today: TODAY });
    expect(await count('sleep_daily')).toBe(70); // +28 days of backfill, no duplicates
    expect(await repos.health.getDailyMetrics('2026-10-02', TODAY)).toEqual(sleepBefore);
  });

  it('isolates a failing domain and reports a partial run', async () => {
    const provider = new MockGarminProvider({ today: TODAY });
    const flaky: GarminProvider = Object.assign(Object.create(provider), {
      hrv: async () => {
        throw new Error('HTTP 503 from hrv-service');
      },
    });
    const result = await new SyncService(repos, flaky, clock).run({ trigger: 'cron', today: TODAY });
    expect(result.status).toBe('partial');
    expect(result.errors).toEqual([{ domain: 'hrv', message: 'HTTP 503 from hrv-service' }]);
    expect(await count('hrv_daily')).toBe(0);
    expect(await count('sleep_daily')).toBe(42);
    expect((await repos.sync.getStates()).get('hrv')?.lastError).toBe('HTTP 503 from hrv-service');
  });

  it('caps activity-detail fetches per run and catches up later', async () => {
    const service = new SyncService(repos, new MockGarminProvider({ today: TODAY }), clock);
    const first = await service.run({ trigger: 'manual', today: TODAY, maxDetailFetches: 2 });
    expect(first.counts.activity_details).toBe(2);
    const missingAfterFirst = (await repos.activities.idsMissingDetails('2026-10-30', TODAY)).length;
    const second = await service.run({ trigger: 'manual', today: TODAY, maxDetailFetches: 2 });
    expect(second.counts.activity_details).toBe(2);
    expect((await repos.activities.idsMissingDetails('2026-10-30', TODAY)).length).toBe(missingAfterFirst - 2);
  });
});

describe('sync routes', () => {
  const app = createApp({ now: clock });
  const json = { 'content-type': 'application/json' };

  it('POST /api/sync runs an incremental sync', async () => {
    const res = await app.request('/api/sync', { method: 'POST', headers: json, body: '{}' }, t.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncResultResponse;
    expect(body.status).toBe('success');
    expect(body.counts.sleep).toBe(42);
  });

  it('rejects non-JSON writes (CSRF guard)', async () => {
    const res = await app.request('/api/sync', { method: 'POST', body: 'x' }, t.env);
    expect(res.status).toBe(415);
  });

  it('GET /api/sync/status lists every domain and recent runs', async () => {
    await app.request('/api/sync', { method: 'POST', headers: json, body: '{}' }, t.env);
    const body = (await (await app.request('/api/sync/status', {}, t.env)).json()) as SyncStatusResponse;
    expect(body.domains.map((d) => d.domain)).toContain('activity_details');
    expect(body.domains.find((d) => d.domain === 'sleep')?.newestSyncedDate).toBe(TODAY);
    expect(body.recentRuns[0]?.status).toBe('success');
  });

  it('POST /api/dev/mock/reset re-seeds 120 days for a scenario', async () => {
    const res = await app.request('/api/dev/mock/reset', { method: 'POST', headers: json, body: '{"scenario":"fatigued"}' }, t.env);
    expect(res.status).toBe(200);
    expect(await count('sleep_daily')).toBe(120);
    const bad = await app.request('/api/dev/mock/reset', { method: 'POST', headers: json, body: '{"scenario":"zombie"}' }, t.env);
    expect(bad.status).toBe(400);
  });

  it('refuses the dev reset outside mock mode', async () => {
    const res = await app.request('/api/dev/mock/reset', { method: 'POST', headers: json, body: '{}' }, { ...t.env, GARMIN_MODE: 'live' });
    expect(res.status).toBe(403);
  });
});
