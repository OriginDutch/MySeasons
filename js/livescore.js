// Live tijdens de Cambuur-wedstrijd. De Worker vraagt Highlightly elke minuut (of zuiniger bij weinig budget)
// en bewaart de stand; de app leest die bij de Worker (/live), elke 15 seconden zolang het scherm open is.
// Daarnaast het live-bord van de hele speelronde (liveboard.js): de Home-balk, het nav-bolletje en #/speelronde.
// Kost de app dus geen Highlightly-calls. Meldingen per apparaat: Meer → Meldingen, en per wedstrijd het belletje.

import { esc, toast } from './ui.js';
import { live, push } from './api.js';
import { MAIN_CLUB } from './config.js';
import { getAllMatches } from './store.js';
import { pushSupported } from './meldingen.js';
import { loadProgram, boardWindow, todayRows, homeBarHtml, liveCount, liveMinute, cupWindow, cupFollow } from './liveboard.js';

const TEAM = MAIN_CLUB.id;
const POLL = 15e3; // de Worker ververst elke 30 s (meting) of elke minuut
let STATE = { matches: [], at: 0 };
let timer = null;
let DEVICE = null; // { endpoint, live, mute } van dit apparaat, of null

const kickoff = (m) => Date.parse(m.ko || m.date);
const inWindow = (m, now = Date.now()) => { const ko = kickoff(m); return ko && now >= ko - 15 * 60e3 && now <= ko + 3 * 3600e3; };

async function candidates() {
  const now = Date.now();
  return (await getAllMatches().catch(() => [])).filter((m) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === TEAM) && !m.manual && inWindow(m, now));
}

export const liveState = () => STATE;
export const pollNow = () => poll();

async function poll() {
  if (document.hidden) return;
  await loadProgram().catch(() => []);
  const own = (await candidates()).length;
  const today = todayRows(STATE).length;
  // Alleen de Worker vragen als er iets in het venster zit, of eens per 5 minuten op een speeldag (uitslagen).
  if (!own && !boardWindow() && !(today && Date.now() - STATE.at > 5 * 60e3)) { paint(); return; }
  try {
    // Beker op aanvraag: alleen als er vandaag een bekerduel in het venster zit (de Worker ververst hooguit elke 2 min,
    // een gevolgd duel elke 30 s).
    const cup = cupWindow();
    STATE = { ...(await live(cup ? { cup: 1, match: cupFollow() || undefined } : undefined)), at: Date.now() };
    paint();
    window.dispatchEvent(new CustomEvent('live:update'));
    takeResults();
  } catch { /* offline of Worker nog oud: volgende keer */ }
}

// Eindstanden van het live-bord liggen in de brievenbus: meteen verwerken als de app open is.
let lastInbox = null;
try { lastInbox = localStorage.getItem('ms-live-inbox'); } catch { /* niet erg */ }
async function takeResults() {
  const at = STATE.board && STATE.board.inboxAt;
  if (!at || at === lastInbox) return;
  lastInbox = at;
  try { localStorage.setItem('ms-live-inbox', at); } catch { /* niet erg */ }
  try {
    const { emptyInbox } = await import('./nightshift.js');
    const s = await emptyInbox();
    if (s && s.items) { await loadProgram(true); window.dispatchEvent(new CustomEvent('live:update')); }
  } catch { /* de nachtploeg pakt het later op */ }
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
    DEVICE = { endpoint: sub.endpoint, live: r.live, mute: r.mute || [], optin: r.optin || [] };
  } catch { DEVICE = null; }
}
export const deviceLive = async () => { await loadDevice(); return DEVICE; };

export async function setDeviceLive(patch) {
  if (!DEVICE) await loadDevice();
  if (!DEVICE) throw new Error('Zet eerst meldingen aan op dit apparaat (Meer → Meldingen).');
  const r = await push.device(DEVICE.endpoint, patch);
  DEVICE = { ...DEVICE, live: r.live, mute: r.mute || [], optin: r.optin || [] };
  return DEVICE;
}

// ---------- Weergave ----------
const clockOf = (s) => {
  if (!s) return '';
  if (s.status === 'ht') return 'Rust';
  if (s.status === 'ft') return 'Einde';
  if (s.status === 'pre') return 'Zo meteen';
  if (s.status === 'off') return 'Gestaakt / uitgesteld';
  return liveMinute(s.status, s.anch, s.clock, s.at) || 'Live';
};
const timeOf = (iso) => new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60e3); return m <= 0 ? 'net' : `${m} min geleden`; };

/** Aan welke kant hoort een event? Een eigen goal telt voor de andere club. */
function sideOf(e, s) {
  const home = s.home && s.home.id; const away = s.away && s.away.id;
  let t = e.teamId;
  if (e.kind === 'goal' && /own/i.test(e.type || '')) t = t === home ? away : t === away ? home : t;
  return t === away ? 'away' : 'home';
}

/** Goals en kaarten op volgorde: thuis links uitgelijnd, uit rechts. Cambuur in de accentkleur, de tegenstander grijs. */
function eventsHtml(s) {
  const ev = (s.events || []).filter((e) => e.kind === 'goal' || e.kind === 'red' || e.kind === 'yellow').slice().sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (a.extra ?? 0) - (b.extra ?? 0));
  if (!ev.length) return '';
  const icon = { goal: '⚽', red: '🟥', yellow: '🟨' };
  const item = (e, side) => {
    const club = side === 'home' ? s.home : s.away;
    const us = club && club.id === TEAM;
    const min = `<span class="mono live-ev__min">${e.minute ?? ''}${e.extra ? '+' + e.extra : ''}'</span>`;
    const tag = `${/own/i.test(e.type || '') && e.kind === 'goal' ? ' <span class="live-ev__tag">(e.d.)</span>' : ''}${/penalty/i.test(e.type || '') && e.kind === 'goal' ? ' <span class="live-ev__tag">(pen.)</span>' : ''}`;
    const name = `${icon[e.kind]} ${esc(e.player || '?')}${tag}`;
    return `<li class="live-ev__${e.kind}${us ? ' is-us' : ' is-them'}">${side === 'home' ? `${min} ${name}` : `${name} ${min}`}</li>`;
  };
  // Eén lijst op volgorde van de minuut; elke regel lijnt uit naar de kant van zijn club.
  return `<ol class="live-ev">${ev.map((e) => { const side = sideOf(e, s); return item(e, side).replace('<li class="', `<li class="live-ev--${side} `); }).join('')}</ol>`;
}

function bell(id, ko = KO.get(String(id))) {
  if (!DEVICE) return '';
  if (ko) KO.set(String(id), ko);
  const ask = ko && askMode(ko);
  const muted = ask ? !(DEVICE.optin || []).includes(String(id)) : (DEVICE.mute || []).includes(String(id));
  const off = DEVICE.live && DEVICE.live.on === false;
  return `<button class="btn btn--sm live-bell" type="button" data-live-mute="${esc(String(id))}" data-ask="${ask ? '1' : ''}" data-muted="${muted ? '1' : ''}" ${off ? 'disabled title="Live meldingen staan uit (Meer → Meldingen)"' : ''}>${muted || off ? '🔕 Meldingen uit' : '🔔 Meldingen aan'}</button>`;
}

function card(x, { full = false } = {}) {
  const s = x.state;
  const sc = s && s.score ? `${s.score.home}<span class="muted">–</span>${s.score.away}` : '<span class="muted">vs</span>';
  const isLive = s && (s.status === 'live' || s.status === 'ht');
  return `<section class="section live-card ${isLive ? 'is-live' : ''}" data-live-card>
    <div class="section__label"><span>${isLive ? '<span class="live-dot"></span>LIVE' : s && s.status === 'ft' ? 'Afgelopen' : 'Vandaag'} · ${esc(clockOf(s) || `aftrap ${timeOf(x.ko)}`)}</span><span>${esc(x.comp || '')}</span></div>
    <a class="live-score" href="#/wedstrijd/${esc(x.id)}"><span>${esc(x.homeName)}</span><b class="mono">${sc}</b><span>${esc(x.awayName)}</span></a>
    ${s ? eventsHtml(s) : '<p class="muted" style="margin:0;font-size:var(--fs-sm)">De Worker begint 10 minuten voor de aftrap met volgen.</p>'}
    <div class="live-foot"><span class="muted">${s ? `bijgewerkt ${ago(s.at)}${s.every > 1 ? ` · elke ${s.every} min (zuinig budget)` : ''}` : ''}</span>${full || isLive || (s && s.status === 'pre') || !s ? bell(x.id, x.ko) : ''}</div>
  </section>`;
}

/** Slot in het huidige scherm vullen (Home: bovenaan; wedstrijdpagina van die wedstrijd: onder de kop). */
export function paint() {
  const view = document.getElementById('view');
  if (!view) return;
  view.querySelectorAll('[data-live-card]').forEach((el) => el.remove());
  const key = view.dataset.view;
  const id = (location.hash.match(/^#\/wedstrijd\/([^/?]+)/) || [])[1];
  // Bolletje op het Wedstrijden-icoon (en de Speelronde-tab) zolang er iets bezig is.
  const n = liveCount(STATE);
  document.querySelectorAll('[data-nav="wedstrijden"]').forEach((a) => a.classList.toggle('has-live', n > 0));
  document.querySelectorAll('[data-live-dot]').forEach((d) => { d.hidden = !n; });
  const list = (STATE.matches || []).filter((x) => x.state || inWindow(x));
  const head = (key === 'speelronde' && view.querySelector('.page-tabs')) || view.querySelector('.page-head, .mast');
  const put = (html) => { if (!html) return; const t = document.createElement('div'); t.innerHTML = html; const el = t.firstElementChild; if (head) head.after(el); else view.prepend(el); };
  if (key === 'home') {
    // Cambuur bezig of net klaar: de live-kaart neemt de plek van de voorbeschouwing in.
    const started = list.filter((x) => x.state && x.state.status !== 'pre');
    started.slice(0, 2).reverse().forEach((x) => put(card(x)));
    const cover = view.querySelector('.cover');
    if (cover) cover.style.display = started.length ? 'none' : '';
    put(homeBarHtml(STATE, { ownCard: started.length > 0 }));
  } else if (key === 'speelronde') {
    list.filter((x) => x.state && x.state.status !== 'pre').slice(0, 2).reverse().forEach((x) => put(card(x)));
  } else if (key === 'wedstrijd' && id) { const x = list.find((y) => String(y.id) === String(id)); if (x) put(card(x, { full: true })); }
}

/** Belletje op de wedstrijdpagina van een komende Cambuur-wedstrijd (buiten het live-venster). */
export function bellHtml(m) {
  if (!m || m.status === 'finished' || m.manual || !DEVICE) return '';
  if (![m.homeTeam, m.awayTeam].some((t) => t && t.id === TEAM)) return '';
  return `<div class="btn-row">${bell(m.id, m.date)}<span class="muted" style="font-size:var(--fs-sm)">${askMode(m.date) ? 'live meldingen voor dit duel op dit apparaat · zonder Ja geen meldingen' : 'live meldingen voor dit duel op dit apparaat'}</span></div>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest && e.target.closest('[data-live-mute]');
  if (!b) return;
  e.preventDefault();
  const id = b.dataset.liveMute; const muted = !!b.dataset.muted;
  b.disabled = true;
  try {
    await setDeviceLive(b.dataset.ask ? { optin: { [id]: muted } } : { mute: { [id]: !muted } });
    toast(muted ? 'Live meldingen voor dit duel staan aan' : 'Geen live meldingen voor dit duel');
    document.querySelectorAll(`[data-live-mute="${CSS.escape(id)}"]`).forEach((x) => { x.outerHTML = bell(id); });
  } catch (err) { toast(err.message || String(err)); b.disabled = false; }
});
