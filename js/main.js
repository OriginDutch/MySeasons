// Entry: thema, login-poort, router, service worker en installatie.

import { initTheme } from './theme.js';
import { watchAuth, signInWithGoogle, completeRedirectSignIn } from './firebase.js';
import { views } from './views.js';
import { esc, icons, toast } from './ui.js';

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

function currentRoute() {
  const key = (location.hash.replace(/^#\/?/, '').split('/')[0] || 'home').toLowerCase();
  return views[key] ? key : 'home';
}

function route() {
  if (!currentUser) return;
  if (!document.getElementById('view')) renderShell();
  const key = currentRoute();
  const view = views[key];
  const navKey = view.navKey || key;

  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  // Vervang het view-element zodat oude event listeners verdwijnen.
  const old = document.getElementById('view');
  const fresh = old.cloneNode(false);
  fresh.innerHTML = view.render(ctx);
  old.replaceWith(fresh);
  if (view.mount) view.mount(fresh, ctx);

  document.title = key === 'home' ? 'MySeasons' : `${view.title} · MySeasons`;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

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
    route();
  } else {
    renderLogin();
  }
});
