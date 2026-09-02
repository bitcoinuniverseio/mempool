/**
 * The Universe Explorer service worker.
 *
 * One file, three caches, and a boundary that is easy to state: this worker
 * stores only GET requests this explorer's own origin answered, and it never
 * stores anything from the surfaces where an operator console or a visitor's
 * own data moves. A response that came from this cache says so, with the time
 * it was captured, because a reader must never mistake a stored answer for a
 * live one.
 *
 * The decision functions are exported and unit tested directly. The event
 * wiring at the bottom is the only thing that talks to the worker globals,
 * and it is guarded so importing this file in a test process is harmless.
 */

export const SHELL_CACHE = 'universe.shell.v1';
export const STATIC_CACHE = 'universe.static.v1';
export const API_CACHE = 'universe.api.v1';

export const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, API_CACHE];

/** The document the shell falls back to when a navigation cannot reach the network. */
export const OFFLINE_URL = '/offline';

/** How many API answers the cache keeps. */
export const API_CACHE_MAX_ENTRIES = 60;

/** Header added to every answer served from a cache, stating when it was captured. */
export const SNAPSHOT_HEADER = 'x-universe-snapshot';

/**
 * Paths this worker refuses to store, ever.
 *
 * These are the surfaces where an operator console, a visitor's own workspace
 * traffic, or an administrative adapter moves. A shared cache has nothing to
 * say about any of them, and storing them would be a privacy failure long
 * before it was a performance win.
 */
export const NEVER_CACHE_PATHS = [
  '/api/v1/admin',
  '/api/v1/node/rpc',
  '/api/v1/validate-address',
  '/api/v1/ws',
  '/socket.io/',
];

/** True for the only kind of request this worker will even consider storing. */
export function isCacheableMethod(method) {
  return String(method || '').toUpperCase() === 'GET';
}

export function isNeverCachePath(url) {
  return NEVER_CACHE_PATHS.some((path) => url.pathname.startsWith(path));
}

/** True for the websockets this worker must never intercept. */
export function isUpgrade(request) {
  return request.headers.get('upgrade') === 'websocket';
}

/**
 * Which of the three caches a same origin GET belongs in, or null for none.
 *
 * Navigations and API answers are network first: an explorer page is an
 * answer about the present, and a stored page is only a fallback for when the
 * present cannot be reached.
 *
 * Static assets are cache first because the build fingerprints them; a stored
 * answer for a hashed name is the same bytes forever.
 */
export function strategyFor(url, request) {
  if (!isCacheableMethod(request.method) || isNeverCachePath(url) || isUpgrade(request)) {
    return null;
  }
  if (request.mode === 'navigate') {
    return 'network-first';
  }
  if (isStaticAsset(url)) {
    return 'cache-first';
  }
  if (isApiPath(url)) {
    return 'network-first';
  }
  return null;
}

export function isApiPath(url) {
  return url.pathname.startsWith('/api/v1/');
}

/**
 * Static here means content addressed or effectively permanent: hashed build
 * files, fonts, images, and the resources folder.
 */
export function isStaticAsset(url) {
  if (url.pathname.startsWith('/resources/')) { return true; }
  if (/\.(js|mjs|css|woff2?|ttf|otf|svg|png|jpg|jpeg|webp|avif|ico|json)$/.test(url.pathname)) {
    // config.js and customize.js are deployment configuration, not content
    // addressed, so they follow the network like a page does.
    return url.pathname !== '/config.js' && url.pathname !== '/customize.js';
  }
  return false;
}

/**
 * Wraps a response so the cache records when it was captured.
 *
 * Response headers are immutable, so the body is copied once at capture time
 * rather than on every later read. The copy comes from a clone taken here, so
 * the response the caller holds stays readable either way. The added header
 * is the only difference; the bytes are the node's own answer, untouched.
 */
export async function snapshotResponse(response, capturedAt) {
  const headers = new Headers(response.headers);
  headers.set(SNAPSHOT_HEADER, new Date(capturedAt).toISOString());
  const body = await response.clone().arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** How old a captured answer is, from its own header. Null when it says nothing. */
export function snapshotOf(response) {
  const raw = response.headers.get(SNAPSHOT_HEADER);
  if (!raw) { return null; }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

/**
 * Keeps the API cache bounded, oldest first.
 *
 * Cache keys come back in insertion order, and every hit re-puts its entry,
 * so the first keys are the least recently used and the only ones dropped.
 */
export async function trimApiCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) { return; }
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

/** Messages this worker understands from its clients. */
export const MESSAGES = {
  skipWaiting: 'SKIP_WAITING',
  storageEstimate: 'STORAGE_ESTIMATE',
  deleteCaches: 'DELETE_CACHES',
};

/**
 * The install: capture the shell.
 *
 * The shell is the document, the offline document, and the icons. The hashed
 * bundles are deliberately not listed: they are discovered on first use and
 * cached by their immutable names, which keeps this list from ever lying
 * about a file the build no longer produces.
 */
export const SHELL_URLS = [
  '/',
  OFFLINE_URL,
  '/resources/favicons/favicon.ico',
  '/resources/favicons/apple-touch-icon.png',
  '/resources/favicons/android-chrome-192x192.png',
  '/resources/favicons/android-chrome-512x512.png',
];

// Wiring. Everything above this line is pure; everything below runs only in
// a real service worker global scope, which test processes do not provide.

function hasWorkerScope(scope) {
  return typeof scope.addEventListener === 'function'
    && typeof scope.registration !== 'undefined'
    && typeof caches !== 'undefined';
}

const worker = typeof self !== 'undefined' ? self : undefined;

if (worker && hasWorkerScope(worker)) {
  worker.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing icon cannot fail the whole install.
      await Promise.all(SHELL_URLS.map(async (url) => {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch {
          // Absent from this build; the shell does not depend on it.
        }
      }));
    })());
  });

  worker.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names
        .filter((name) => name.startsWith('universe.') && !ALL_CACHES.includes(name))
        .map((name) => caches.delete(name)));
      await worker.clients.claim();
    })());
  });

  worker.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (url.origin !== worker.location.origin) { return; }
    const strategy = strategyFor(url, request);
    if (strategy === null) { return; }

    if (strategy === 'cache-first') {
      event.respondWith(cacheFirst(request));
      return;
    }
    if (request.mode === 'navigate') {
      event.respondWith(navigation(request));
      return;
    }
    event.respondWith(apiGet(request));
  });

  worker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data.type !== 'string') { return; }
    if (data.type === MESSAGES.skipWaiting) {
      worker.skipWaiting();
      return;
    }
    if (data.type === MESSAGES.storageEstimate) {
      event.waitUntil((async () => {
        const estimate = await navigator.storage.estimate();
        replyTo(event, { type: 'storage', usage: estimate.usage ?? null, quota: estimate.quota ?? null });
      })());
      return;
    }
    if (data.type === MESSAGES.deleteCaches) {
      event.waitUntil((async () => {
        await Promise.all(ALL_CACHES.map((name) => caches.delete(name)));
        replyTo(event, { type: 'deleted' });
      })());
    }
  });
}

function replyTo(event, message) {
  if (event.source && typeof event.source.postMessage === 'function') {
    event.source.postMessage(message);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: STATIC_CACHE });
  if (cached) { return cached; }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function navigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request, { cacheName: SHELL_CACHE });
    if (cached) { return cached; }
    const shell = await caches.match('/', { cacheName: SHELL_CACHE });
    if (shell) { return shell; }
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    if (offline) { return offline; }
    return Response.error();
  }
}

async function apiGet(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, await snapshotResponse(response, Date.now()));
      trimApiCache(cache, API_CACHE_MAX_ENTRIES);
      return response;
    }
    // A refusal is an answer about the present. It is never stored, and it
    // is never replaced by an older truth.
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: API_CACHE });
    if (cached) { return cached; }
    return Response.error();
  }
}
