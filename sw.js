// MySeasons service worker: cachet de app-schil zodat de app offline opent.
// Data komt niet via deze cache maar via de Firestore offline-cache.
// Ophogen bij elke release, samen met APP_VERSION in js/version.js.
const CACHE_VERSION = 'ms-shell-v0.8.2';
const RUNTIME = 'ms-runtime-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/app.css',
  'js/main.js',
  'js/firebase.js',
  'js/theme.js',
  'js/ui.js',
  'js/views.js',
  'js/version.js',
  'js/api.js',
  'js/config.js',
  'js/normalize.js',
  'js/store.js',
  'js/sync.js',
  'js/season.js',
  'js/matchviews.js',
  'js/standview.js',
  'js/corrections.js',
  'js/editor.js',
  'js/players.js',
  'js/playerviews.js',
  'js/names.js',
  'js/stories.js',
  'js/magazine.js',
  'js/news.js',
  'js/seasonstate.js',
  'js/seasonsview.js',
  'js/rsssf.js',
  'js/rsssfimport.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

// Externe bestanden die vast versioned zijn en dus veilig cache-first kunnen.
const CACHE_FIRST_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const FIREBASE_SDK_PREFIX = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== RUNTIME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(RUNTIME);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_VERSION);
    cache.put('index.html', response.clone());
    return response;
  } catch {
    return (await caches.match('index.html')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (CACHE_FIRST_HOSTS.includes(url.hostname) || request.url.startsWith(FIREBASE_SDK_PREFIX)) {
    event.respondWith(cacheFirst(request));
  }
  // Al het andere (Firestore, Google-login, de Worker) gaat ongemoeid naar het netwerk.
});
