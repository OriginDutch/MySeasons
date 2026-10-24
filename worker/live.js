// Live: de Cambuur-wedstrijd volgen bij Highlightly, van 10 minuten voor de aftrap tot het eindsignaal
// (uiterlijk 2,5 uur na de aftrap). Elke minuut als het budget het toelaat; bij een krap budget (gratis plan)
// rekent hij zelf uit hoe vaak het kan, zodat het tot het einde reikt.
//
// KV: live:<id> = laatste stand (alleen geschreven als er iets verandert, of elke 5 minuten voor de klok).
// Meldingen per apparaat (push:subs[i].live): aan/uit, soorten, en per wedstrijd stil (mute).

import { sendPush } from './push.js';

const SCHEDULE = 'push:schedule';
const SUBS = 'push:subs';
const LIVE = 'live:';
const LOG = 'livelog:';
const MEASURE = true; // tijdelijk: meting 30 s vs 1 min (zie liveScheduled)
const TEAM = 358204;
const START = -10 * 60e3;
const END = 150 * 60e3;
const SAFETY = 12; // calls die altijd over moeten blijven (uitslag ophalen, de app)
// Alleen live volgen op een betaald plan: op het gratis plan (100/dag) zijn de calls voor de speelronden.
export const PAID_MIN = 1000;
export const liveEnabled = (ns) => !(ns && ns.limit != null && ns.limit < PAID_MIN);
function limitOf(res) {
  for (const [name, value] of res.headers) { const n = name.toLowerCase(); if (n.includes('ratelimit') && n.includes('limit') && !n.includes('remaining') && !n.includes('reset')) return Number(value); }
  return null;
}
export const LIVE_DEFAULTS = { on: true, goalUs: true, goalThem: true, red: true, status: true };

const isGoal = (t) => { const x = String(t || ''); return !/missed|var|cancel|disallow/i.test(x) && (/goal/i.test(x) || /^penalty( goal| scored)?$/i.test(x)); };
const isRed = (t) => /red/i.test(String(t || ''));
const minuteOf = (time) => { const m = String(time || '').match(/(\d+)(?:\s*\+\s*(\d+))?/); return m ? { minute: Number(m[1]), extra: m[2] ? Number(m[2]) : null } : { minute: null, extra: null }; };

function statusOf(desc) {
  const d = String(desc || '').toLowerCase();
  if (!d || d.includes('not started') || d.includes('to be')) return 'pre';
  if (d.includes('finished') || d.includes('after')) return 'ft';
  if (/postpon|cancel|abandon|suspend/.test(d)) return 'off';
  if (d.includes('half time') || d.includes('break')) return 'ht';
  return 'live';
}

/** Highlightly /matches/{id} → compacte live-stand. */
export function parseLive(text) {
  const d = JSON.parse(text); const m = Array.isArray(d) ? d[0] : d;
  if (!m) return null;
  const sc = String((m.state && m.state.score && m.state.score.current) || '').match(/(\d+)\s*-\s*(\d+)/);
  const events = (m.events || []).filter((e) => isGoal(e.type) || isRed(e.type) || e.type === 'Substitution').map((e) => {
    const { minute, extra } = minuteOf(e.time);
    const kind = isGoal(e.type) ? 'goal' : isRed(e.type) ? 'red' : 'sub';
    const teamId = e.team ? e.team.id : null;
    const base = { kind, type: e.type, minute, extra, teamId };
    if (kind === 'sub') return { ...base, out: e.player || null, in: e.substituted || null, base: `sub~${teamId}~${e.playerId}` };
    return { ...base, player: e.player || null, assist: kind === 'goal' ? e.assist || null : null, base: `${kind}~${teamId}~${e.playerId || e.player}` };
  });
  // Sleutel zonder minuut (Highlightly past die soms achteraf aan): soort, team, speler en de hoeveelste.
  const n = {};
  events.forEach((e) => { n[e.base] = (n[e.base] || 0) + 1; e.key = `${e.base}~${n[e.base]}`; delete e.base; });
  return {
    id: m.id, status: statusOf(m.state && m.state.description), desc: (m.state && m.state.description) || null,
    clock: m.state && m.state.clock != null ? Number(m.state.clock) : null,
    score: sc ? { home: Number(sc[1]), away: Number(sc[2]) } : null,
    home: m.homeTeam ? { id: m.homeTeam.id, name: m.homeTeam.name } : null,
    away: m.awayTeam ? { id: m.awayTeam.id, name: m.awayTeam.name } : null,
    events,
  };
}

/** Om de hoeveel minuten mag er gevraagd worden? Ruim budget: elke minuut. */
export function intervalFor(remaining, now, ko, mode) {
  if (mode === 'turbo' || remaining == null || remaining >= 400) return 1;
  const left = Math.max(1, Math.ceil((ko + END - now) / 60e3));
  const budget = remaining - SAFETY;
  if (budget <= 0) return 0; // niet meer vragen
  return Math.min(15, Math.max(1, Math.ceil(left / budget)));
}

const line = (s) => `${s.home ? s.home.name : '?'} ${s.score ? `${s.score.home}–${s.score.away}` : '–'} ${s.away ? s.away.name : '?'}`;
const mm = (e) => `${e.minute ?? '?'}${e.extra ? '+' + e.extra : ''}'`;

/** Welke meldingen horen bij de overgang van prev naar cur? [{ kind: 'goalUs'|'goalThem'|'red'|'status', msg }] */
export function messagesFor(prev, cur, m) {
  const out = [];
  const url = `#/wedstrijd/${m.id}`;
  if (prev && prev.events) {
    const seen = new Set(prev.events.map((e) => e.key));
    const fresh = cur.events.filter((e) => !seen.has(e.key) && e.kind !== 'sub');
    // Alleen zoveel goals melden als de stand gestegen is: een gecorrigeerde schutter is geen nieuwe goal.
    const tot = (x) => (x && x.score ? x.score.home + x.score.away : 0);
    const rise = Math.max(0, tot(cur) - tot(prev));
    const newGoals = fresh.filter((e) => e.kind === 'goal');
    const goals = new Set(rise ? newGoals.slice(-rise) : []);
    fresh.forEach((e) => {
      if (e.kind === 'goal') {
        if (!goals.has(e)) return;
        const own = /own/i.test(e.type);
        const forUs = (e.teamId === TEAM) !== own;
        out.push({ kind: forUs ? 'goalUs' : 'goalThem', msg: { title: `${forUs ? '⚽' : '🥅'} ${line(cur)}`, body: `${mm(e)} ${e.player || 'onbekend'}${own ? ' (eigen goal)' : ''}${/penalty/i.test(e.type) ? ' (penalty)' : ''}${e.assist ? ` · assist ${e.assist}` : ''}`, url, tag: `live-${m.id}-${e.key}` } });
      } else if (e.kind === 'red') {
        out.push({ kind: 'red', msg: { title: `🟥 ${e.player || 'Rode kaart'} (${mm(e)})`, body: `${e.teamId === TEAM ? 'Cambuur' : 'Tegenstander'} met tien · ${line(cur)}`, url, tag: `live-${m.id}-${e.key}` } });
      }
    });
  }
  const was = prev ? prev.status : 'pre';
  if (cur.status !== was) {
    const t = cur.status === 'live' && was === 'pre' ? 'Aftrap' : cur.status === 'ht' ? 'Rust' : cur.status === 'ft' ? 'Einde' : null;
    if (t) out.push({ kind: 'status', msg: { title: `${t}: ${line(cur)}`, body: m.comp || '', url, tag: `live-${m.id}-${cur.status}` } });
  }
  return out;
}

async function deliver(kv, list, matchId) {
  if (!list.length) return;
  const subs = (await kv.get(SUBS, 'json')) || [];
  const gone = new Set();
  for (const s of subs) {
    const p = { ...LIVE_DEFAULTS, ...(s.live || {}) };
    if (!p.on || (s.mute || []).includes(String(matchId))) continue;
    for (const x of list) {
      if (!p[x.kind]) continue;
      const st = await sendPush(kv, s, x.msg).catch(() => 0);
      if (st === 404 || st === 410) { gone.add(s.endpoint); break; }
    }
  }
  if (gone.size) await kv.put(SUBS, JSON.stringify(subs.filter((s) => !gone.has(s.endpoint))));
}

/** Elke minuut vanuit de cron. deps: { base, remainingOf, state(), saveRemaining(n) } */
export async function liveScheduled(env, time, deps) {
  const kv = env.MS_KV;
  if (!kv || !env.HIGHLIGHTLY_KEY) return;
  const now = Number(time);
  const schedule = (await kv.get(SCHEDULE, 'json')) || [];
  const active = schedule.filter((m) => { const ko = Date.parse(m.date); return ko && now >= ko + START && now <= ko + END && /^\d+$/.test(String(m.id)); });
  if (!active.length) return;
  const ns = await deps.state();
  if (!liveEnabled(ns)) return;
  for (const m of active) {
    const ko = Date.parse(m.date);
    let prev = await kv.get(LIVE + m.id, 'json');
    if (prev && (prev.status === 'ft' || prev.status === 'off')) continue;
    const every = intervalFor(ns.remaining, now, ko, ns.mode);
    const minute = Math.floor((now - ko) / 60e3);
    if (!every || ((minute % every) + every) % every !== 0) continue;
    // Meting (tijdelijk): met ruim budget twee keer per minuut vragen (nu en na 30 s) en per vraag loggen wat er
    // veranderde. Daarmee zien we hoe vaak Highlightly zelf bijwerkt, en of 30 seconden zin heeft.
    const measure = MEASURE && every === 1;
    const log = [];
    for (let k = 0; k < (measure ? 2 : 1); k++) {
      if (k) await new Promise((r) => setTimeout(r, 30e3));
      const t = k ? Date.now() : now;
      const res = await fetch(`${deps.base}/matches/${Number(m.id)}`, { headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_KEY } });
      const r = deps.remainingOf(res); const lim = limitOf(res);
      if (lim != null && lim !== ns.limit) { ns.limit = lim; if (deps.saveLimit) await deps.saveLimit(lim); }
      if (r != null) { ns.remaining = r; if ((minute % 10 === 0 && !k) || r < 50) await deps.saveRemaining(r); }
      if (!liveEnabled(ns)) return; // net ontdekt: gratis plan
      if (!res.ok) { log.push({ t: new Date(t).toISOString(), http: res.status }); continue; }
      let cur;
      try { cur = parseLive(await res.text()); } catch { continue; }
      if (!cur) continue;
      const sig = JSON.stringify([cur.status, cur.score, cur.events.map((e) => e.key)]);
      const prevSig = prev ? JSON.stringify([prev.status, prev.score, (prev.events || []).map((e) => e.key)]) : null;
      log.push({ t: new Date(t).toISOString(), clock: cur.clock, st: cur.status, sc: cur.score ? `${cur.score.home}-${cur.score.away}` : null, ev: cur.events.length, ch: sig !== prevSig, clk: !prev || prev.clock !== cur.clock, age: res.headers.get('age'), cache: res.headers.get('cf-cache-status') });
      // Eerste keer dat we hem zien terwijl hij al bezig is: oude goals niet alsnog melden.
      const base = prev || (cur.status === 'pre' ? { status: 'pre', events: [] } : { status: cur.status, events: cur.events });
      const msgs = messagesFor(base, cur, m);
      const changed = !prev || sig !== prevSig || prev.clock !== cur.clock && minute % 5 === 0 && !k;
      const next = { ...cur, at: new Date(t).toISOString(), every, ko: m.date, comp: m.comp || null, ftSent: cur.status === 'ft' || !!(prev && prev.ftSent) };
      if (changed || (measure && prev && prev.clock !== cur.clock)) await kv.put(LIVE + m.id, JSON.stringify(next), { expirationTtl: 2 * 86400 });
      await deliver(kv, msgs, m.id);
      prev = next;
      if (cur.status === 'ft' || cur.status === 'off') break;
    }
    if (measure && log.length) {
      const all = (await kv.get(LOG + m.id, 'json')) || [];
      await kv.put(LOG + m.id, JSON.stringify([...all, ...log].slice(-400)), { expirationTtl: 7 * 86400 });
    }
  }
}

/** GET /live: standen van wedstrijden van de afgelopen 6 uur en de komende 15 minuten. */
export async function liveApi(env, json) {
  const kv = env.MS_KV;
  const now = Date.now();
  const ns = (await kv.get('ns:state', 'json')) || {};
  if (!liveEnabled(ns)) return json({ now: new Date(now).toISOString(), enabled: false, limit: ns.limit, matches: [] }, 200);
  const schedule = (await kv.get(SCHEDULE, 'json')) || [];
  const near = schedule.filter((m) => { const ko = Date.parse(m.date); return ko && now >= ko - 15 * 60e3 && now <= ko + 6 * 3600e3; });
  const out = [];
  for (const m of near) {
    const s = await kv.get(LIVE + m.id, 'json');
    const log = MEASURE ? await kv.get(LOG + m.id, 'json') : null;
    out.push({ id: String(m.id), ko: m.date, homeName: m.homeName, awayName: m.awayName, comp: m.comp, state: s || null, log: log || null });
  }
  return json({ now: new Date(now).toISOString(), enabled: true, matches: out }, 200);
}

/** POST /push/device { endpoint, live?: {...}, mute?: { id: true|false } } → prefs van dit apparaat. */
export async function deviceApi(kv, body, json) {
  const subs = (await kv.get(SUBS, 'json')) || [];
  const s = subs.find((x) => x.endpoint === (body && body.endpoint));
  if (!s) return json({ error: 'Dit apparaat is niet aangemeld voor meldingen' }, 404);
  let dirty = false;
  if (body.live && typeof body.live === 'object') {
    const cur = { ...LIVE_DEFAULTS, ...(s.live || {}) };
    Object.keys(LIVE_DEFAULTS).forEach((k) => { if (typeof body.live[k] === 'boolean') cur[k] = body.live[k]; });
    s.live = cur; dirty = true;
  }
  if (body.mute && typeof body.mute === 'object') {
    const set = new Set(s.mute || []);
    Object.entries(body.mute).forEach(([id, v]) => { if (v) set.add(String(id).slice(0, 20)); else set.delete(String(id)); });
    s.mute = [...set].slice(-40); dirty = true;
  }
  if (dirty) await kv.put(SUBS, JSON.stringify(subs));
  return json({ ok: true, live: { ...LIVE_DEFAULTS, ...(s.live || {}) }, mute: s.mute || [] }, 200);
}
