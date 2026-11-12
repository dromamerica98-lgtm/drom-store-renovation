import type { IsoDate } from '@coach/engine';
import type { Repositories } from '../db';
import { clearGarminAndEngineData } from '../db/maintenance';
import type { Env } from '../env';
import { MockGarminProvider } from './mock/provider';
import { isMockScenario, MOCK_ATHLETE, type MockScenario } from './mock/simulate';
import { GarminProviderError, type GarminProvider } from './provider';
import { SyncService, type SyncResult } from './sync';

export { GarminProviderError, MockGarminProvider };
export type { GarminProvider };
export { MOCK_SCENARIOS, isMockScenario, type MockScenario } from './mock/simulate';

/**
 * The provider for this environment. In mock mode the scenario is the one the
 * stored data was seeded with (app_state), so later syncs stay consistent.
 */
export async function providerFor(repos: Repositories, env: Env, today: IsoDate): Promise<GarminProvider> {
  if (env.GARMIN_MODE !== 'mock') return createProvider(env, today);
  const stored = await repos.appState.get('mock_scenario');
  return createProvider(env, today, isMockScenario(stored) ? stored : undefined);
}

/**
 * Chooses the provider from configuration. `scenarioOverride` lets local
 * development switch mock scenarios per request.
 */
export function createProvider(env: Env, today: IsoDate, scenarioOverride?: MockScenario): GarminProvider {
  if (env.GARMIN_MODE === 'live') {
    // Stage 6: LiveGarminProvider (Personal API key → 24 h token → GET endpoints).
    throw new GarminProviderError('Live Garmin mode is not implemented yet (Stage 6). Set GARMIN_MODE=mock.');
  }
  const scenario = scenarioOverride ?? (isMockScenario(env.MOCK_SCENARIO) ? env.MOCK_SCENARIO : 'normal');
  return new MockGarminProvider({ today, scenario });
}

/** Days of history seeded in mock mode. */
export const MOCK_HISTORY_DAYS = 120;

/**
 * Mock mode only: wipe Garmin + engine data and load a full history for a
 * scenario in one go (no gradual backfill needed for synthetic data).
 */
export async function seedMockData(
  repos: Repositories,
  env: Env,
  today: IsoDate,
  now: () => Date,
  scenario?: MockScenario,
  db: D1Database = env.DB,
): Promise<SyncResult> {
  if (env.GARMIN_MODE !== 'mock') throw new GarminProviderError('Seeding is only available in mock mode.');
  const chosen = scenario ?? (isMockScenario(env.MOCK_SCENARIO) ? env.MOCK_SCENARIO : 'normal');
  const stamp = now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await clearGarminAndEngineData(db);
  await repos.appState.set('mock_scenario', chosen, stamp);
  // Give the demo athlete a physiology so workouts show HR and pace targets.
  // Only fills fields the user has not set.
  const settings = await repos.settings.get();
  await repos.settings.update(
    {
      maxHr: settings.maxHr ?? MOCK_ATHLETE.maxHr,
      thresholdPaceSecPerKm: settings.thresholdPaceSecPerKm ?? MOCK_ATHLETE.thresholdPaceSecPerKm,
      longSessionDay: settings.longSessionDay ?? 7,
    },
    stamp,
  );
  return new SyncService(repos, createProvider(env, today, chosen), now).run({
    trigger: 'backfill',
    today,
    historyDays: MOCK_HISTORY_DAYS,
    initialDays: MOCK_HISTORY_DAYS,
    backfillChunkDays: MOCK_HISTORY_DAYS,
  });
}
