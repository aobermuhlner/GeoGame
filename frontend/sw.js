// Service worker: the app shell opens offline. Built into dist/sw.js by the `service-worker` plugin in
// vite.config.ts, which fills in __VERSION__, __PRECACHE__ and __WORKER_ORIGIN__ (not used in dev).
//
// Rules:
// - Only same-origin GETs inside the scope are handled. The game server (Worker API, flag images,
//   WebSockets) is never cached: dailies, rankings and runs are server-authoritative.
// - Pages are network-first, so a deploy shows up on the next load; the cache is only the offline fallback.
// - Each build precaches its own complete file set under its own cache name and deletes older caches when it
//   activates, so cached files always belong to one build and an old build can't linger.
// - Nothing is added to the cache at runtime.
//
// To retire it: deploy an sw.js that only does `self.registration.unregister()`.

const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const WORKER_ORIGIN = __WORKER_ORIGIN__;
const PREFIX = 'flagduel-';
const CACHE = PREFIX + VERSION;
const SCOPE = new URL(self.registration.scope);
/**
 * Cloudflare Pages serves `index.html` at `/` and `credits.html` at `/credits` (the .html URLs redirect there).
 * Pages are cached under the URL they are served at: a cached redirect can't answer a navigation.
 */
const servedAt = (path) => path.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
const INDEX = SCOPE.href;
/** Pages whose network fetch may take this long before the cached copy is shown instead */
const PAGE_TIMEOUT_MS = 6000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' skips the HTTP cache, so the files really are this build's.
      .then((c) => c.addAll(PRECACHE.map((p) => new Request(new URL(servedAt(p), SCOPE), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || url.origin === WORKER_ORIGIN || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (req.mode === 'navigate') event.respondWith(page(req, url));
  else event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
});

/** Network first; offline (or very slow) → this build's cached page, else a small offline page. */
async function page(req, url) {
  // no-cache: revalidate with the server instead of trusting the HTTP cache, so a deploy shows up at once.
  const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
  network.catch(() => {}); // a late failure after the timeout is handled below, not reported
  try {
    return await withTimeout(network, PAGE_TIMEOUT_MS);
  } catch {
    // Any page under the scope that isn't a precached file (/, /?room=…, unknown paths) is the app itself.
    const cached =
      (await caches.match(new URL(servedAt(url.pathname), SCOPE).href, { cacheName: CACHE })) ??
      (await caches.match(INDEX, { cacheName: CACHE }));
    if (cached) return cached;
    // Nothing cached yet: wait for the network after all, then give up with the offline page.
    return network.catch(offlinePage);
  }
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (r) => (clearTimeout(t), resolve(r)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Flag Duel: offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ede3cc;color:#1b2620;
font-family:system-ui,sans-serif;text-align:center;padding:16px;box-sizing:border-box}
main{background:#fffdf7;border-radius:18px;padding:24px;max-width:360px;box-shadow:0 6px 24px rgba(60,45,20,.08)}
button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:12px 24px;min-height:44px;background:#1f4d2e;color:#fffdf7}</style>
</head><body><main><h1>You're offline</h1><p>Flag Duel needs a connection for daily games, rankings and duels.</p>
<button onclick="location.reload()">Try again</button></main>
<script>addEventListener('online',()=>location.reload())</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
