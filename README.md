# MySeasons

Persoonlijke seizoenstracker voor SC Cambuur en het Nederlandse betaald voetbal.
Opvolger van de Cambuur Tracker.

- **Frontend:** vanilla JS (ES-modules), geen build-step, gehost op GitHub Pages
- **Data:** Firestore met offline cache; alleen het eigen Google-account heeft toegang
- **Wedstrijddata:** Highlightly API, via een Cloudflare Worker (de API-key staat nooit in deze repo)
- **App:** installeerbaar als PWA

## Structuur

```
index.html              app-schil
manifest.webmanifest    PWA-manifest
sw.js                   service worker (cachet de app-schil)
firestore.rules         security rules (plakken in de Firebase console)
css/tokens.css          kleuren per thema: light, dim, dark
css/app.css             basisstijlen, Swiss grid, mobile-first
js/main.js              start: thema, login-poort, router, service worker
js/firebase.js          Firebase-config, login, Firestore, verbindingstest
js/views.js             schermen
js/theme.js             thema-voorkeur
js/ui.js                iconen, escapen, toasts
js/version.js           versienummer
icons/                  app-iconen
```

## Release

Bij elke release `APP_VERSION` in `js/version.js` en `CACHE_VERSION` in `sw.js` samen ophogen,
anders blijft de geïnstalleerde app de oude versie uit de cache tonen.

## Geen geheimen in deze repo

De Firebase-webconfig in `js/firebase.js` is bedoeld om publiek te zijn. Echte geheimen
(Highlightly-key, GitHub-token voor backups) staan uitsluitend als secrets in de Cloudflare Worker.
Foto's van spelers, trainers en stadions komen nooit in deze repo.
