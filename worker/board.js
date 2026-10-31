// Live-bord: alle wedstrijden van vandaag in de Eredivisie en de KKD.
//
// Eén keer per dag (eerste cron na middernacht UTC) het programma van vandaag per competitie: 2 calls.
// Is er in een competitie iets bezig, dan elke LEAGUE_EVERY minuten de daglijst van die competitie (1 call,
// alle duels tegelijk). Gaat een stand omhoog: 1 call voor de schutters. Eindsignaal: de definitieve lijst,
// de schutters en de stand gaan in de brievenbus (ns:inbox:), zodat de app ze meteen verwerkt.
//
// KV-zuinig (gratis plan: 1.000 writes per dag): lv:board alleen schrijven als er iets verandert
// (stand, status, schutters, aftraptijd), niet voor de klok. De app rekent de minuut zelf door.
// Cambuur zelf heeft een eigen, snellere lus (live.js); hier geen extra detail-calls voor dat duel.

import { parseLive, liveEnabled, anchorsOf } from './live.js';

export const BOARD = 'lv:board';
export const LEAGUES = [75672, 76523]; // Eredivisie, KKD
export const LEAGUE_EVERY = 2; // minuten tussen twee vragen per competitie (instelbaar na de meting)
const TEAM = 358204;
const START = -5 * 60e3;
const END = 150 * 60e3;
const MAX_DETAIL = 4; // per run hooguit zoveel schutters-calls
const MIN_REMAINING = 300; // daaronder gaat het budget naar Cambuur en de speelronden

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const scoreOf = (s) => { const m = String(s || '').match(/(\d+)\s*-\s*(\d+)/); return m ? { home: Number(m[1]), away: Number(m[2]) } : null; };
function statusOf(desc) {
  const d = String(desc || '').toLowerCase();
  if (!d || d.includes('not started') || d.includes('to be')) return 'pre';
  if (d.includes('finished') || d.includes('after')) return 'ft';
  if (/postpon|cancel|abandon|suspend/.test(d)) return 'off';
  if (d.includes('half time') || d.includes('break')) return 'ht';
  return 'live';
}
const done = (x) => x.status === 'ft' || x.status === 'off';
const isOwn = (x) => (x.home && x.home.id === TEAM) || (x.away && x.away.id === TEAM);
const total = (s) => (s ? s.home + s.away : 0);

/** Highlightly-daglijst → compacte rijen (alleen deze competitie: mocht het filter genegeerd worden). */
export function parseList(text, leagueId) {
  const d = JSON.parse(text);
  return ((d && d.data) || []).filter((m) => m && m.league && Number(m.league.id) === Number(leagueId)).map((m) => ({
    id: String(m.id), lid: Number(leagueId), season: m.league.season ?? null, ko: m.date, round: m.round || null,
    home: m.homeTeam ? { id: m.homeTeam.id, name: m.homeTeam.name } : null,
    away: m.awayTeam ? { id: m.awayTeam.id, name: m.awayTeam.name } : null,
    status: statusOf(m.state && m.state.description),
    clock: m.state && m.state.clock != null ? Number(m.state.clock) : null,
    score: scoreOf(m.state && m.state.score && m.state.score.current),
  }));
}

/** Is deze competitie nu aan de beurt? (iets bezig in het venster, en de minuut klopt) */
export function leagueDue(rows, now, every = LEAGUE_EVERY) {
  const active = rows.some((x) => { const ko = Date.parse(x.ko); return ko && !done(x) && now >= ko + START && now <= ko + END; });
  if (!active) return false;
  return Math.floor(now / 60e3) % every === 0;
}

/** Zit er vandaag nog iets aan te komen of bezig? (voor de reserve van de nachtploeg) */
export function boardBusy(board, now) {
  if (!board || board.day !== dayOf(now)) return false;
  return (board.matches || []).some((x) => !done(x) && Date.parse(x.ko) + END > now);
}
/** Is er nu iets in het live-venster? (dan houdt de nachtploeg zijn runs kleiner) */
export function boardActive(board, now) {
  if (!board || board.day !== dayOf(now)) return false;
  return (board.matches || []).some((x) => { const ko = Date.parse(x.ko); return !done(x) && now >= ko + START && now <= ko + END; });
}

const sigOf = (x) => JSON.stringify([x.status, x.score, x.ko, (x.events || []).map((e) => e.key), x.anch || null]);

/**
 * Eén cron-tik. deps: { base, remainingOf, state(), saveRemaining(n), inboxPrefix, fetch? }
 * Geeft een korte samenvatting terug (voor tests).
 */
export async function boardScheduled(env, time, deps) {
  const kv = env.MS_KV;
  if (!kv || !env.HIGHLIGHTLY_KEY) return { skip: 'setup' };
  const now = Number(time);
  const ns = await deps.state();
  if (!liveEnabled(ns)) return { skip: 'free-plan' };
  const f = deps.fetch || fetch;
  let remaining = ns.remaining ?? null;
  const calls = { n: 0 };
  const get = async (p) => {
    const res = await f(`${deps.base}${p}`, { headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_KEY } });
    calls.n++;
    const r = deps.remainingOf(res); if (r != null) remaining = r;
    if (res.status === 429) throw new Error('quota');
    return res.ok ? res.text() : null;
  };

  const day = dayOf(now);
  let board = (await kv.get(BOARD, 'json')) || null;
  let dirty = false;
  if (!board || board.day !== day) {
    // Nieuw dagprogramma: per competitie één lijst van vandaag.
    if (remaining != null && remaining < MIN_REMAINING) return { skip: 'budget' };
    const matches = [];
    for (const lid of LEAGUES) {
      try { const t = await get(`/matches?leagueId=${lid}&date=${day}&limit=50`); if (t) matches.push(...parseList(t, lid).map((x) => ({ ...x, events: [] }))); } catch (err) { if (err.message === 'quota') break; }
    }
    board = { day, at: new Date(now).toISOString(), matches: matches.sort((a, b) => Date.parse(a.ko) - Date.parse(b.ko)) };
    dirty = true;
  } else {
    if (remaining != null && remaining < MIN_REMAINING) return { skip: 'budget' };
    const results = [];
    let details = 0;
    for (const lid of LEAGUES) {
      const rows = board.matches.filter((x) => x.lid === lid);
      if (!leagueDue(rows, now)) continue;
      let text;
      try { text = await get(`/matches?leagueId=${lid}&date=${day}&limit=50`); } catch (err) { if (err.message === 'quota') break; continue; }
      if (!text) continue;
      let list; try { list = parseList(text, lid); } catch { continue; }
      const finished = [];
      for (const cur of list) {
        const old = board.matches.find((x) => x.id === cur.id);
        const prev = old ? { ...old } : { events: [] };
        const before = old ? sigOf(old) : null;
        const next = { ...prev, ...cur, events: prev.events || [], clockAt: new Date(now).toISOString(), anch: anchorsOf(prev.anch, cur.status, cur.clock, now, Date.parse(cur.ko)) };
        const rose = total(cur.score) > total(prev.score);
        const ended = cur.status === 'ft' && prev.status !== 'ft';
        // Schutters: bij een hogere stand, en bij het eindsignaal (dan is de lijst definitief).
        if ((rose || ended) && !isOwn(cur) && details < MAX_DETAIL) {
          try {
            const dt = await get(`/matches/${Number(cur.id)}`); details++;
            if (dt) {
              const p = parseLive(dt);
              if (p) next.events = p.events.filter((e) => e.kind === 'goal' || e.kind === 'red').map((e) => ({ key: e.key, kind: e.kind, type: e.type, minute: e.minute, extra: e.extra, teamId: e.teamId, player: e.player }));
              if (ended) results.push({ item: { type: 'events', id: Number(cur.id), leagueId: lid, season: cur.season, why: 'live' }, status: 200, bodies: [dt] });
            }
          } catch (err) { if (err.message === 'quota') break; }
        }
        if (ended) { next.ftAt = new Date(now).toISOString(); finished.push(cur); }
        if (!old) board.matches.push(next);
        else Object.assign(old, next);
        if (before !== sigOf(next)) dirty = true;
      }
      if (finished.length) {
        // Uitslagen meteen de app in: de daglijst (alle duels van vandaag in deze competitie) en de stand.
        const season = finished[0].season;
        results.push({ item: { type: 'league', leagueId: lid, season, offset: 0, why: 'live' }, status: 200, bodies: [text] });
        try {
          const st = season != null ? await get(`/standings?leagueId=${lid}&season=${Number(season)}`) : null;
          if (st) results.push({ item: { type: 'standings', leagueId: lid, season: Number(season), why: 'live' }, status: 200, bodies: [st] });
        } catch { /* stand komt dan met de nachtploeg */ }
      }
    }
    if (results.length) {
      board.inboxAt = new Date(now).toISOString(); dirty = true;
      await kv.put(`${deps.inboxPrefix}${now}`, JSON.stringify({ at: board.inboxAt, results }));
    }
    if (dirty) board.at = new Date(now).toISOString();
  }
  if (dirty) await kv.put(BOARD, JSON.stringify(board), { expirationTtl: 3 * 86400 });
  // ns:state niet elke tik herschrijven (KV-writes): elke 10 minuten, of als het krap wordt.
  if (calls.n && remaining != null && deps.saveRemaining && (Math.floor(now / 60e3) % 10 === 0 || remaining < 500)) await deps.saveRemaining(remaining);
  return { calls: calls.n, dirty, matches: board.matches.length };
}

// ---------- Beker live, op aanvraag van de app ----------
// Geen vaste lus: de app vraagt /live?cup=1 zolang hij open is en er vandaag een bekerduel in het venster zit.
// De daglijst hooguit eens per 2 minuten, een gevolgd duel (match=<id>) hooguit eens per 30 s. Twee apparaten
// tegelijk vragen dus niet dubbel. (De Cache API werkt niet op workers.dev; daarom geheugen + KV.)
export const CUP = 77374;
const CUP_LIST_TTL = 110; // s
const CUP_MATCH_TTL = 25; // s
const MEM = new Map(); // k -> { exp, v }: blijft bewaard zolang dezelfde Worker-instantie draait
let KVREF = null;
async function cacheGet(k) {
  const now = Date.now();
  const m = MEM.get(k);
  if (m && m.exp > now) return m.v;
  if (!KVREF) return null;
  const x = await KVREF.get('lvc:' + k, 'json').catch(() => null);
  if (x && x.exp > now) { MEM.set(k, x); return x.v; }
  return null;
}
async function cachePut(k, v, ttl) {
  const x = { exp: Date.now() + ttl * 1000, v };
  MEM.set(k, x);
  if (KVREF) await KVREF.put('lvc:' + k, JSON.stringify(x), { expirationTtl: 300 }).catch(() => {});
}

/** deps: { base, remainingOf, state(), saveRemaining? }. Geeft { day, at, matches, detail } of null. */
export async function cupLive(env, deps, matchId, now = Date.now()) {
  if (!env.HIGHLIGHTLY_KEY) return null;
  KVREF = env.MS_KV || null;
  const ns = await deps.state();
  if (!liveEnabled(ns)) return null;
  const day = dayOf(now);
  const f = deps.fetch || fetch;
  const lowBudget = ns.remaining != null && ns.remaining < MIN_REMAINING;
  let list = await cacheGet(`cup-${day}`);
  if (!list && !lowBudget) {
    const res = await f(`${deps.base}/matches?leagueId=${CUP}&date=${day}&limit=50`, { headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_KEY } });
    if (res.ok) {
      list = { day, at: new Date(now).toISOString(), matches: parseList(await res.text(), CUP).map((x) => ({ ...x, clockAt: new Date(now).toISOString(), anch: anchorsOf(null, x.status, x.clock, now, Date.parse(x.ko)) })) };
      await cachePut(`cup-${day}`, list, CUP_LIST_TTL);
    }
  }
  let detail = null;
  const id = /^\d+$/.test(String(matchId || '')) ? String(matchId) : null;
  if (id && list && list.matches.some((x) => x.id === id && (x.status === 'live' || x.status === 'ht'))) {
    detail = await cacheGet(`cupm-${id}`);
    if (!detail && !lowBudget) {
      const res = await f(`${deps.base}/matches/${Number(id)}`, { headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_KEY } });
      const p = res.ok ? parseLive(await res.text()) : null;
      if (p) {
        detail = { id, status: p.status, clock: p.clock, score: p.score, at: new Date(now).toISOString(), events: p.events.filter((e) => e.kind !== 'sub').map((e) => ({ key: e.key, kind: e.kind, type: e.type, minute: e.minute, extra: e.extra, teamId: e.teamId, player: e.player })) };
        await cachePut(`cupm-${id}`, detail, CUP_MATCH_TTL);
      }
    }
  }
  return list ? { ...list, detail } : null;
}
