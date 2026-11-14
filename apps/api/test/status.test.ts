import { describe, expect, it } from 'vitest';
import type { StatusResponse } from '@coach/shared';
import { createApp } from '../src/app';
import type { Env } from '../src/env';

describe('GET /api/status', () => {
  it('reports service health without touching the database', async () => {
    const app = createApp();
    const env = { GARMIN_MODE: 'mock', ACCESS_DEV_BYPASS: '1' } as Env;
    const res = await app.request('/api/status', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusResponse;
    expect(body.ok).toBe(true);
    expect(body.garminMode).toBe('mock');
  });

  it('returns a JSON 404 for unknown endpoints', async () => {
    const res = await createApp().request('/api/nope', {}, { GARMIN_MODE: 'mock', ACCESS_DEV_BYPASS: '1' } as Env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint' } });
  });
});
