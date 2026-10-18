// Nachtploeg, app-kant: wachtrij opbouwen voor de Worker en de brievenbus legen naar Firestore.
//
// De Worker haalt 's nachts (of in turbo-stand elke minuut) ruwe Highlightly-antwoorden op en legt die
// in KV. Hier verwerken we ze met dezelfde normalisatie als bij handmatig ophalen.

import { addMessage } from './inbox.js';
import { ns } from './api.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import {
  getAllMatches, saveMatches, saveMatchDetail, saveLeagueMatches, saveStandings, setMeta, getMeta,
  countCalls, getLeagueIndexes, addToLeagueIndex, saveSeason, getSeasons,
} from './store.js';
import { normalizeListMatch, normalizeDetail, normalizeEvents, normalizeStandings } from './normalize.js';

export const FOLLOWS = [75672, 76523]; // Eredivisie en KKD, elk seizoen
export const FIRST_BACKFILL = 2019;
const DAILY_WRITES = 4000; // ruim onder de 20.000 gratis Firestore-writes per dag
const today = () => new Date().toISOString().slice(0, 10);
const official = (m) => m.league && !/friendl/i.test(m.league.name);
const isOwn = (m) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === MAIN_CLUB.id);
const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };

export async function getPrefs() {
  return (await getMeta('nsPrefs').catch(() => null)) || { backfill: false };
}
export const setPrefs = (p) => setMeta('nsPrefs', p);

/** Bouwt de wachtrij: eerst wat nu telt, dan het verleden. */
export async function buildQueue() {
  const [matches, indexes, prefs, seasons] = await Promise.all([getAllMatches(), getLeagueIndexes().catch(() => []), getPrefs(), getSeasons().catch(() => [])]);
  const own = matches.filter(isOwn);
  const ownIds = new Set(own.map((m) => m.id));
  const seasonOf = (m) => (m.league && m.league.season != null ? Number(m.league.season) : null);
  const haveSeasons = new Set([...own.map(seasonOf).filter((y) => y != null), ...seasons.map((s) => Number(s.year))]);
  const years = [];
  for (let y = CURRENT_SEASON; y >= FIRST_BACKFILL; y--) if (y === CURRENT_SEASON || haveSeasons.has(y) || prefs.backfill) years.push(y);
  const idx = new Map(indexes.map((i) => [`${i.leagueId}_${i.season}`, i]));

  const now = []; const later = [];
  years.forEach((y) => {
    const bucket = y === CURRENT_SEASON ? now : later;
    // Programma van Cambuur: dit seizoen altijd verversen, oude seizoenen alleen als ze nog ontbreken.
    if (y === CURRENT_SEASON || !own.some((m) => seasonOf(m) === y)) {
      bucket.push({ type: 'program', teamId: MAIN_CLUB.id, season: y, side: 'home' }, { type: 'program', teamId: MAIN_CLUB.id, season: y, side: 'away' });
    }
    FOLLOWS.forEach((l) => {
      const i = idx.get(`${l}_${y}`);
      if (y === CURRENT_SEASON || !i || !(i.ids || []).length) bucket.push({ type: 'league', leagueId: l, season: y });
      if (y === CURRENT_SEASON) bucket.push({ type: 'standings', leagueId: l, season: y });
    });
  });
  // Cambuur: volledige details van gespeelde officiële duels, nieuwste eerst.
  const full = own.filter((m) => m.status === 'finished' && !m.detail && official(m))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .map((m) => ({ type: 'full', id: m.id, season: seasonOf(m) }));
  // Andere clubs: alleen de events (schutters, assists, kaarten), 1 call per duel.
  const events = [];
  indexes.filter((i) => years.includes(Number(i.season))).sort((a, b) => b.season - a.season).forEach((i) => {
    const done = new Set(i.withEvents || []);
    (i.finished || []).forEach((id) => { if (!done.has(id) && !ownIds.has(id)) events.push({ type: 'events', id, leagueId: i.leagueId, season: i.season }); });
  });
  const cur = (x) => Number(x.season) === CURRENT_SEASON;
  return [
    ...now,
    ...full.filter(cur), ...events.filter(cur),
    ...later,
    ...full.filter((x) => !cur(x)), ...events.filter((x) => !cur(x)),
  ];
}

export async function pushQueue() {
  const items = await buildQueue();
  await ns.setQueue(items);
  await setMeta('nsQueue', { at: new Date().toISOString(), count: items.length });
  return items.length;
}

async function writeBudget() {
  const w = await getMeta('nsWrites').catch(() => null);
  return w && w.day === today() ? DAILY_WRITES - (w.count || 0) : DAILY_WRITES;
}
async function spendWrites(n) {
  const w = await getMeta('nsWrites').catch(() => null);
  await setMeta('nsWrites', { day: today(), count: (w && w.day === today() ? w.count || 0 : 0) + n });
}

/** Eén resultaat uit de brievenbus naar Firestore. Geeft het aantal writes terug. */
async function apply(r) {
  const { item, bodies } = r;
  if (!bodies || bodies.every((b) => b == null)) return 0;
  switch (item.type) {
    case 'full': {
      const [d, l, b] = bodies.map(parse);
      if (!d) return 0;
      const { base, detail } = normalizeDetail(d, l, b);
      await saveMatchDetail(item.id, base, detail, { detail: bodies[0], lineups: bodies[1] || null, boxScore: bodies[2] || null, fetchedAt: detail.fetchedAt, via: 'nachtploeg' });
      return 2;
    }
    case 'events': {
      const raw = parse(bodies[0]);
      const d = Array.isArray(raw) ? raw[0] : raw;
      if (!d) return 0;
      const base = normalizeListMatch(d);
      const events = normalizeEvents(d.events).filter((e) => !/subst/i.test(e.type || ''));
      await saveLeagueMatches([{ ...base, events, eventsAt: new Date().toISOString() }]);
      await addToLeagueIndex(item.leagueId || base.league.id, item.season || base.league.season, { withEvents: [item.id] });
      return 2;
    }
    case 'league': {
      const raw = parse(bodies[0]);
      const list = ((raw && raw.data) || []).map(normalizeListMatch);
      if (!list.length) return 0;
      await saveLeagueMatches(list);
      await addToLeagueIndex(item.leagueId, item.season, { ids: list.map((m) => m.id), finished: list.filter((m) => m.status === 'finished').map((m) => m.id) });
      await setMeta(`league_${item.leagueId}_${item.season}`, { fetchedAt: new Date().toISOString(), via: 'nachtploeg' });
      return list.length + 2;
    }
    case 'program': {
      const raw = parse(bodies[0]);
      const list = ((raw && raw.data) || []).map(normalizeListMatch);
      if (list.length) {
        await saveMatches(list);
        await saveSeason(item.season, { source: 'highlightly' });
        await setMeta(`sync_${item.season}`, { lastSeasonSync: new Date().toISOString(), season: item.season, via: 'nachtploeg' });
        if (item.season === CURRENT_SEASON) await setMeta('sync', { lastSeasonSync: new Date().toISOString(), season: item.season });
      }
      return list.length + 3;
    }
    case 'standings': {
      const raw = parse(bodies[0]);
      if (!raw) return 0;
      await saveStandings(item.leagueId, item.season, { ...normalizeStandings(raw), fetchedAt: new Date().toISOString() });
      return 1;
    }
    default: return 0;
  }
}

const COST_OF = { full: 3, events: 1, league: 1, program: 1, standings: 1 };

/** Brievenbus legen (oudste eerst), binnen het dagbudget aan Firestore-writes. */
export async function emptyInbox(onProgress) {
  const st = await ns.state();
  const keys = (st.inbox || []).slice().sort();
  let budget = await writeBudget();
  const summary = { chunks: 0, items: 0, writes: 0, byType: {}, left: 0 };
  for (const key of keys) {
    if (budget <= 0) { summary.left = keys.length - summary.chunks; break; }
    const chunk = await ns.inbox(key);
    let writes = 0; let calls = 0;
    for (const r of chunk.results || []) {
      try {
        writes += await apply(r);
        summary.items++;
        summary.byType[r.item.type] = (summary.byType[r.item.type] || 0) + 1;
        calls += COST_OF[r.item.type] || 1;
      } catch (err) { console.warn('Nachtploeg: verwerken mislukt', r.item, err); }
    }
    await ns.ack(key);
    await spendWrites(writes);
    if (calls) await countCalls(calls).catch(() => {});
    budget -= writes; summary.writes += writes; summary.chunks++;
    if (onProgress) onProgress(summary, keys.length);
  }
  if (summary.chunks) await setMeta('nsLast', { at: new Date().toISOString(), ...summary });
  if (summary.items) {
    const LABEL = { full: 'Cambuur-details', events: 'doelpuntenmakers', league: 'competitiewedstrijden', program: 'programma', standings: 'standen' };
    const parts = Object.entries(summary.byType).map(([k, n]) => `${n}× ${LABEL[k] || k}`).join(', ');
    await addMessage({ id: `ns:${Date.now()}`, kind: 'nightshift', title: `${summary.items} ${summary.items === 1 ? 'pakketje' : 'pakketjes'} verwerkt`, text: `${parts}${summary.left ? `. ${summary.left} wachten op morgen (dagbudget Firestore).` : '.'}`, href: '#/nachtploeg' }).catch(() => {});
  }
  return summary;
}

/** Bij openen van de app: brievenbus legen en de wachtrij verversen (hooguit eens per 30 minuten). */
export async function autoSync() {
  let last = 0;
  try { last = Number(localStorage.getItem('ms-ns-auto')) || 0; } catch { /* niet erg */ }
  if (Date.now() - last < 30 * 60e3) return null;
  try { localStorage.setItem('ms-ns-auto', String(Date.now())); } catch { /* niet erg */ }
  try {
    const summary = await emptyInbox();
    await pushQueue();
    return summary;
  } catch (err) {
    return { error: err };
  }
}
