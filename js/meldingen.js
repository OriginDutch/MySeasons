// Meldingen op wedstrijddag: om 09:00 "Veel plezier bij…" (thuis) of "Succes met…" (uit).
// De Worker verstuurt; deze module meldt dit apparaat aan en zet het programma klaar.

import { esc, icons, toast } from './ui.js';
import { push } from './api.js';
import { MAIN_CLUB } from './config.js';
import { getAllMatches } from './store.js';
import { explain, runWithButton } from './matchviews.js';

const TEAM = MAIN_CLUB.id;
const SCHED_KEY = 'ms-push-sched';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const m = ua.match(/\(([^)]+)\)/);
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : (m ? m[1].split(';')[0] : 'apparaat');
  const br = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${br}`;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Deze browser ondersteunt geen pushmeldingen');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Meldingen zijn geblokkeerd voor deze app. Zet ze aan in de instellingen van je browser of telefoon.' : 'Geen toestemming gegeven');
  const { publicKey } = await push.key();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Andere sleutel dan waarmee we ooit aanmeldden? Dan opnieuw.
  if (sub && sub.options && sub.options.applicationServerKey) {
    const had = new Uint8Array(sub.options.applicationServerKey);
    const want = keyBytes(publicKey);
    if (had.length !== want.length || had.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await push.subscribe(sub.toJSON(), deviceLabel());
  await pushSchedule({ force: true });
  return sub;
}

export async function disablePush() {
  const sub = await currentSub();
  if (sub) {
    await push.unsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}

/** Komende Cambuur-wedstrijden (60 dagen) naar de Worker. Alleen als er iets veranderd is. */
export async function pushSchedule({ force = false } = {}) {
  const now = Date.now();
  const list = (await getAllMatches())
    // Ook de afgelopen 2 dagen: dan kan de Worker de uitslag ophalen en de volgende ochtend nog eens controleren.
    .filter((m) => Date.parse(m.date) > now - 48 * 3600e3 && Date.parse(m.date) < now + 60 * 864e5 && m.status !== 'postponed')
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map((m) => ({
      id: m.id, date: m.date, home: !!(m.homeTeam && m.homeTeam.id === TEAM),
      homeName: m.homeTeam ? m.homeTeam.name : '', awayName: m.awayTeam ? m.awayTeam.name : '',
      comp: m.league ? m.league.name + (/regular season/i.test(m.round || '') ? ` R${(m.round.match(/(\d+)\s*$/) || [])[1] || ''}` : '') : '',
      venue: m.detail && m.detail.venue && m.detail.venue.name ? m.detail.venue.name : '',
    }));
  const sig = JSON.stringify(list);
  let prev = null; try { prev = localStorage.getItem(SCHED_KEY); } catch { /* niet erg */ }
  if (!force && prev === sig) return { changed: false, scheduled: list.length };
  const r = await push.schedule(list);
  try { localStorage.setItem(SCHED_KEY, sig); } catch { /* niet erg */ }
  return r;
}

export const meldingenViews = {
  meldingen: {
    title: 'Meldingen',
    navKey: 'meer',
    async render() {
      const head = `<header class="page-head"><div class="page-head__titles">
        <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
        <span class="page-head__kicker">Meer / Meldingen</span><h1 class="page-head__title">Meldingen</h1></div></header>`;
      if (!pushSupported()) {
        return `${head}<section class="section"><p class="muted">Deze browser ondersteunt geen pushmeldingen. Op je telefoon werkt het als je de app installeert (vanuit Chrome: “Toevoegen aan startscherm”).</p></section>`;
      }
      let info = null; let err = null;
      try { info = await push.key(); } catch (e) { err = e; }
      const sub = await currentSub().catch(() => null);
      const perm = Notification.permission;
      const on = !!sub && perm === 'granted';
      return `${head}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">Op wedstrijddag om 09:00: <strong>“Veel plezier bij…”</strong> bij een thuiswedstrijd, <strong>“Succes met…”</strong> bij een uitwedstrijd. Met de aftrap erbij; tik erop en je staat op de wedstrijdpagina.</p>
          ${err ? `<p class="warn-line">${esc(err.status === 404 ? 'De Worker kent meldingen nog niet: de nieuwe versie is nog niet gedeployd.' : explain(err))}</p>` : ''}
          <div class="kv-line"><span>Op dit apparaat</span><span class="mono">${on ? 'aan' : perm === 'denied' ? 'geblokkeerd' : 'uit'}</span></div>
          ${info ? `<div class="kv-line"><span>Aangemelde apparaten</span><span class="mono">${info.devices}</span></div>
          <div class="kv-line"><span>Wedstrijden klaargezet</span><span class="mono">${info.scheduled}</span></div>` : ''}
          ${perm === 'denied' ? '<p class="muted" style="font-size:var(--fs-sm)">Je hebt meldingen voor deze app geblokkeerd. Zet ze aan via de site-instellingen van je browser (slotje naast het adres) of de app-instellingen van je telefoon, en kom dan terug.</p>' : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${on
              ? `<button class="btn" type="button" data-push="test">Testmelding sturen</button><button class="btn" type="button" data-push="off">Uitzetten op dit apparaat</button>`
              : `<button class="btn btn--primary" type="button" data-push="on" ${err || perm === 'denied' ? 'disabled' : ''}>Aanzetten op dit apparaat</button>`}
          </div>
          <p class="muted" style="font-size:var(--fs-sm)">Het programma wordt bijgewerkt telkens als je het seizoen synchroniseert. Een verplaatste wedstrijd komt dus vanzelf goed na de volgende synchronisatie.</p>
        </section>
        ${info ? `<section class="section">
          <div class="section__label"><span>Uitslag automatisch ophalen</span></div>
          <p class="muted" style="font-size:var(--fs-md)">Zo'n 2,5 uur na de aftrap haalt de Worker uitslag, opstelling, tijdlijn en spelersstats op (3 calls, plus 1 voor de stand). Nog niet afgelopen? Elk half uur opnieuw, tot 6 uur na de aftrap. De volgende ochtend om 08:00 nog één controle (3 calls). Open je de app, dan staat alles erin.</p>
          <label class="field field--check"><input type="checkbox" data-pref="results" ${info.prefs && info.prefs.results === false ? '' : 'checked'}> <span>Uitslag automatisch ophalen</span></label>
          <label class="field field--check"><input type="checkbox" data-pref="resultPush" ${info.prefs && info.prefs.resultPush === false ? '' : 'checked'} ${info.prefs && info.prefs.results === false ? 'disabled' : ''}> <span>Melding als de uitslag binnen is</span></label>
        </section>` : ''}`;
    },
    mount(root, ctx) {
      root.addEventListener('change', async (e) => {
        const c = e.target.closest('[data-pref]');
        if (!c) return;
        try { await push.prefs({ [c.dataset.pref]: c.checked }); toast(c.checked ? 'Staat aan' : 'Staat uit'); ctx.refresh(); } catch (err) { c.checked = !c.checked; toast(explain(err)); }
      });
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-push]');
        if (!b) return;
        try {
          if (b.dataset.push === 'on') { await runWithButton(b, 'Aanmelden…', () => enablePush()); toast('Meldingen staan aan'); }
          if (b.dataset.push === 'off') { await runWithButton(b, 'Uitzetten…', () => disablePush()); toast('Meldingen uit op dit apparaat'); }
          if (b.dataset.push === 'test') { const r = await runWithButton(b, 'Versturen…', () => push.test()); toast(r.sent ? `Testmelding verstuurd naar ${r.sent} ${r.sent === 1 ? 'apparaat' : 'apparaten'}` : 'Geen apparaat bereikt. Zet meldingen opnieuw aan.'); }
          ctx.refresh();
        } catch (err) { toast(err.message && !err.status ? err.message : explain(err)); }
      });
    },
  },
};
