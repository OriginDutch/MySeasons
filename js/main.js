// Entry: thema, login-poort, router, service worker en installatie.

import { initTheme } from './theme.js';
import { watchAuth, signInWithGoogle, completeRedirectSignIn } from './firebase.js';
import { views } from './views.js';
import { esc, icons, toast } from './ui.js';
import { pastSeasonBar, openViewSheet } from './seasonsview.js';
import { setSeason } from './seasonstate.js';
import { CURRENT_SEASON } from './config.js';
import { autoSync } from './nightshift.js';
import { clubNamesLoaded, setClubOverrides } from './clubnames.js';
import { getClubMarks } from './store.js';

const appEl = document.getElementById('app');

const NAV = [
  { key: 'home', label: 'Home', icon: icons.home },
  { key: 'wedstrijden', label: 'Wedstrijden', icon: icons.calendar },
  { key: 'selectie', label: 'Selectie', icon: icons.users },
  { key: 'stats', label: 'Stats', icon: icons.stats },
  { key: 'meer', label: 'Meer', icon: icons.more },
];

let currentUser = null;
let deferredInstall = null;

const ctx = {
  get user() { return currentUser; },
  canInstall: () => !!deferredInstall,
  isStandalone: () => window.matchMedia('(display-mode: standalone)').matches,
  async promptInstall() {
    if (!deferredInstall) return false;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    deferredInstall = null;
    return outcome === 'accepted';
  },
};

// ---------- Login ----------

function renderLogin(errorText = '') {
  appEl.innerHTML = `
    <main class="login">
      <div class="login__brand">
        <span class="page-head__kicker">Persoonlijke seizoenstracker</span>
        <span class="wordmark">MySeasons</span>
      </div>
      <div class="login__actions">
        <button class="btn btn--primary btn--block" type="button" id="login-btn">${icons.google}<span>Inloggen met Google</span></button>
        <p class="login__error" id="login-error" role="alert">${esc(errorText)}</p>
      </div>
    </main>`;
  document.getElementById('login-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await signInWithGoogle();
    } catch (err) {
      btn.disabled = false;
      const msg = err && err.code === 'auth/popup-closed-by-user'
        ? 'Inloggen afgebroken.'
        : 'Inloggen lukte niet. Probeer het opnieuw.';
      document.getElementById('login-error').textContent = msg;
      console.error(err);
    }
  });
}

// ---------- App-schil en router ----------

function renderShell() {
  appEl.innerHTML = `
    <nav class="nav" aria-label="Hoofdmenu">
      ${NAV.map((n) => `<a class="nav__item" href="#/${n.key}" data-nav="${n.key}">${n.icon}<span>${n.label}</span></a>`).join('')}
    </nav>
    <div class="shell"><main class="view" id="view"></main></div>`;
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const key = (parts[0] || 'home').toLowerCase();
  return { key: views[key] ? key : 'home', args: parts.slice(1) };
}

function currentRoute() {
  return parseHash().key;
}

let routeToken = 0;

// Spoor van bezochte schermen binnen de app, zodat de terugknop teruggaat
// naar waar je vandaan kwam (en je scrollpositie daar terugkrijgt).
const trail = [];
function trackNavigation() {
  const hash = location.hash || '#/home';
  const top = trail[trail.length - 1];
  if (top && top.hash === hash) return null;
  const prev = trail[trail.length - 2];
  if (prev && prev.hash === hash) { trail.pop(); return prev.scroll; }
  trail.push({ hash, scroll: 0 });
  return 0;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-season-now]')) { setSeason(CURRENT_SEASON); route({ keepScroll: false }); return; }
  if (e.target.closest('[data-open-season]')) { openViewSheet(ctx); return; }
  const back = e.target.closest('.back-btn');
  if (!back || trail.length < 2) return; // geen app-geschiedenis: gewone link naar het hoofdscherm
  e.preventDefault();
  history.back();
});

async function route({ keepScroll = false } = {}) {
  if (!currentUser) return;
  if (!document.getElementById('view')) renderShell();
  const { key, args } = parseHash();
  const view = views[key];
  const navKey = view.navKey || key;
  const token = ++routeToken;

  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (!clubNamesLoaded()) await getClubMarks().then(setClubOverrides).catch(() => {}); // eigen clubnamen vóór het eerste scherm (offline: volgende keer opnieuw)

  let html;
  try {
    html = await view.render(ctx, args);
  } catch (err) {
    console.error(err);
    html = `<div class="empty"><span class="empty__title">Er ging iets mis</span><p class="muted">${esc(err.message || String(err))}</p></div>`;
  }
  if (token !== routeToken) return; // intussen naar een ander scherm genavigeerd

  // Vervang het view-element zodat oude event listeners verdwijnen.
  const old = document.getElementById('view');
  const fresh = old.cloneNode(false);
  fresh.dataset.view = key; // voor desktop-breedtes per scherm
  fresh.innerHTML = pastSeasonBar() + html;
  old.replaceWith(fresh);
  if (view.mount) view.mount(fresh, ctx, args);

  document.title = key === 'home' ? 'MySeasons' : `${view.title} · MySeasons`;
  if (!keepScroll) window.scrollTo(0, restoreScroll || 0);
  restoreScroll = 0;
}

let restoreScroll = 0;

ctx.refresh = () => route({ keepScroll: true });

window.addEventListener('hashchange', () => {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close()); // geen sheet laten hangen bij navigeren
  restoreScroll = trackNavigation() || 0;
  route();
});
window.addEventListener('scroll', () => {
  const top = trail[trail.length - 1];
  if (top) top.scroll = window.scrollY;
}, { passive: true });

// ---------- Installatie (PWA) ----------

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (currentRoute() === 'instellingen') route();
});

window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  toast('MySeasons staat op je startscherm');
});

// ---------- Service worker ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offerUpdate = (worker) => {
      toast('Nieuwe versie beschikbaar', {
        action: 'Vernieuwen',
        sticky: true,
        onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
  }).catch((err) => console.warn('Service worker niet geregistreerd', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

// ---------- Start ----------

initTheme();
registerServiceWorker();
completeRedirectSignIn();

watchAuth((user) => {
  currentUser = user;
  if (user) {
    renderShell();
    if (!trail.length) trackNavigation();
    route();
    // Nachtploeg op de achtergrond: brievenbus legen en wachtrij verversen.
    autoSync().then((s) => {
      if (s && s.items) { toast(`Nachtploeg: ${s.items} items binnengehaald`); route({ keepScroll: true }); }
    });
    // Meldingen: programma bij de Worker actueel houden (stuurt alleen bij wijzigingen).
    import('./meldingen.js').then((m) => m.pushSupported() && m.pushSchedule()).catch(() => {});
    // Eenmalig: losse rugnummers omzetten naar rugnummers per seizoen.
    import('./shirts.js').then((m) => m.migrateShirts()).catch(() => {});
    // Eenmalig: bestaande transfers aan bekende clubs koppelen.
    setTimeout(() => import('./clubpick.js').then((m) => m.linkTransferClubs()).catch(() => {}), 8000);
    // Wekelijkse back-up naar de Worker, rustig na het opstarten.
    setTimeout(() => import('./backup.js').then((m) => m.autoBackup()).then((r) => { if (r && r.ok) toast(`Wekelijkse back-up gemaakt · ${r.docs} documenten`); }).catch(() => {}), 20000);
  } else {
    renderLogin();
  }
});
