/**
 * Cloudflare Access JWT verification — defence in depth.
 *
 * Cloudflare Access sits in front of the whole hostname and only lets the
 * owner through. The Worker does not rely on that alone: every /api request
 * must carry a valid Access JWT (`Cf-Access-Jwt-Assertion` header), signed by
 * the team's keys, for this application's audience, unexpired, and for the
 * owner's email. A misconfigured or removed Access policy therefore still
 * cannot expose any data.
 *
 * Verification: RS256 signature against the team JWKS
 * (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs), `aud`, `iss`,
 * `exp`/`nbf` with 60 s leeway, and `email`.
 */

export interface AccessConfig {
  /** e.g. https://damp-bread-d7b5.cloudflareaccess.com */
  teamDomain: string;
  /** Application Audience (AUD) tag of the Access application. */
  audience: string;
  /** The only identity allowed in. */
  ownerEmail: string;
}

export interface AccessIdentity {
  email: string;
}

export class AccessDenied extends Error {
  constructor(readonly reason: string) {
    super('Access denied');
    this.name = 'AccessDenied';
  }
}

type Jwk = JsonWebKey & { kid?: string };
type Fetcher = (url: string) => Promise<Response>;

const LEEWAY_SEC = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache: { url: string; keys: Jwk[]; fetchedAt: number } | null = null;

/** Test hook: forget cached keys. */
export function resetAccessKeyCache(): void {
  jwksCache = null;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePart<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))) as T;
}

async function loadKeys(teamDomain: string, fetcher: Fetcher, force: boolean): Promise<Jwk[]> {
  const url = `${teamDomain.replace(/\/+$/, '')}/cdn-cgi/access/certs`;
  if (!force && jwksCache && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetcher(url);
  if (!res.ok) throw new AccessDenied('jwks_unavailable');
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

export async function verifyAccessJwt(
  token: string | null | undefined,
  config: AccessConfig,
  options: { fetcher?: Fetcher; now?: () => number } = {},
): Promise<AccessIdentity> {
  if (!token) throw new AccessDenied('missing_token');
  if (!config.teamDomain || !config.audience || !config.ownerEmail) throw new AccessDenied('not_configured');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessDenied('malformed');
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
  try {
    header = decodePart(h);
    payload = decodePart(p);
  } catch {
    throw new AccessDenied('malformed');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new AccessDenied('bad_alg');

  const fetcher = options.fetcher ?? ((url: string) => fetch(url));
  let jwk = (await loadKeys(config.teamDomain, fetcher, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await loadKeys(config.teamDomain, fetcher, true)).find((k) => k.kid === header.kid); // key rotation
  if (!jwk) throw new AccessDenied('unknown_key');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new AccessDenied('bad_signature');

  const now = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(config.audience)) throw new AccessDenied('bad_audience');
  if (payload.iss !== config.teamDomain.replace(/\/+$/, '')) throw new AccessDenied('bad_issuer');
  if (typeof payload.exp !== 'number' || payload.exp + LEEWAY_SEC < now) throw new AccessDenied('expired');
  if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_SEC > now) throw new AccessDenied('not_yet_valid');
  const email = (payload.email ?? '').toLowerCase();
  if (!email || email !== config.ownerEmail.toLowerCase()) throw new AccessDenied('not_owner');
  return { email };
}

/** Local development only: `wrangler dev` on localhost with ACCESS_DEV_BYPASS=1 in .dev.vars. */
export function isLocalDevBypass(requestUrl: string, flag: string | undefined): boolean {
  if (flag !== '1') return false;
  const host = new URL(requestUrl).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}
