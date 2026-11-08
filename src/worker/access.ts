import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Cloudflare Access authentication.
 *
 * Access sits in front of the Worker. Every API request must come with an identity that
 * Access has verified, taken from one of two places:
 *
 * 1. `ctx.access` – the identity Cloudflare provides to a Worker protected by Access.
 *    Its `aud` must match this app's Access application (ACCESS_AUD), and the user's email
 *    comes from `ctx.access.getIdentity()`.
 * 2. Otherwise, the `Cf-Access-Jwt-Assertion` JWT, verified here against the team's public
 *    keys (ACCESS_TEAM_DOMAIN), the issuer and the audience (ACCESS_AUD).
 *
 * Plain headers such as `Cf-Access-Authenticated-User-Email` are never trusted.
 * Requests without a verified identity are refused.
 */

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

export interface AccessBindings {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export type AuthEnv = { Bindings: AccessBindings; Variables: { user: string } };

/** The part of the runtime's CloudflareAccessContext used here. */
export interface AccessContext {
  readonly aud: string;
  getIdentity(): Promise<{ email?: unknown } | undefined>;
}

export class AccessError extends Error {
  constructor(
    readonly status: 401 | 403 | 500,
    message: string,
    /** Short reason for the logs; never includes the token or identity. */
    readonly reason: string,
  ) {
    super(message);
  }
}

const NOT_CONFIGURED = 'האפליקציה עדיין לא הוגדרה מול Cloudflare Access';
const NOT_VERIFIED = 'לא הצלחנו לאמת את ההתחברות. טענו מחדש את הדף.';

/** Accepts "team.cloudflareaccess.com" or "https://team.cloudflareaccess.com/" and returns "https://team.cloudflareaccess.com". */
export function normalizeTeamDomain(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Identity from `ctx.access`, which Cloudflare has already authenticated. */
export async function identityFromContext(
  access: AccessContext,
  expectedAud: string,
  options: { allowAnyAud?: boolean } = {},
): Promise<string> {
  if (!expectedAud && !options.allowAnyAud) throw new AccessError(500, NOT_CONFIGURED, 'missing_aud');
  if (expectedAud && access.aud !== expectedAud) throw new AccessError(403, NOT_VERIFIED, 'wrong_aud');
  const email = normalizeEmail((await access.getIdentity())?.email);
  // Service tokens and identities without an email are not people; only people may use the app.
  if (!email) throw new AccessError(403, 'ההתחברות אינה של משתמש', 'no_email');
  return email;
}

const jwksByTeam = new Map<string, JWTVerifyGetKey>();

/** The team's public signing keys, fetched from Access and cached per isolate (rotations are picked up by kid). */
export function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

/** Verifies an Access JWT and returns the signed-in user's email (lowercased). */
export async function verifyAccessJwt(
  token: string | undefined,
  config: { teamDomain: string; aud: string },
  getKey: (teamDomain: string) => JWTVerifyGetKey,
): Promise<string> {
  if (!token) throw new AccessError(401, 'נדרשת התחברות', 'missing_identity');
  if (!config.teamDomain || !config.aud) throw new AccessError(500, NOT_CONFIGURED, 'missing_jwt_config');

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getKey(config.teamDomain), {
      issuer: config.teamDomain,
      audience: config.aud,
      algorithms: ['RS256'],
      clockTolerance: 30,
    }));
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? String(e.code) : 'unknown';
    throw new AccessError(403, NOT_VERIFIED, `invalid_token:${code}`);
  }

  const email = normalizeEmail(payload.email);
  if (!email) throw new AccessError(403, 'ההתחברות אינה של משתמש', 'no_email');
  return email;
}

export interface AccessMiddlewareOptions {
  /**
   * Local development only: accept the simulated `ctx.access` from wrangler's `access.dev`
   * block even though ACCESS_AUD is not set. index.ts sets it from `import.meta.env.DEV`,
   * so production builds always require ACCESS_AUD.
   */
  allowAnyAud?: boolean;
  /** Overrides how signing keys are found (tests use a local key set). */
  getKey?: (teamDomain: string) => JWTVerifyGetKey;
}

export function accessAuth(options: AccessMiddlewareOptions = {}): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const aud = (c.env.ACCESS_AUD ?? '').trim();
    let access: AccessContext | undefined;
    try {
      access = (c.executionCtx as { access?: AccessContext }).access;
    } catch {
      access = undefined; // No execution context (e.g. unit tests).
    }
    try {
      const email = access
        ? await identityFromContext(access, aud, { allowAnyAud: options.allowAnyAud })
        : await verifyAccessJwt(
            c.req.header(ACCESS_JWT_HEADER),
            { teamDomain: normalizeTeamDomain(c.env.ACCESS_TEAM_DOMAIN), aud },
            options.getKey ?? remoteJwks,
          );
      c.set('user', email);
    } catch (e) {
      if (!(e instanceof AccessError)) throw e;
      console.warn(`access denied: ${e.reason} ${c.req.method} ${new URL(c.req.url).pathname}`);
      return c.json({ error: e.message }, e.status);
    }
    return next();
  };
}
