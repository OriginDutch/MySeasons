// Speelronde: alle Eredivisie- en KKD-duels van vandaag (live via de Worker, lv:board), de eerstvolgende
// speeldag en de vorige, uit je eigen data. Kost de app geen Highlightly-calls.
// Wedstrijden → tab "Speelronde" (#/speelronde), de balk op Home en het bolletje op het Wedstrijden-icoon.

import { esc } from './ui.js';
import { liveState } from './livescore.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import { getLeagueMatches } from './store.js';

export const BOARD_LEAGUES = [{ id: 75672, short: 'Eredivisie', abbr: 'ED' }, { id: 76523, short: 'KKD', abbr: 'KKD' }];
const TEAM = MAIN_CLUB.id;
const TZ = 'Europe/Amsterdam';
const localDay = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(t));
const fTime = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fDay = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const timeOf = (iso) => fTime.format(new Date(iso));
const dayOf = (iso) => fDay.format(new Date(iso)).replace(/\./g, '');
const leagueOf = (lid) => BOARD_LEAGUES.find((l) => l.id === Number(lid));
const isOwn = (x) => (x.home && x.home.id === TEAM) || (x.away && x.away.id === TEAM);
const done = (x) => x.status === 'ft' || x.status === 'off';
const isLive = (x) => x.status === 'live' || x.status === 'ht';

// ---------- Programma uit je eigen data (komende en vorige speeldag) ----------
let PROGRAM = { rows: [], at: 0 };
const appStatus = (s) => (s === 'finished' ? 'ft' : ['postponed', 'cancelled', 'abandoned'].includes(s) ? 'off' : 'pre');

export async function loadProgram(force = false) {
  if (!force && Date.now() - PROGRAM.at < 10 * 60e3) return PROGRAM.rows;
  const now = Date.now();
  const rows = [];
  for (const l of BOARD_LEAGUES) {
    const list = await getLeagueMatches(l.id, CURRENT_SEASON).catch(() => []);
    list.forEach((m) => {
      const t = Date.parse(m.date);
      if (!t || t < now - 8 * 864e5 || t > now + 10 * 864e5) return;
      rows.push({
        id: String(m.id), lid: l.id, ko: m.date, round: m.round || null,
        home: m.homeTeam ? { id: m.homeTeam.id, name: m.homeTeam.name } : null,
        away: m.awayTeam ? { id: m.awayTeam.id, name: m.awayTeam.name } : null,
        status: appStatus(m.status), score: m.score || null, events: (m.events || []).filter((e) => /goal|penalty|red/i.test(e.type || '') && !/missed|var|cancel|disallow/i.test(e.type || '')).map((e) => ({ kind: /red/i.test(e.type) ? 'red' : 'goal', type: e.type, minute: e.minute, extra: e.extra, teamId: e.teamId, player: e.player || e.playerName || null })),
      });
    });
  }
  PROGRAM = { rows, at: Date.now() };
  return rows;
}
export const programRows = () => PROGRAM.rows;

/**
 * Alle rijen van vandaag: het live-bord van de Worker als dat van vandaag is, anders je eigen data.
 * Het Cambuur-duel krijgt de snellere stand uit live:<id> (de 30-secondenlus).
 */
export function todayRows(state, now = Date.now()) {
  const today = localDay(now);
  const own = PROGRAM.rows.filter((x) => localDay(x.ko) === today);
  const b = state && state.board;
  let rows = own;
  if (b && Array.isArray(b.matches) && b.matches.some((x) => localDay(x.ko) === today)) {
    const ids = new Set(b.matches.map((x) => x.id));
    rows = [...b.matches.filter((x) => localDay(x.ko) === today), ...own.filter((x) => !ids.has(x.id))];
  }
  const cam = new Map(((state && state.matches) || []).filter((x) => x.state).map((x) => [String(x.id), x.state]));
  return rows.map((x) => {
    const s = cam.get(String(x.id));
    return s ? { ...x, status: s.status, score: s.score || x.score, clock: s.clock, clockAt: s.at, anch: s.anch, events: (s.events || []).filter((e) => e.kind === 'goal' || e.kind === 'red') } : x;
  }).sort((a, b2) => Date.parse(a.ko) - Date.parse(b2.ko) || a.lid - b2.lid);
}

/** Moet de app de Worker nu vragen? (iets van vandaag in het venster: 15 min voor tot 3 uur na de aftrap) */
export function boardWindow(now = Date.now()) {
  return PROGRAM.rows.some((x) => { const ko = Date.parse(x.ko); return ko && x.status !== 'ft' && now >= ko - 15 * 60e3 && now <= ko + 3 * 3600e3; });
}

export function liveCount(state) {
  return todayRows(state).filter(isLive).length;
}

// ---------- Weergave ----------
/**
 * De minuut zelf tellen vanaf de ankerpunten van de Worker (aftrap, start tweede helft); zonder anker de klok van
 * Highlightly plus de tijd sinds die waarneming. Van beide de hoogste: allebei lopen ze eerder achter dan voor.
 * Geeft bijv. "23'", "45+2'", "90+4'", of null als er niets te tellen valt.
 */
export function liveMinute(status, anch, clock, clockAt, now = Date.now()) {
  if (status !== 'live') return null;
  const a = anch || {};
  const second = !!a.ht || (clock != null && clock > 45); // rust gezien, of Highlightly zit al voorbij de 45
  let m = clock != null ? clock + (clockAt ? Math.max(0, Math.floor((now - Date.parse(clockAt)) / 60e3)) : 0) : null;
  const own = second ? (a.k2 ? 46 + Math.floor((now - a.k2) / 60e3) : null) : (a.k1 ? 1 + Math.floor((now - a.k1) / 60e3) : null);
  if (own != null && (m == null || own > m)) m = own;
  if (m == null) return null;
  const end = second ? 90 : 45;
  return m > end ? `${end}+${m - end}'` : `${Math.max(1, m)}'`;
}

function clockOf(x, now = Date.now()) {
  if (x.status === 'ht') return 'rust';
  if (x.status === 'ft') return 'einde';
  if (x.status === 'off') return 'afgelast';
  if (x.status === 'live') return liveMinute('live', x.anch, x.clock, x.clockAt, now) || 'live';
  return timeOf(x.ko);
}

/** Schutters en rood onder het duel: thuis links, uit rechts (geen geel: de lijst blijft overzichtelijk). */
function eventsLine(x) {
  const ev = (x.events || []).filter((e) => e.kind === 'goal' || e.kind === 'red').slice().sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (a.extra ?? 0) - (b.extra ?? 0));
  if (!ev.length) return '';
  const home = x.home && x.home.id; const away = x.away && x.away.id;
  const sideOf = (e) => {
    let t = e.teamId;
    if (e.kind === 'goal' && /own/i.test(e.type || '')) t = t === home ? away : t === away ? home : t;
    return t === away ? 'away' : 'home';
  };
  const item = (e, side) => {
    const min = `<b>${e.minute ?? ''}${e.extra ? '+' + e.extra : ''}'</b>`;
    const name = `${e.kind === 'goal' ? '⚽' : '🟥'} ${esc(e.player || '?')}${e.kind === 'goal' && /own/i.test(e.type || '') ? ' (e.d.)' : ''}${e.kind === 'goal' && /penalty/i.test(e.type || '') ? ' (pen.)' : ''}`;
    return `<span>${side === 'home' ? `${min} ${name}` : `${name} ${min}`}</span>`;
  };
  const col = (side) => `<span class="lb-ev__${side}">${ev.filter((e) => sideOf(e) === side).map((e) => item(e, side)).join('')}</span>`;
  return `<div class="lb-ev">${col('home')}${col('away')}</div>`;
}

function row(x) {
  const sc = x.score && x.status !== 'pre' ? `${x.score.home}<br>${x.score.away}` : '';
  const tag = isOwn(x) ? 'a' : 'div';
  return `<${tag} class="lb-row${isOwn(x) ? ' is-us' : ''}${isLive(x) ? ' is-live' : ''}"${isOwn(x) ? ` href="#/wedstrijd/${esc(x.id)}"` : ''}>
    <span class="lb-min mono">${esc(clockOf(x))}</span>
    <span class="lb-teams"><span>${esc(x.home ? x.home.name : '?')}</span><span>${esc(x.away ? x.away.name : '?')}</span></span>
    <span class="lb-sc">${sc}</span>
    ${eventsLine(x)}
  </${tag}>`;
}

function byLeague(rows) {
  return BOARD_LEAGUES.map((l) => {
    const r = rows.filter((x) => x.lid === l.id);
    return r.length ? `<div class="lb-league">${esc(l.short)}</div>${r.map(row).join('')}` : '';
  }).join('');
}

function block(label, rows, { open = true, grouped = true } = {}) {
  if (!rows.length) return '';
  const body = grouped ? byLeague(rows) : rows.map(row).join('');
  if (open) return `<section class="section"><div class="section__label"><span>${label}</span><span>${rows.length}</span></div><div class="lb">${body}</div></section>`;
  return `<section class="section"><details class="fold"><summary class="section__label"><span>${label}</span><span>${rows.length} ▸</span></summary><div class="lb">${body}</div></details></section>`;
}

/** Inhoud van het Speelronde-scherm (wordt ververst bij elke nieuwe stand). */
export function boardHtml(state, now = Date.now()) {
  const today = localDay(now);
  const rows = todayRows(state, now);
  // Cambuur bezig: die staat al als grote kaart bovenaan (livescore.paint), hier alleen de andere duels.
  const ownCard = ((state && state.matches) || []).some((x) => x.state && x.state.status !== 'pre' && x.state.status !== 'ft');
  const live = rows.filter(isLive).filter((x) => !(ownCard && isOwn(x)));
  const later = rows.filter((x) => x.status === 'pre');
  const ended = rows.filter(done);
  const days = (dir) => {
    const other = PROGRAM.rows.filter((x) => (dir > 0 ? localDay(x.ko) > today : localDay(x.ko) < today));
    if (!other.length) return { day: null, rows: [] };
    const d = other.map((x) => localDay(x.ko)).sort()[dir > 0 ? 0 : other.length - 1];
    return { day: d, rows: other.filter((x) => localDay(x.ko) === d).sort((a, b) => Date.parse(a.ko) - Date.parse(b.ko)) };
  };
  const nextDay = days(1); const prevDay = days(-1);
  const off = state && state.enabled === false;
  return `
    ${off ? '<p class="muted" style="font-size:var(--fs-sm)">Live staat uit: Highlightly zit op het gratis plan. Uitslagen komen met de nachtploeg.</p>' : ''}
    ${block(`<span class="live-dot"></span>${ownCard ? 'Ook bezig' : 'Nu bezig'}`, live)}
    ${block('Straks vandaag', later)}
    ${block('Afgelopen vandaag', ended)}
    ${!rows.length ? '<section class="section"><p class="muted" style="margin:0">Vandaag geen Eredivisie of KKD.</p></section>' : ''}
    ${nextDay.day ? block(`Eerstvolgende · ${esc(dayOf(nextDay.rows[0].ko))}`, nextDay.rows) : ''}
    ${prevDay.day ? block(`Eerder · ${esc(dayOf(prevDay.rows[0].ko))}`, prevDay.rows, { open: false }) : ''}
    ${state && state.board && state.board.at ? `<p class="muted" style="font-size:var(--fs-xs)">Live-bord bijgewerkt om ${esc(timeOf(state.board.at))} · de Worker kijkt elke 2 minuten tijdens de duels</p>` : ''}`;
}

/** Balk op Home: "2 wedstrijden bezig · ED 1 · KKD 1" of "Vandaag 4 wedstrijden · eerste om 16:30". */
export function homeBarHtml(state, { ownCard = false } = {}) {
  const rows = todayRows(state);
  if (!rows.length) return '';
  const live = rows.filter(isLive).filter((x) => !(ownCard && isOwn(x)));
  let text;
  if (live.length) {
    const per = BOARD_LEAGUES.map((l) => [l.abbr, live.filter((x) => x.lid === l.id).length]).filter(([, n]) => n).map(([a, n]) => `${a} ${n}`).join(' · ');
    text = `<span><span class="live-dot"></span><b>${ownCard ? 'Ook ' : ''}${live.length} ${live.length === 1 ? 'wedstrijd' : 'wedstrijden'} bezig</b> · ${per}</span>`;
  } else {
    const later = rows.filter((x) => x.status === 'pre' && Date.parse(x.ko) > Date.now() - 10 * 60e3);
    const ended = rows.filter(done).length;
    text = later.length
      ? `<span>Vandaag <b>${rows.length} ${rows.length === 1 ? 'wedstrijd' : 'wedstrijden'}</b> · ${ended ? `${ended} gespeeld · ` : ''}volgende om ${esc(timeOf(later[0].ko))}</span>`
      : `<span>Vandaag <b>${rows.length} gespeeld</b> · uitslagen</span>`;
  }
  return `<a class="lb-bar${live.length ? ' is-live' : ''}" href="#/speelronde" data-live-card>${text}<span aria-hidden="true">→</span></a>`;
}

/** Tabs boven Wedstrijden en Speelronde. */
export function tabsHtml(active) {
  return `<nav class="page-tabs" aria-label="Wedstrijden"><a href="#/wedstrijden"${active === 'cambuur' ? ' aria-current="page"' : ''}>Cambuur</a><a href="#/speelronde"${active === 'speelronde' ? ' aria-current="page"' : ''}>Speelronde<span class="page-tabs__dot" data-live-dot hidden></span></a></nav>`;
}

// ---------- Scherm ----------
export const boardViews = {
  speelronde: {
    title: 'Speelronde',
    navKey: 'wedstrijden',
    async render() {
      await loadProgram().catch(() => []);
      return `<header class="page-head"><div class="page-head__titles"><span class="page-head__kicker">MySeasons / Live · ${esc(dayOf(new Date().toISOString()))}</span><h1 class="page-head__title">Speelronde</h1></div></header>
        ${tabsHtml('speelronde')}
        <div data-board>${boardHtml(liveState())}</div>`;
    },
    mount(root) {
      const box = root.querySelector('[data-board]');
      const redraw = () => {
        if (!box.isConnected) { window.removeEventListener('live:update', redraw); clearInterval(tick); return; }
        const open = [...box.querySelectorAll('details[open]')].length;
        box.innerHTML = boardHtml(liveState());
        if (open) box.querySelectorAll('details').forEach((d) => { d.open = true; });
      };
      window.addEventListener('live:update', redraw);
      const tick = setInterval(redraw, 15e3); // de minuut doortellen tussen twee standen
    },
  },
};
