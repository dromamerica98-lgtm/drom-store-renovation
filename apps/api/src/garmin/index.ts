import type { IsoDate } from '@coach/engine';
import type { Env } from '../env';
import { MockGarminProvider } from './mock/provider';
import { isMockScenario, type MockScenario } from './mock/simulate';
import { GarminProviderError, type GarminProvider } from './provider';

export { GarminProviderError, MockGarminProvider };
export type { GarminProvider };
export { MOCK_SCENARIOS, isMockScenario, type MockScenario } from './mock/simulate';

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
