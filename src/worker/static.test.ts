import { describe, expect, it } from 'vitest';
import deployEntry from './deploy-entry';
import { decodeAssets, serveStatic, type EncodedAssets } from './static';

const encoded: EncodedAssets = {
  '/index.html': { b: btoa('<!doctype html><title>app</title>'), t: 'text/html; charset=utf-8', e: '"idx"', i: false },
  '/assets/index-abc.js': { b: btoa('console.log(1)'), t: 'text/javascript; charset=utf-8', e: '"js"', i: true },
  '/icon-192.png': { b: btoa('\x89PNG'), t: 'image/png', e: '"png"', i: false },
};
const assets = decodeAssets(encoded);
const get = (path: string, init?: RequestInit) => serveStatic(new Request(`https://app.example${path}`, init), assets);

describe('serveStatic', () => {
  it('serves a file with its type and cache headers', async () => {
    const res = get('/assets/index-abc.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('serves binary files intact', async () => {
    expect(new Uint8Array(await get('/icon-192.png').arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('serves the app page for app routes', async () => {
    for (const path of ['/', '/areas/area-elec', '/payments']) {
      const res = get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(await res.text()).toContain('<title>app</title>');
    }
  });

  it('returns 404 for a missing file', () => {
    expect(get('/assets/missing.js').status).toBe(404);
  });

  it('answers 304 when the browser already has the file', () => {
    expect(get('/assets/index-abc.js', { headers: { 'If-None-Match': '"js"' } }).status).toBe(304);
  });

  it('answers HEAD without a body and refuses other methods', async () => {
    const head = get('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(get('/', { method: 'POST' }).status).toBe(405);
  });
});

describe('production entry', () => {
  const env = { ACCESS_AUD: 'prod-aud', ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com' } as unknown as Env;
  const ctx = (access?: object) =>
    ({ waitUntil() {}, passThroughOnException() {}, props: {}, access }) as unknown as ExecutionContext;
  const fetchApp = (path: string, c: ExecutionContext) =>
    deployEntry.fetch(new Request(`https://app.example${path}`) as Parameters<typeof deployEntry.fetch>[0], env, c);

  it('does not serve the app without an Access identity', async () => {
    expect((await fetchApp('/', ctx())).status).toBe(401);
    expect((await fetchApp('/assets/index-abc.js', ctx())).status).toBe(401);
  });

  it('does not serve the app for another Access application', async () => {
    const other = { aud: 'other-aud', getIdentity: async () => ({ email: 'a@example.com' }) };
    expect((await fetchApp('/', ctx(other))).status).toBe(403);
  });

  it('serves the app to a verified user', async () => {
    const access = { aud: 'prod-aud', getIdentity: async () => ({ email: 'a@example.com' }) };
    const res = await fetchApp('/areas', ctx(access));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('routes /api to the API, which also requires an identity', async () => {
    const res = await fetchApp('/api/data', ctx());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'נדרשת התחברות' });
  });
});
