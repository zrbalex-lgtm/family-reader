/* Family Reader service worker. Built by the plugin in vite.config.js, which replaces
   __PRECACHE__ (all built files) and __VERSION__ (changes with every build). */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL_CACHE = 'shell-' + VERSION;
const FONT_CACHE = 'fonts-v1';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
// The app's own folder, e.g. https://user.github.io/family-reader/
const SCOPE = new URL(self.registration.scope);
const INDEX = new URL('./', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) =>
    cache.addAll([INDEX, ...PRECACHE.map((path) => new URL(path, SCOPE).href)].map((url) => new Request(url, { cache: 'reload' }))),
  ));
  // No skipWaiting here: the page asks the user before switching to a new version.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('shell-') && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

async function fromNetworkWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // App pages (hash routes all load the same index.html): network first, cached copy offline.
  if (request.mode === 'navigate' && url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)) {
    event.respondWith((async () => {
      try {
        return await fromNetworkWithTimeout(request, 4000);
      } catch {
        return (await caches.match(INDEX, { cacheName: SHELL_CACHE })) || Response.error();
      }
    })());
    return;
  }

  // Built files have content hashes in their names, so the cached copy is always right.
  if (url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)) {
    event.respondWith((async () => (await caches.match(request, { cacheName: SHELL_CACHE })) || fetch(request))());
    return;
  }

  // Reader web fonts: cached on first use, so chosen fonts also work offline.
  if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') void cache.put(request, response.clone());
      return response;
    })());
  }
  // Everything else (Supabase API and Storage) goes straight to the network.
});
