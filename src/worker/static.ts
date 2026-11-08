/**
 * Serves the built web app (HTML, JS, CSS, icons) from inside the Worker.
 *
 * In production the files are embedded in the Worker bundle (see scripts/prepare-deploy.mjs)
 * instead of using Workers Static Assets, so every request, including the page itself, goes
 * through the Worker and its Cloudflare Access check. Local development still uses Vite.
 */

export interface StaticAsset {
  body: Uint8Array;
  contentType: string;
  etag: string;
  /** Content-hashed file (under /assets/) that never changes. */
  immutable: boolean;
}

export type AssetMap = Record<string, StaticAsset>;

/** The serialized form written by scripts/prepare-deploy.mjs. */
export type EncodedAssets = Record<string, { b: string; t: string; e: string; i: boolean }>;

export function decodeAssets(encoded: EncodedAssets): AssetMap {
  const assets: AssetMap = {};
  for (const [path, a] of Object.entries(encoded)) {
    const binary = atob(a.b);
    const body = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) body[i] = binary.charCodeAt(i);
    assets[path] = { body, contentType: a.t, etag: a.e, immutable: a.i };
  }
  return assets;
}

const INDEX = '/index.html';

export function serveStatic(request: Request, assets: AssetMap): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  let asset = assets[path];
  if (!asset) {
    // A missing file is a 404; any other path is a page of the app (client-side routing).
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) return new Response('Not Found', { status: 404 });
    asset = assets[INDEX];
    if (!asset) return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': asset.contentType,
    ETag: asset.etag,
    // Everything is behind Access, so nothing may be stored by shared caches.
    'Cache-Control': asset.immutable ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  if (asset.contentType.startsWith('text/html')) headers.set('X-Frame-Options', 'DENY');

  if (request.headers.get('If-None-Match') === asset.etag) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(asset.body.byteLength));
  return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers });
}
