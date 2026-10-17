// Schermen. Home, Wedstrijden en de wedstrijdpagina staan in matchviews.js;
// Selectie en Stats tonen tot hun fase een rustige lege staat.

import { esc, icons, toast } from './ui.js';
import { matchViews } from './matchviews.js';
import { getCallsToday } from './store.js';
import { getThemePref, setThemePref } from './theme.js';
import { signOutUser, testConnection } from './firebase.js';
import { health } from './api.js';
import { APP_VERSION, APP_PHASE } from './version.js';

function head({ kicker, title, back }) {
  return `
    <header class="page-head">
      <div class="page-head__titles">
        ${back ? `<a class="back-btn" href="#/${esc(back)}" aria-label="Terug">${icons.back}</a>` : ''}
        <span class="page-head__kicker">${esc(kicker)}</span>
        <h1 class="page-head__title">${esc(title)}</h1>
      </div>
    </header>`;
}

function empty(title, text) {
  return `
    <div class="empty">
      <span class="empty__title">${esc(title)}</span>
      <p class="muted">${esc(text)}</p>
    </div>`;
}

export const views = {
  ...matchViews,

  selectie: {
    title: 'Selectie',
    render() {
      return `
        ${head({ kicker: 'MySeasons / Cambuur', title: 'Selectie' })}
        <section class="section">${empty('Nog leeg', 'Spelers en spelerspagina’s komen in fase 5.')}</section>`;
    },
  },

  stats: {
    title: 'Stats',
    render() {
      return `
        ${head({ kicker: 'MySeasons / 2026–27', title: 'Statistieken' })}
        <section class="section">${empty('Nog leeg', 'Statistieken, vergelijkingen en records komen in fase 7.')}</section>`;
    },
  },

  meer: {
    title: 'Meer',
    render() {
      return `
        ${head({ kicker: 'MySeasons', title: 'Meer' })}
        <section class="section">
          <nav class="list" aria-label="Meer">
            <a class="list-row" href="#/instellingen">
              <span class="list-row__main"><span class="list-row__title">Instellingen</span><span class="list-row__sub">Thema, account, verbinding</span></span>
              ${icons.chevron}
            </a>
            <div class="list-row" aria-disabled="true">
              <span class="list-row__main"><span class="list-row__title muted">Afwijkingen</span><span class="list-row__sub">Komt zodra er wedstrijddata is</span></span>
            </div>
          </nav>
        </section>
        <section class="section">
          <div class="section__label"><span>Versie</span><span>${esc(APP_VERSION)}</span></div>
          <p class="muted">${esc(APP_PHASE)}</p>
        </section>`;
    },
  },

  instellingen: {
    title: 'Instellingen',
    navKey: 'meer',
    async render(ctx) {
      const pref = getThemePref();
      let calls = 0;
      try { calls = await getCallsToday(); } catch { /* offline of rules: telling onbekend */ }
      const opts = [['light', 'Licht'], ['dim', 'Dim'], ['dark', 'Donker'], ['system', 'Systeem']];
      const user = ctx.user;
      return `
        ${head({ kicker: 'Meer / Instellingen', title: 'Instellingen', back: 'meer' })}

        <section class="section" aria-labelledby="sec-theme">
          <div class="section__label"><span id="sec-theme">01 — Weergave</span></div>
          <fieldset class="segmented" style="border-color: var(--rule); margin: 0; padding: 0;">
            <legend class="visually-hidden">Thema</legend>
            ${opts.map(([value, label]) => `
              <input type="radio" name="theme" id="theme-${value}" value="${value}" ${pref === value ? 'checked' : ''}>
              <label for="theme-${value}">${label}</label>`).join('')}
          </fieldset>
          <p class="muted" style="font-size: 12px">Systeem volgt de licht/donker-instelling van je telefoon.</p>
        </section>

        <section class="section" aria-labelledby="sec-account">
          <div class="section__label"><span id="sec-account">02 — Account</span></div>
          <dl class="kv">
            <dt>Naam</dt><dd>${esc(user.displayName || '—')}</dd>
            <dt>E-mail</dt><dd>${esc(user.email || '—')}</dd>
            <dt>UID</dt><dd class="mono" style="font-size: 12px">${esc(user.uid)}</dd>
          </dl>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button class="btn" type="button" data-action="copy-uid">UID kopiëren</button>
            <button class="btn" type="button" data-action="logout">Uitloggen</button>
          </div>
        </section>

        <section class="section" aria-labelledby="sec-conn">
          <div class="section__label"><span id="sec-conn">03 — Verbinding</span></div>
          <div class="status-line" id="conn-status"><span class="dot"></span><span>Nog niet getest</span></div>
          <p class="muted" id="conn-help" style="font-size: 12px"></p>
          <div><button class="btn" type="button" data-action="test-conn">Verbinding testen</button></div>
          <div class="status-line" id="api-status" style="margin-top: 8px"><span class="dot"></span><span>Highlightly-Worker: nog niet getest</span></div>
          <p class="muted" id="api-help" style="font-size: 12px"></p>
          <div><button class="btn" type="button" data-action="test-api">API testen</button></div>
          <p class="muted" style="font-size: 12px">API-calls vandaag (eigen telling): ${calls} van 100.</p>
        </section>

        <section class="section" aria-labelledby="sec-app">
          <div class="section__label"><span id="sec-app">04 — App</span><span>v${esc(APP_VERSION)}</span></div>
          <div id="install-slot">${ctx.canInstall()
            ? '<button class="btn btn--primary" type="button" data-action="install">App installeren</button>'
            : `<p class="muted" style="font-size: 12px">${ctx.isStandalone() ? 'Je gebruikt de geïnstalleerde app.' : 'Installeren kan via het browsermenu: “App installeren” of “Toevoegen aan startscherm”.'}</p>`}</div>
        </section>`;
    },
    mount(root, ctx) {
      root.querySelectorAll('input[name="theme"]').forEach((input) => {
        input.addEventListener('change', () => setThemePref(input.value));
      });

      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'copy-uid') {
          try {
            await navigator.clipboard.writeText(ctx.user.uid);
            toast('UID gekopieerd');
          } catch {
            toast('Kopiëren lukte niet, selecteer de UID handmatig');
          }
        }

        if (action === 'logout') {
          await signOutUser();
        }

        if (action === 'install') {
          const accepted = await ctx.promptInstall();
          if (accepted) toast('MySeasons wordt geïnstalleerd');
        }

        if (action === 'test-api') {
          const status = root.querySelector('#api-status');
          const help = root.querySelector('#api-help');
          btn.disabled = true;
          status.innerHTML = '<span class="dot"></span><span>Bezig met testen…</span>';
          help.textContent = '';
          try {
            await health();
            status.innerHTML = '<span class="dot dot--ok"></span><span>Worker bereikbaar, je hebt toegang</span>';
          } catch (err) {
            status.innerHTML = `<span class="dot dot--warn"></span><span>${esc(err.message)}</span>`;
            const hints = {
              0: 'Kan de Worker niet bereiken. Is hij gedeployd, en staat de code erin?',
              401: 'De Worker accepteert je login niet. Staat de juiste code erin?',
              403: 'ALLOWED_UID in de Worker komt niet overeen met je UID hierboven.',
              500: 'Zet HIGHLIGHTLY_KEY en ALLOWED_UID in de Worker onder Settings → Variables and Secrets.',
            };
            help.textContent = hints[err.status] || (err.detail ? String(err.detail) : '');
          } finally {
            btn.disabled = false;
          }
        }

        if (action === 'test-conn') {
          const status = root.querySelector('#conn-status');
          const help = root.querySelector('#conn-help');
          btn.disabled = true;
          status.innerHTML = '<span class="dot"></span><span>Bezig met testen…</span>';
          help.textContent = '';
          const res = await testConnection(ctx.user.uid);
          btn.disabled = false;
          if (res.ok) {
            status.innerHTML = '<span class="dot dot--ok"></span><span>Verbonden met Firestore</span>';
          } else {
            status.innerHTML = `<span class="dot dot--warn"></span><span>${esc(res.message)}</span>`;
            if (res.reason === 'rules') {
              help.textContent = 'Kopieer je UID hierboven en zet hem in de Firestore-rules in de Firebase console.';
            }
          }
        }
      });
    },
  },
};
