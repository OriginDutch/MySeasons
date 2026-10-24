// MySeasons service worker: cachet de app-schil zodat de app offline opent.
// Data komt niet via deze cache maar via de Firestore offline-cache.
// Ophogen bij elke release, samen met APP_VERSION in js/version.js.
const CACHE_VERSION = 'ms-shell-v0.53.4';
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
  'js/importer.js',
  'js/clubview.js',
  'js/membership.js',
  'js/coaches.js',
  'js/flags.js',
  'js/livetable.js',
  'js/nightshift.js',
  'js/nightview.js',
  'js/backup.js',
  'js/playerextra.js',
  'js/rules.js',
  'js/inbox.js',
  'js/meldingen.js',
  'js/clubnames.js',
  'js/clubnamesview.js',
  'js/shirts.js',
  'js/discipline.js',
  'js/discview.js',
  'js/photos.js',
  'js/coachview.js',
  'js/photosview.js',
  'js/youthmigrate.js',
  'js/manual.js',
  'js/manualview.js',
  'js/rsssfconvert.js',
  'js/livescore.js',
  'js/liveboard.js',
  'js/shootout.js',
  'js/live.js',
  'js/reconcile.js',
  'js/roles.js',
  'js/squadsite.js',
  'js/leagues.js',
  'js/leaguesview.js',
  'js/playoffs.js',
  'js/clubpick.js',
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

// ---------- Pushmeldingen (wedstrijddag) ----------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'MySeasons', body: event.data ? event.data.text() : '' }; }
  // Vraag vooraf ("Live meldingen voor dit duel?"): knoppen als het apparaat ze kan tonen (Android),
  // anders opent een tik de wedstrijdpagina met het belletje (Firefox op de pc).
  const canAct = data.actions && self.Notification && Notification.maxActions > 0;
  event.waitUntil(self.registration.showNotification(data.title || 'MySeasons', {
    body: data.optin && !canAct ? 'Tik voor live meldingen bij dit duel. Geen antwoord = geen meldingen.' : data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'myseasons',
    data: { url: data.url || '#/home', optin: data.optin || null },
    ...(canAct ? { actions: data.actions.slice(0, 2) } : {}),
  }));
});

async function answerOptin(o, on) {
  try {
    const res = await fetch(o.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: o.endpoint, id: o.id, token: o.token, on }) });
    if (!res.ok) throw new Error(String(res.status));
    if (on) await self.registration.showNotification('Live meldingen aan', { body: o.name || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: `ask-${o.id}` });
  } catch {
    await self.registration.showNotification('Dat lukte niet', { body: 'Zet de meldingen voor dit duel aan met het belletje op de wedstrijdpagina.', icon: 'icons/icon-192.png', tag: `ask-${o.id}`, data: { url: `#/wedstrijd/${o.id}` } });
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const o = event.notification.data && event.notification.data.optin;
  if (o && (event.action === 'live-yes' || event.action === 'live-no')) { event.waitUntil(answerOptin(o, event.action === 'live-yes')); return; }
  const target = new URL('./' + (event.notification.data && event.notification.data.url || '#/home'), self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) { await win.focus(); return win.navigate ? win.navigate(target) : null; }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.includes('/flags/')) {
    event.respondWith(cacheFirst(request)); // vlaggen veranderen nooit: blijven bewaard over releases heen
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
