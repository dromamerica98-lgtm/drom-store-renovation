import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { isLocalDevBypass, resetAccessKeyCache, verifyAccessJwt, type AccessConfig } from '../src/auth/access';
import type { Env } from '../src/env';
import { sanitizeMessage } from '../src/security';

const TEAM = 'https://example-team.cloudflareaccess.com';
const AUD = 'aud-garmin-coach';
const OWNER = 'owner@example.com';
const config: AccessConfig = { teamDomain: TEAM, audience: AUD, ownerEmail: OWNER };

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function keyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid } };
}

async function sign(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>, alg = 'RS256') {
  const head = enc({ alg, kid, typ: 'JWT' });
  const body = enc(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}

const NOW = Date.parse('2026-11-14T08:00:00Z');
const nowSec = Math.floor(NOW / 1000);
const good = { aud: [AUD], iss: TEAM, email: OWNER, exp: nowSec + 3600, nbf: nowSec - 10, iat: nowSec - 10 };

let k1: Awaited<ReturnType<typeof keyPair>>;
let k2: Awaited<ReturnType<typeof keyPair>>;
let jwksCalls = 0;
let published: JsonWebKey[] = [];
const fetcher = async (url: string) => {
  jwksCalls++;
  expect(url).toBe(`${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: published }), { status: 200 });
};

beforeEach(async () => {
  resetAccessKeyCache();
  jwksCalls = 0;
  k1 ??= await keyPair('k1');
  k2 ??= await keyPair('k2');
  published = [k1.jwk];
});

const verify = (token: string | null) => verifyAccessJwt(token, config, { fetcher, now: () => NOW });

describe('Access JWT verification', () => {
  it('accepts a valid owner token and caches the key set', async () => {
    const token = await sign(k1.privateKey, 'k1', good);
    await expect(verify(token)).resolves.toEqual({ email: OWNER });
    await verify(token);
    expect(jwksCalls).toBe(1);
  });

  it.each([
    ['missing token', null, 'missing_token'],
    ['wrong audience', { ...good, aud: ['other-app'] }, 'bad_audience'],
    ['wrong issuer', { ...good, iss: 'https://evil.cloudflareaccess.com' }, 'bad_issuer'],
    ['expired', { ...good, exp: nowSec - 120 }, 'expired'],
    ['not yet valid', { ...good, nbf: nowSec + 600 }, 'not_yet_valid'],
    ['someone else', { ...good, email: 'intruder@example.com' }, 'not_owner'],
  ])('rejects: %s', async (_name, payload, reason) => {
    const token = payload === null ? null : await sign(k1.privateKey, 'k1', payload);
    await expect(verify(token)).rejects.toMatchObject({ reason });
  });

  it('rejects a token signed by a key the team does not publish', async () => {
    const forged = await sign(k2.privateKey, 'k1', good); // claims kid k1, signed with k2
    await expect(verify(forged)).rejects.toMatchObject({ reason: 'bad_signature' });
  });

  it('rejects unsigned / non-RS256 tokens', async () => {
    const none = `${enc({ alg: 'none', kid: 'k1' })}.${enc(good)}.`;
    await expect(verify(none)).rejects.toMatchObject({ reason: 'bad_alg' });
    await expect(verify('not-a-jwt')).rejects.toMatchObject({ reason: 'malformed' });
  });

  it('refetches the key set once when Access rotates keys', async () => {
    await verify(await sign(k1.privateKey, 'k1', good));
    published = [k1.jwk, k2.jwk];
    await expect(verify(await sign(k2.privateKey, 'k2', good))).resolves.toEqual({ email: OWNER });
    expect(jwksCalls).toBe(2);
  });

  it('fails closed when not configured', async () => {
    const token = await sign(k1.privateKey, 'k1', good);
    await expect(verifyAccessJwt(token, { ...config, audience: '' }, { fetcher })).rejects.toMatchObject({ reason: 'not_configured' });
  });

  it('allows the local-dev bypass only on localhost with the flag', () => {
    expect(isLocalDevBypass('http://localhost:8787/api/today', '1')).toBe(true);
    expect(isLocalDevBypass('http://127.0.0.1:8787/api/today', '1')).toBe(true);
    expect(isLocalDevBypass('https://garmin-personal-coach.example.workers.dev/api/today', '1')).toBe(false);
    expect(isLocalDevBypass('http://localhost:8787/api/today', undefined)).toBe(false);
  });
});

describe('API authentication', () => {
  const env = { GARMIN_MODE: 'mock', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER } as Env;
  const app = createApp({ accessFetcher: fetcher, now: () => new Date(NOW) });
  const url = 'https://garmin-personal-coach.example.workers.dev/api/status';

  it('rejects requests without a valid Access token, without revealing why', async () => {
    for (const headers of [{}, { 'cf-access-jwt-assertion': 'garbage' }] as Array<Record<string, string>>) {
      const res = await app.request(url, { headers }, env);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Sign in required' } });
      expect(res.headers.get('cache-control')).toBe('no-store, private');
    }
  });

  it('hides which routes exist from unauthenticated callers', async () => {
    const res = await app.request('https://garmin-personal-coach.example.workers.dev/api/does-not-exist', {}, env);
    expect(res.status).toBe(401);
  });

  it('serves the owner and marks every response no-store', async () => {
    const res = await app.request(url, { headers: { 'cf-access-jwt-assertion': await sign(k1.privateKey, 'k1', good) } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store, private');
  });

  it('ignores the dev bypass flag on a public hostname', async () => {
    const res = await app.request(url, {}, { ...env, ACCESS_DEV_BYPASS: '1' });
    expect(res.status).toBe(401);
  });
});

describe('error sanitization', () => {
  it('removes credentials, tokens and emails from messages', () => {
    const msg = sanitizeMessage(
      'GET https://personal.connectapi.garmin.com/x?token=abc123 failed: Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ for owner@example.com ApiKey FAKE0TEST0KEY0ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    );
    expect(msg).not.toContain('abc123');
    expect(msg).not.toContain('eyJ');
    expect(msg).not.toContain('owner@example.com');
    expect(msg).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(msg).toContain('Bearer [redacted]');
  });

  it('truncates long messages', () => {
    expect(sanitizeMessage('x '.repeat(400)).length).toBeLessThanOrEqual(301);
  });
});
