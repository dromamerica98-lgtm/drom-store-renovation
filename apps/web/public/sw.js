/*
 * Coach service worker.
 *
 * Privacy rule: personal health data is never stored by the service worker.
 * /api/* requests are not intercepted at all (and the API answers with
 * Cache-Control: no-store), so health data lives only in memory while the
 * app is open.
 *
 *  - Navigations: network first, fall back to the cached app shell (offline).
 *  - Hashed build assets (/assets/*): cache first — filenames change per build.
 *  - Icons and manifest: stale-while-revalidate.
 *  - Cloudflare Access endpoints (/cdn-cgi/*): never touched.
 */
const VERSION = 'coach-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(new Request(url, { credentials: 'same-origin' })).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

// Activating a new version deletes every older cache, including any health
// data an earlier version may have stored.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The app asks for this on sign-out.
self.addEventListener('message', (event) => {
  if (event.data === 'clear-caches') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

const cacheable = (response) => response.ok && response.type === 'basic' && !response.redirected;

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (cacheable(response)) cache.put(fallbackKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(fallbackKey);
    if (!cached) throw error;
    return cached;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
