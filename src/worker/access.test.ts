import { Hono } from 'hono';
import { SignJWT, base64url, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { accessAuth, accessLogoutUrl, normalizeTeamDomain, type AccessContext, type AuthEnv } from './access';

const TEAM = 'https://test-team.cloudflareaccess.com';
const AUD = 'test-aud-tag';
const env = { ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUD: AUD };

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256' };
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
});

function sign(
  claims: Record<string, unknown> = { email: 'Owner@Example.com' },
  opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience([opts.aud ?? AUD])
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(opts.key ?? privateKey);
}

/** A stand-in for the runtime's ctx.access. */
function accessCtx(aud: string, identity: Record<string, unknown> | undefined) {
  const access: AccessContext = { aud, getIdentity: async () => identity };
  return { access, waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
}

async function call(
  headers: Record<string, string>,
  opts: { bindings?: Record<string, string>; ctx?: ExecutionContext; allowAnyAud?: boolean } = {},
) {
  const app = new Hono<AuthEnv>();
  app.use('*', accessAuth({ getKey: () => createLocalJWKSet({ keys: [jwk] }), allowAnyAud: opts.allowAnyAud }));
  app.get('/api/whoami', (c) => c.json({ user: c.get('user') }));
  const res = await app.request('/api/whoami', { headers }, opts.bindings ?? env, opts.ctx);
  return { status: res.status, body: (await res.json()) as { user?: string; error?: string } };
}

describe('identity from ctx.access (provided by Cloudflare to the Worker)', () => {
  it('accepts the identity when the audience matches', async () => {
    const res = await call({}, { ctx: accessCtx(AUD, { email: 'Partner@Example.com', name: 'שותף' }) });
    expect(res).toEqual({ status: 200, body: { user: 'partner@example.com' } });
  });

  it('prefers ctx.access over any header, including a JWT', async () => {
    const res = await call(
      { 'cf-access-jwt-assertion': await sign({ email: 'other@example.com' }), 'cf-access-authenticated-user-email': 'x@example.com' },
      { ctx: accessCtx(AUD, { email: 'partner@example.com' }) },
    );
    expect(res.body.user).toBe('partner@example.com');
  });

  it('rejects an identity from another Access application', async () => {
    expect((await call({}, { ctx: accessCtx('other-app', { email: 'partner@example.com' }) })).status).toBe(403);
  });

  it('rejects an identity without an email (e.g. a service token)', async () => {
    expect((await call({}, { ctx: accessCtx(AUD, { common_name: 'svc' }) })).status).toBe(403);
    expect((await call({}, { ctx: accessCtx(AUD, undefined) })).status).toBe(403);
  });

  it('fails closed when ACCESS_AUD is not set', async () => {
    const res = await call({}, { ctx: accessCtx(AUD, { email: 'a@example.com' }), bindings: { ACCESS_AUD: '' } });
    expect(res.status).toBe(500);
  });

  it('accepts the local dev simulation without ACCESS_AUD only when allowed', async () => {
    const res = await call({}, { ctx: accessCtx('local-dev-aud', { email: 'dev@localhost' }), bindings: {}, allowAnyAud: true });
    expect(res).toEqual({ status: 200, body: { user: 'dev@localhost' } });
  });
});

describe('fallback: Access JWT verified by the Worker', () => {
  it('accepts a valid token and takes the email from it', async () => {
    const res = await call({ 'cf-access-jwt-assertion': await sign() });
    expect(res).toEqual({ status: 200, body: { user: 'owner@example.com' } });
  });

  it('blocks a request without any identity', async () => {
    expect((await call({})).status).toBe(401);
    expect((await call({}, { bindings: {} })).status).toBe(401);
  });

  it('ignores a plain email header that is not backed by Access', async () => {
    const res = await call({ 'cf-access-authenticated-user-email': 'attacker@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.user).toBeUndefined();
  });

  it('rejects a token for another Access application', async () => {
    expect((await call({ 'cf-access-jwt-assertion': await sign(undefined, { aud: 'other-app' }) })).status).toBe(403);
  });

  it('rejects a token from another team', async () => {
    const token = await sign(undefined, { iss: 'https://evil.cloudflareaccess.com' });
    expect((await call({ 'cf-access-jwt-assertion': token })).status).toBe(403);
  });

  it('rejects an expired token', async () => {
    const token = await sign(undefined, { exp: Math.floor(Date.now() / 1000) - 120 });
    expect((await call({ 'cf-access-jwt-assertion': token })).status).toBe(403);
  });

  it('rejects a token signed with a different key', async () => {
    expect((await call({ 'cf-access-jwt-assertion': await sign(undefined, { key: otherPrivateKey }) })).status).toBe(403);
  });

  it('rejects an unsigned token', async () => {
    const encode = (o: object) => base64url.encode(JSON.stringify(o));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${encode({ alg: 'none' })}.${encode({ email: 'x@example.com', iss: TEAM, aud: [AUD], exp })}.`;
    expect((await call({ 'cf-access-jwt-assertion': token })).status).toBe(403);
  });

  it('rejects a tampered token', async () => {
    const [h, , s] = (await sign()).split('.');
    const body = base64url.encode(JSON.stringify({ email: 'attacker@example.com', iss: TEAM, aud: [AUD], exp: 9999999999 }));
    expect((await call({ 'cf-access-jwt-assertion': `${h}.${body}.${s}` })).status).toBe(403);
  });

  it('rejects a service token, which has no email', async () => {
    expect((await call({ 'cf-access-jwt-assertion': await sign({ common_name: 'service-token-id' }) })).status).toBe(403);
  });

  it('fails closed when the JWT settings are missing', async () => {
    const token = await sign();
    expect((await call({ 'cf-access-jwt-assertion': token }, { bindings: { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' } })).status).toBe(500);
    expect((await call({ 'cf-access-jwt-assertion': token }, { bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '' } })).status).toBe(500);
  });
});

describe('normalizeTeamDomain', () => {
  it('accepts a bare host or a URL', () => {
    expect(normalizeTeamDomain('team.cloudflareaccess.com')).toBe('https://team.cloudflareaccess.com');
    expect(normalizeTeamDomain('https://team.cloudflareaccess.com/')).toBe('https://team.cloudflareaccess.com');
    expect(normalizeTeamDomain('  ')).toBe('');
    expect(normalizeTeamDomain(undefined)).toBe('');
  });
});

describe('accessLogoutUrl', () => {
  it('builds the team logout address, or nothing without a team', () => {
    expect(accessLogoutUrl('damp-bread-d7b5.cloudflareaccess.com')).toBe(
      'https://damp-bread-d7b5.cloudflareaccess.com/cdn-cgi/access/logout',
    );
    expect(accessLogoutUrl('https://damp-bread-d7b5.cloudflareaccess.com/')).toBe(
      'https://damp-bread-d7b5.cloudflareaccess.com/cdn-cgi/access/logout',
    );
    expect(accessLogoutUrl('')).toBeNull();
  });
});
