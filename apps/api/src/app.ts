import { Hono } from 'hono';
import { ENGINE_VERSION, localDate } from '@coach/engine';
import type { ApiError, StatusResponse, SyncResultResponse, SyncStatusResponse } from '@coach/shared';
import { repositories } from './db';
import { clearGarminAndEngineData } from './db/maintenance';
import { SYNC_DOMAINS } from './domain/records';
import type { Env } from './env';
import { createProvider, GarminProviderError, isMockScenario } from './garmin';
import { SyncService } from './garmin/sync';

export interface AppOptions {
  /** Injectable clock for tests. */
  now?: () => Date;
}

type AppEnv = { Bindings: Env };

function apiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export function createApp(options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const app = new Hono<AppEnv>().basePath('/api');

  // CSRF guard: state-changing requests must be JSON. Browsers cannot send a
  // cross-site JSON POST without a CORS preflight, which this API never allows.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const type = c.req.header('content-type') ?? '';
      if (!type.toLowerCase().startsWith('application/json')) {
        return c.json(apiError('unsupported_media_type', 'Requests that change data must send application/json'), 415);
      }
    }
    await next();
  });

  app.get('/status', (c) => {
    const body: StatusResponse = {
      ok: true,
      service: 'coach-api',
      engineVersion: ENGINE_VERSION,
      garminMode: c.env.GARMIN_MODE === 'live' ? 'live' : 'mock',
      time: now().toISOString(),
    };
    return c.json(body);
  });

  /** Incremental sync, same as the cron job ("Sync now"). */
  app.post('/sync', async (c) => {
    const repos = repositories(c.env.DB);
    const settings = await repos.settings.get();
    const today = localDate(now(), settings.timezone);
    const result = await new SyncService(repos, createProvider(c.env, today), now).run({ trigger: 'manual', today });
    return c.json<SyncResultResponse>(result, result.status === 'error' ? 502 : 200);
  });

  app.get('/sync/status', async (c) => {
    const repos = repositories(c.env.DB);
    const [states, runs] = await Promise.all([repos.sync.getStates(), repos.sync.recentRuns(10)]);
    const body: SyncStatusResponse = {
      garminMode: c.env.GARMIN_MODE === 'live' ? 'live' : 'mock',
      domains: SYNC_DOMAINS.map((domain) => {
        const s = states.get(domain);
        return {
          domain,
          newestSyncedDate: s?.newestSyncedDate ?? null,
          oldestSyncedDate: s?.oldestSyncedDate ?? null,
          lastSuccessAt: s?.lastSuccessAt ?? null,
          lastError: s?.lastError ?? null,
          lastErrorAt: s?.lastErrorAt ?? null,
        };
      }),
      recentRuns: runs.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        counts: r.stats,
        error: r.error,
      })),
    };
    return c.json(body);
  });

  /**
   * Mock mode only: wipe Garmin + engine data and re-seed a full history for
   * a scenario (normal | well_rested | fatigued | illness | calibrating).
   */
  app.post('/dev/mock/reset', async (c) => {
    if (c.env.GARMIN_MODE !== 'mock') {
      return c.json(apiError('forbidden', 'Only available in mock mode'), 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { scenario?: unknown };
    const scenario = body.scenario ?? 'normal';
    if (!isMockScenario(scenario)) {
      return c.json(apiError('bad_request', 'Unknown scenario'), 400);
    }
    const repos = repositories(c.env.DB);
    const settings = await repos.settings.get();
    const today = localDate(now(), settings.timezone);
    await clearGarminAndEngineData(c.env.DB);
    const result = await new SyncService(repos, createProvider(c.env, today, scenario), now).run({
      trigger: 'backfill',
      today,
      historyDays: 120,
      initialDays: 120,
      backfillChunkDays: 120,
    });
    return c.json<SyncResultResponse>(result);
  });

  app.notFound((c) => c.json(apiError('not_found', 'No such endpoint'), 404));

  app.onError((err, c) => {
    if (err instanceof GarminProviderError) {
      return c.json(apiError('garmin_unavailable', err.message), 503);
    }
    console.error('Unhandled API error', err);
    return c.json(apiError('internal', 'Internal error'), 500);
  });

  return app;
}
