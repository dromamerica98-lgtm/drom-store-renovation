import { Hono } from 'hono';
import { ENGINE_VERSION } from '@coach/engine';
import type { ApiError, StatusResponse } from '@coach/shared';
import type { Env } from './env';

export function createApp() {
  const app = new Hono<{ Bindings: Env }>().basePath('/api');

  app.get('/status', (c) => {
    const body: StatusResponse = {
      ok: true,
      service: 'coach-api',
      engineVersion: ENGINE_VERSION,
      garminMode: c.env.GARMIN_MODE === 'live' ? 'live' : 'mock',
      time: new Date().toISOString(),
    };
    return c.json(body);
  });

  app.notFound((c) => c.json<ApiError>({ error: { code: 'not_found', message: 'No such endpoint' } }, 404));

  app.onError((err, c) => {
    console.error('Unhandled API error', err);
    return c.json<ApiError>({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });

  return app;
}
