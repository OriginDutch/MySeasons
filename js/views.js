// Schermen. Home, Wedstrijden en de wedstrijdpagina staan in matchviews.js;
// Selectie en Stats tonen tot hun fase een rustige lege staat.

import { esc, icons, toast } from './ui.js';
import { matchViews } from './matchviews.js';
import { editorViews } from './editor.js';
import { playerViews } from './playerviews.js';
import { magazineViews } from './magazine.js';
import { seasonViews } from './seasonsview.js';
import { importViews } from './importer.js';
import { clubViews } from './clubview.js';
import { nightViews } from './nightview.js';
import { backupViews } from './backup.js';
import { inboxViews } from './inbox.js';
import { meldingenViews } from './meldingen.js';
import { clubNamesViews } from './clubnamesview.js';
import { leaguesViews } from './leaguesview.js';
import { coachViews } from './coachview.js';
import { photosViews } from './photosview.js';
import { squadSiteViews } from './squadsite.js';
import { getCallsToday, getAllMatches, getAllNotes, attachDetails } from './store.js';
import { applyCorrections, correctionSummary } from './corrections.js';
import { getThemePref, setThemePref, getClubColors, setClubColors } from './theme.js';
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
  ...editorViews,
  ...playerViews,
  ...magazineViews,
  ...seasonViews,
  ...importViews,
  ...clubViews,
  ...nightViews,
  ...backupViews,
  ...inboxViews,
  ...meldingenViews,
  ...clubNamesViews,
  ...leaguesViews,
  ...coachViews,
  ...photosViews,
  ...squadSiteViews,

  meer: {
    title: 'Meer',
    async render() {
      let total = 0; let conflicts = 0;
      try {
        const [all, notes] = await Promise.all([getAllMatches(), getAllNotes()]);
        const list = await attachDetails(all.filter((m) => notes[m.id]));
        list.forEach((m) => {
          if (!notes[m.id]) return;
          const c = correctionSummary(applyCorrections(m, notes[m.id]).statuses);
          total += c.total; conflicts += c.conflicts;
        });
      } catch { /* offline: telling onbekend */ }
      return `
        ${head({ kicker: 'MySeasons', title: 'Meer' })}
        <section class="section">
          <nav class="list" aria-label="Meer">
            <a class="list-row" href="#/instellingen">
              <span class="list-row__main"><span class="list-row__title">Instellingen</span><span class="list-row__sub">Thema, account, verbinding</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/seizoenen">
              <span class="list-row__main"><span class="list-row__title">Seizoenen</span><span class="list-row__sub">Oude seizoenen bekijken, ophalen of aanmaken</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/inbox">
              <span class="list-row__main"><span class="list-row__title">Inbox</span><span class="list-row__sub">Wat je nog kunt aanvullen of nakijken</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/meldingen">
              <span class="list-row__main"><span class="list-row__title">Meldingen</span><span class="list-row__sub">“Veel plezier bij…” om 09:00 op wedstrijddag</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/clubsite">
              <span class="list-row__main"><span class="list-row__title">Clubsite</span><span class="list-row__sub">Selectiepagina's volgen: verschillen met je selectie</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/competities">
              <span class="list-row__main"><span class="list-row__title">Competities</span><span class="list-row__sub">Welke competities je volgt: toevoegen, aan/uit, niveau</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/trainers">
              <span class="list-row__main"><span class="list-row__title">Trainers</span><span class="list-row__sub">Aanstellingen en foto's</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/fotos">
              <span class="list-row__main"><span class="list-row__title">Foto's</span><span class="list-row__sub">Overzicht, alle links binnenhalen, nieuwe versies</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/clubnamen">
              <span class="list-row__main"><span class="list-row__title">Clubnamen</span><span class="list-row__sub">Eigen naam, korte naam en code per club</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/backup">
              <span class="list-row__main"><span class="list-row__title">Back-up</span><span class="list-row__sub">Alles exporteren als bestand, of terugzetten</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/nachtploeg">
              <span class="list-row__main"><span class="list-row__title">Nachtploeg</span><span class="list-row__sub">Restquotum 's nachts: details, schutters en oude seizoenen</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/importeren">
              <span class="list-row__main"><span class="list-row__title">Importeren</span><span class="list-row__sub">Oude Cambuur Tracker-export: spelers (meer volgt)</span></span>
              ${icons.chevron}
            </a>
            <a class="list-row" href="#/afwijkingen">
              <span class="list-row__main"><span class="list-row__title">Afwijkingen</span><span class="list-row__sub">${total ? `${total} eigen ${total === 1 ? 'correctie' : 'correcties'}${conflicts ? ` · <strong class="accent-text">${conflicts} conflict</strong>` : ''}` : 'Jouw correcties op Highlightly-data'}</span></span>
              ${icons.chevron}
            </a>
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
          <p class="muted" style="font-size:var(--fs-sm)">Systeem volgt de licht/donker-instelling van je telefoon.</p>
          <fieldset class="segmented" style="border-color: var(--rule); margin: 8px 0 0; padding: 0; grid-template-columns: repeat(2, minmax(0, 1fr));">
            <legend class="visually-hidden">Clubkleuren</legend>
            <input type="radio" name="club" id="club-on" value="on" ${getClubColors() ? 'checked' : ''}><label for="club-on">Clubkleuren</label>
            <input type="radio" name="club" id="club-off" value="off" ${getClubColors() ? '' : 'checked'}><label for="club-off">Neutraal</label>
          </fieldset>
          <p class="muted" style="font-size:var(--fs-sm)">Clubkleuren kleuren de app in de kleuren van de club die je bekijkt.</p>
        </section>

        <section class="section" aria-labelledby="sec-account">
          <div class="section__label"><span id="sec-account">02 — Account</span></div>
          <dl class="kv">
            <dt>Naam</dt><dd>${esc(user.displayName || '—')}</dd>
            <dt>E-mail</dt><dd>${esc(user.email || '—')}</dd>
            <dt>UID</dt><dd class="mono selectable" style="font-size:var(--fs-sm)">${esc(user.uid)}</dd>
          </dl>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button class="btn" type="button" data-action="copy-uid">UID kopiëren</button>
            <button class="btn" type="button" data-action="logout">Uitloggen</button>
          </div>
        </section>

        <section class="section" aria-labelledby="sec-conn">
          <div class="section__label"><span id="sec-conn">03 — Verbinding</span></div>
          <div class="status-line" id="conn-status"><span class="dot"></span><span>Nog niet getest</span></div>
          <p class="muted" id="conn-help" style="font-size:var(--fs-sm)"></p>
          <div><button class="btn" type="button" data-action="test-conn">Verbinding testen</button></div>
          <div class="status-line" id="api-status" style="margin-top: 8px"><span class="dot"></span><span>Highlightly-Worker: nog niet getest</span></div>
          <p class="muted" id="api-help" style="font-size:var(--fs-sm)"></p>
          <div><button class="btn" type="button" data-action="test-api">API testen</button></div>
          <p class="muted" style="font-size:var(--fs-sm)">API-calls vandaag (eigen telling): ${calls} van 100.</p>
        </section>

        <section class="section" aria-labelledby="sec-app">
          <div class="section__label"><span id="sec-app">04 — App</span><span>v${esc(APP_VERSION)}</span></div>
          <div id="install-slot">${ctx.canInstall()
            ? '<button class="btn btn--primary" type="button" data-action="install">App installeren</button>'
            : `<p class="muted" style="font-size:var(--fs-sm)">${ctx.isStandalone() ? 'Je gebruikt de geïnstalleerde app.' : 'Installeren kan via het browsermenu: “App installeren” of “Toevoegen aan startscherm”.'}</p>`}</div>
        </section>`;
    },
    mount(root, ctx) {
      root.querySelectorAll('input[name="theme"]').forEach((input) => {
        input.addEventListener('change', () => setThemePref(input.value));
      });
      root.querySelectorAll('input[name="club"]').forEach((input) => {
        input.addEventListener('change', () => setClubColors(input.value === 'on'));
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
