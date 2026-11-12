import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TodayResponse } from '@coach/shared';
import { createApp } from '../src/app';
import { repositories, type Repositories } from '../src/db';
import { createTestDb, resetDb, type TestDb } from './helpers/db';

const TODAY = '2026-11-12';
const NOW = new Date('2026-11-12T07:00:00Z');
const app = createApp({ now: () => NOW });
const json = { 'content-type': 'application/json' };

let t: TestDb;
let repos: Repositories;
beforeAll(async () => {
  t = await createTestDb();
  repos = repositories(t.db);
});
afterAll(() => t.dispose());
beforeEach(() => resetDb(t.db));

async function getToday(): Promise<TodayResponse> {
  const res = await app.request('/api/today', {}, t.env);
  expect(res.status).toBe(200);
  return (await res.json()) as TodayResponse;
}

async function modify(body: unknown): Promise<{ status: number; body: TodayResponse }> {
  const res = await app.request('/api/today/modify', { method: 'POST', headers: json, body: JSON.stringify(body) }, t.env);
  return { status: res.status, body: (await res.json()) as TodayResponse };
}

async function seed(scenario: string) {
  const res = await app.request('/api/dev/mock/reset', { method: 'POST', headers: json, body: JSON.stringify({ scenario }) }, t.env);
  expect(res.status).toBe(200);
}

const count = async (table: string) => (await t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe('GET /api/today', () => {
  it('seeds mock data on first run and returns a complete Today payload', async () => {
    const body = await getToday();
    expect(body.date).toBe(TODAY);
    expect(body.garminMode).toBe('mock');
    expect(body.lastSyncAt).not.toBeNull();
    expect(body.today?.date).toBe(TODAY);
    expect(body.readiness.score).toBeGreaterThan(0);
    expect(body.readiness.components).toHaveLength(5);
    expect(body.yesterday.date).toBe('2026-11-11');
    expect(body.week.last7.sessions).toBeGreaterThan(0);
    expect(body.recommendation.workout.blocks.length).toBeGreaterThan(0);
    expect(body.recommendation.reasons[0]!.message.length).toBeGreaterThan(10);
    expect(body.recommendation.modifications).toEqual([]);
    expect(body.recommendation.original).toBeNull();
    // The demo athlete profile gives every step heart-rate and pace targets.
    const steps = body.recommendation.workout.blocks.flatMap((b) => (b.kind === 'repeat' ? b.steps : [b]));
    expect(steps.every((st) => st.target.hrBpm !== null && st.target.paceSecPerKm !== null)).toBe(true);
    expect(await count('sleep_daily')).toBe(120);
    expect(await count('daily_assessments')).toBe(1);
  });

  it('is stable: repeated loads reuse the stored recommendation', async () => {
    const first = await getToday();
    const second = await getToday();
    expect(second.recommendation.id).toBe(first.recommendation.id);
    expect(await count('recommendations')).toBe(1);
  });

  it('re-decides when new data changes the inputs', async () => {
    const first = await getToday();
    await repos.health.upsertSleep(
      [{ date: TODAY, sleepStart: null, sleepEnd: null, durationSec: 4 * 3600, deepSec: null, lightSec: null, remSec: null, awakeSec: null, score: 35, scoreQualifier: 'POOR', avgRespiration: null, avgSpo2: null, avgSleepStress: null }],
      { source: 'mock', fetchedAt: '2026-11-12T08:00:00Z' },
    );
    const second = await getToday();
    expect(second.recommendation.id).not.toBe(first.recommendation.id);
    expect(second.flags.map((f) => f.code)).toContain('very_short_sleep');
    expect(['recovery', 'rest']).toContain(second.recommendation.workout.type);
  });
});

describe('scenarios drive the recommendation', () => {
  it.each([
    ['well_rested', ['tempo', 'threshold', 'vo2max']],
    ['fatigued', ['recovery']],
    ['illness', ['rest']],
    ['calibrating', ['easy', 'recovery', 'rest', 'long']],
  ])('%s → %s', async (scenario, expected) => {
    await seed(scenario);
    const body = await getToday();
    expect(expected).toContain(body.recommendation.workout.type);
  });

  it('keeps the seeded scenario when syncing later', async () => {
    await seed('illness');
    const before = await getToday();
    await app.request('/api/sync', { method: 'POST', headers: json, body: '{}' }, t.env);
    const after = await getToday();
    expect(after.today).toEqual(before.today);
    expect(after.recommendation.workout.type).toBe('rest');
  });
});

describe('POST /api/today/modify', () => {
  it('applies a modification, keeps the lineage, and survives reloads', async () => {
    const original = await getToday();
    const { status, body } = await modify({ kind: 'time_limit', minutes: 25 });
    expect(status).toBe(200);
    expect(body.modificationResult?.applied).toBe(true);
    expect(body.recommendation.workout.durationSec).toBe(25 * 60);
    expect(body.recommendation.modifications).toEqual([
      expect.objectContaining({ kind: 'time_limit', minutes: 25 }),
    ]);
    expect(body.recommendation.original?.title).toBe(original.recommendation.workout.title);
    expect(body.recommendation.reasons).toEqual(original.recommendation.reasons);

    const reloaded = await getToday();
    expect(reloaded.recommendation.id).toBe(body.recommendation.id);
    expect(reloaded.recommendation.workout.durationSec).toBe(25 * 60);
  });

  it('chains modifications', async () => {
    await getToday();
    await modify({ kind: 'easier' });
    const { body } = await modify({ kind: 'shorter' });
    expect(body.recommendation.modifications.map((m) => m.kind)).toEqual(['easier', 'shorter']);
  });

  it('refuses "harder" when recovery says no, without changing the plan', async () => {
    await seed('fatigued');
    const before = await getToday();
    expect(before.recommendation.harder.qualityAllowed).toBe(false);
    const { body } = await modify({ kind: 'harder' });
    // recovery → easy is allowed; easy → tempo is not.
    const second = await modify({ kind: 'harder' });
    expect(body.recommendation.workout.type).toBe('easy');
    expect(second.body.modificationResult?.applied).toBe(false);
    expect(second.body.modificationResult?.reasons[0]?.code).toBe('MOD_HARDER_REFUSED');
    expect(second.body.recommendation.workout.type).toBe('easy');
  });

  it('reset returns to the engine recommendation', async () => {
    const original = await getToday();
    await modify({ kind: 'rest' });
    const res = await app.request('/api/today/reset', { method: 'POST', headers: json, body: '{}' }, t.env);
    const body = (await res.json()) as TodayResponse;
    expect(body.recommendation.id).toBe(original.recommendation.id);
    expect(body.recommendation.modifications).toEqual([]);
    expect((await getToday()).recommendation.id).toBe(original.recommendation.id);
  });

  it('validates input', async () => {
    expect((await modify({ kind: 'nap' })).status).toBe(400);
    expect((await modify({ kind: 'time_limit' })).status).toBe(400);
    expect((await modify({ kind: 'time_limit', minutes: 22.5 })).status).toBe(400);
  });
});
