import { Hono } from 'hono';
import { ENGINE_VERSION, localDate, MODIFICATION_KINDS, type ModificationRequest } from '@coach/engine';
import type { ApiError, StatusResponse, SyncResultResponse, SyncStatusResponse, TodayResponse } from '@coach/shared';
import { AccessDenied, isLocalDevBypass, verifyAccessJwt } from './auth/access';
import { repositories } from './db';
import { SYNC_DOMAINS } from './domain/records';
import type { Env } from './env';
import { GarminProviderError, isMockScenario, providerFor, seedMockData } from './garmin';
import { SyncService } from './garmin/sync';
import { sanitizeMessage } from './security';
import { TodayService } from './services/today';

export interface AppOptions {
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable fetch for the Access key set (tests). */
  accessFetcher?: (url: string) => Promise<Response>;
}

type AppEnv = { Bindings: Env };

function apiError(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export function createApp(options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const app = new Hono<AppEnv>().basePath('/api');

  // Personal health data: never stored by the browser, the service worker or
  // any intermediary.
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store, private');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
  });

  // Authentication: a valid Cloudflare Access JWT for the owner on every
  // request, in addition to Access at the edge. Fails closed.
  app.use('*', async (c, next) => {
    if (isLocalDevBypass(c.req.url, c.env.ACCESS_DEV_BYPASS)) return next();
    try {
      await verifyAccessJwt(
        c.req.header('cf-access-jwt-assertion'),
        { teamDomain: c.env.ACCESS_TEAM_DOMAIN ?? '', audience: c.env.ACCESS_AUD ?? '', ownerEmail: c.env.OWNER_EMAIL ?? '' },
        { now: () => now().getTime(), ...(options.accessFetcher ? { fetcher: options.accessFetcher } : {}) },
      );
    } catch (e) {
      if (e instanceof AccessDenied) {
        console.warn('API request rejected', { reason: e.reason, path: new URL(c.req.url).pathname });
        return c.json(apiError('unauthorized', 'Sign in required'), 401);
      }
      throw e;
    }
    return next();
  });

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
    const result = await new SyncService(repos, await providerFor(repos, c.env, today), now).run({ trigger: 'manual', today });
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
    const result = await seedMockData(repos, c.env, localDate(now(), settings.timezone), now, scenario);
    return c.json<SyncResultResponse>(result);
  });

  // --- Today ---------------------------------------------------------------

  app.get('/today', async (c) => {
    const body = await new TodayService(repositories(c.env.DB), c.env, now).get();
    return c.json<TodayResponse>(body);
  });

  app.post('/today/modify', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { kind?: unknown; minutes?: unknown } | null;
    const kind = body?.kind;
    if (typeof kind !== 'string' || !(MODIFICATION_KINDS as readonly string[]).includes(kind)) {
      return c.json(apiError('bad_request', `kind must be one of: ${MODIFICATION_KINDS.join(', ')}`), 400);
    }
    const request: ModificationRequest = { kind: kind as ModificationRequest['kind'] };
    if (kind === 'time_limit') {
      const minutes = body?.minutes;
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
        return c.json(apiError('bad_request', 'minutes must be an integer between 5 and 600'), 400);
      }
      request.minutes = minutes;
    }
    const result = await new TodayService(repositories(c.env.DB), c.env, now).modify(request);
    return c.json<TodayResponse>(result);
  });

  app.post('/today/reset', async (c) => {
    const body = await new TodayService(repositories(c.env.DB), c.env, now).reset();
    return c.json<TodayResponse>(body);
  });

  app.notFound((c) => c.json(apiError('not_found', 'No such endpoint'), 404));

  app.onError((err, c) => {
    if (err instanceof GarminProviderError) {
      return c.json(apiError('garmin_unavailable', sanitizeMessage(err.message)), 503);
    }
    // Log the type and a sanitized message only — never request bodies, headers or secrets.
    console.error('Unhandled API error', { name: err.name, message: sanitizeMessage(err.message) });
    return c.json(apiError('internal', 'Internal error'), 500);
  });

  return app;
}
