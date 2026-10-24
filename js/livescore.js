// Live tijdens de Cambuur-wedstrijd. De Worker vraagt Highlightly elke minuut (of zuiniger bij weinig budget)
// en bewaart de stand; de app leest die bij de Worker (/live), elke 30 seconden zolang het scherm open is.
// Kost de app dus geen Highlightly-calls. Meldingen per apparaat: Meer → Meldingen, en per wedstrijd het belletje.

import { esc, toast } from './ui.js';
import { live, push } from './api.js';
import { MAIN_CLUB } from './config.js';
import { getAllMatches } from './store.js';
import { pushSupported } from './meldingen.js';

const TEAM = MAIN_CLUB.id;
const POLL = 30e3;
let STATE = { matches: [], at: 0 };
let timer = null;
let DEVICE = null; // { endpoint, live, mute } van dit apparaat, of null

const kickoff = (m) => Date.parse(m.ko || m.date);
const inWindow = (m, now = Date.now()) => { const ko = kickoff(m); return ko && now >= ko - 15 * 60e3 && now <= ko + 3 * 3600e3; };

async function candidates() {
  const now = Date.now();
  return (await getAllMatches().catch(() => [])).filter((m) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === TEAM) && !m.manual && inWindow(m, now));
}

async function poll() {
  if (document.hidden) return;
  if (!(await candidates()).length) { if (STATE.matches.length) { STATE = { matches: [], at: Date.now() }; paint(); } return; }
  try { STATE = { ...(await live()), at: Date.now() }; paint(); } catch { /* offline of Worker nog oud: volgende keer */ }
}

export function startLive() {
  if (timer) return;
  poll();
  timer = setInterval(poll, POLL);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('hashchange', () => setTimeout(paint, 400));
  loadDevice();
}

async function loadDevice() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (!sub) { DEVICE = null; return; }
    const r = await push.device(sub.endpoint);
    DEVICE = { endpoint: sub.endpoint, live: r.live, mute: r.mute || [] };
  } catch { DEVICE = null; }
}
export const deviceLive = async () => { await loadDevice(); return DEVICE; };

export async function setDeviceLive(patch) {
  if (!DEVICE) await loadDevice();
  if (!DEVICE) throw new Error('Zet eerst meldingen aan op dit apparaat (Meer → Meldingen).');
  const r = await push.device(DEVICE.endpoint, patch);
  DEVICE = { ...DEVICE, live: r.live, mute: r.mute || [] };
  return DEVICE;
}

// ---------- Weergave ----------
const clockOf = (s) => {
  if (!s) return '';
  if (s.status === 'ht') return 'Rust';
  if (s.status === 'ft') return 'Einde';
  if (s.status === 'pre') return 'Zo meteen';
  if (s.status === 'off') return 'Gestaakt / uitgesteld';
  const since = s.at ? Math.floor((Date.now() - Date.parse(s.at)) / 60e3) : 0;
  const c = s.clock != null ? s.clock + since : null;
  return c != null ? `${c > 90 ? '90+' : c}'` : 'Live';
};
const timeOf = (iso) => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m <= 0 ? 'net' : `${m} min geleden`; };

function eventsHtml(s) {
  const ev = (s.events || []).filter((e) => e.kind !== 'sub').slice().sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
  if (!ev.length) return '';
  return `<ol class="live-ev">${ev.map((e) => {
    const own = /own/i.test(e.type); const us = (e.teamId === TEAM) !== (e.kind === 'goal' && own);
    return `<li class="${us ? 'is-us' : ''}"><span class="mono">${e.minute ?? ''}${e.extra ? '+' + e.extra : ''}'</span> ${e.kind === 'goal' ? '⚽' : '🟥'} ${esc(e.player || '?')}${own ? ' <span class="muted">(e.d.)</span>' : ''}${/penalty/i.test(e.type) ? ' <span class="muted">(pen.)</span>' : ''}</li>`;
  }).join('')}</ol>`;
}

function bell(id) {
  if (!DEVICE) return '';
  const muted = (DEVICE.mute || []).includes(String(id));
  const off = DEVICE.live && DEVICE.live.on === false;
  return `<button class="btn btn--sm live-bell" type="button" data-live-mute="${esc(String(id))}" data-muted="${muted ? '1' : ''}" ${off ? 'disabled title="Live meldingen staan uit (Meer → Meldingen)"' : ''}>${muted || off ? '🔕 Meldingen uit' : '🔔 Meldingen aan'}</button>`;
}

function card(x, { full = false } = {}) {
  const s = x.state;
  const sc = s && s.score ? `${s.score.home}<span class="muted">–</span>${s.score.away}` : '<span class="muted">vs</span>';
  const isLive = s && (s.status === 'live' || s.status === 'ht');
  return `<section class="section live-card ${isLive ? 'is-live' : ''}" data-live-card>
    <div class="section__label"><span>${isLive ? '<span class="live-dot"></span>LIVE' : s && s.status === 'ft' ? 'Afgelopen' : 'Vandaag'} · ${esc(clockOf(s) || `aftrap ${timeOf(x.ko)}`)}</span><span>${esc(x.comp || '')}</span></div>
    <a class="live-score" href="#/wedstrijd/${esc(x.id)}"><span>${esc(x.homeName)}</span><b class="mono">${sc}</b><span>${esc(x.awayName)}</span></a>
    ${s ? eventsHtml(s) : '<p class="muted" style="margin:0;font-size:var(--fs-sm)">De Worker begint 10 minuten voor de aftrap met volgen.</p>'}
    <div class="live-foot"><span class="muted">${s ? `bijgewerkt ${ago(s.at)}${s.every > 1 ? ` · elke ${s.every} min (zuinig budget)` : ''}` : ''}</span>${full || isLive || (s && s.status === 'pre') || !s ? bell(x.id) : ''}</div>
  </section>`;
}

/** Slot in het huidige scherm vullen (Home: bovenaan; wedstrijdpagina van die wedstrijd: onder de kop). */
export function paint() {
  const view = document.getElementById('view');
  if (!view) return;
  view.querySelectorAll('[data-live-card]').forEach((el) => el.remove());
  const key = view.dataset.view;
  const id = (location.hash.match(/^#\/wedstrijd\/([^/?]+)/) || [])[1];
  const list = (STATE.matches || []).filter((x) => x.state || inWindow(x));
  if (!list.length) return;
  const head = view.querySelector('.page-head');
  const put = (html) => { const t = document.createElement('div'); t.innerHTML = html; const el = t.firstElementChild; if (head) head.after(el); else view.prepend(el); };
  if (key === 'home') list.slice(0, 2).reverse().forEach((x) => put(card(x)));
  else if (key === 'wedstrijd' && id) { const x = list.find((y) => String(y.id) === String(id)); if (x) put(card(x, { full: true })); }
}

/** Belletje op de wedstrijdpagina van een komende Cambuur-wedstrijd (buiten het live-venster). */
export function bellHtml(m) {
  if (!m || m.status === 'finished' || m.manual || !DEVICE) return '';
  if (![m.homeTeam, m.awayTeam].some((t) => t && t.id === TEAM)) return '';
  return `<div class="btn-row">${bell(m.id)}<span class="muted" style="font-size:var(--fs-sm)">live meldingen voor dit duel op dit apparaat</span></div>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-live-mute]');
  if (!b) return;
  e.preventDefault();
  const id = b.dataset.liveMute; const muted = !!b.dataset.muted;
  b.disabled = true;
  try {
    await setDeviceLive({ mute: { [id]: !muted } });
    toast(muted ? 'Live meldingen voor dit duel staan aan' : 'Geen live meldingen voor dit duel');
    document.querySelectorAll(`[data-live-mute="${CSS.escape(id)}"]`).forEach((x) => { x.outerHTML = bell(id); });
  } catch (err) { toast(err.message || String(err)); b.disabled = false; }
});
