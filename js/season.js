// Afgeleide seizoenscijfers vanuit het perspectief van één club. Puur rekenwerk.

import { TIME_ZONE } from './config.js';

const ts = (m) => Date.parse(m.date);

export function sortByDate(list) {
  return [...list].sort((a, b) => ts(a) - ts(b));
}

export function resultFor(m, teamId) {
  if (m.status !== 'finished' || !m.score) return null;
  const home = m.homeTeam && m.homeTeam.id === teamId;
  const gf = home ? m.score.home : m.score.away;
  const ga = home ? m.score.away : m.score.home;
  if (gf > ga) return 'W';
  if (gf < ga) return 'V';
  if (m.penalties) {
    const pf = home ? m.penalties.home : m.penalties.away;
    const pa = home ? m.penalties.away : m.penalties.home;
    if (pf !== pa) return pf > pa ? 'W' : 'V';
  }
  return 'G';
}

export function opponentOf(m, teamId) {
  return m.homeTeam && m.homeTeam.id === teamId ? m.awayTeam : m.homeTeam;
}

export function isHome(m, teamId) {
  return !!(m.homeTeam && m.homeTeam.id === teamId);
}

/** De competitie met de meeste wedstrijden (geen oefenduels): meestal de hoofdcompetitie. */
export function mainLeague(list) {
  const counts = new Map();
  list.forEach((m) => {
    if (!m.league || /friendl/i.test(m.league.name)) return;
    counts.set(m.league.id, (counts.get(m.league.id) || 0) + 1);
  });
  let best = null;
  counts.forEach((n, id) => { if (!best || n > best.n) best = { id, n }; });
  if (!best) return null;
  const any = list.find((m) => m.league && m.league.id === best.id);
  return any.league;
}

export function leagueSummary(list, teamId, leagueId) {
  const played = sortByDate(list.filter((m) => m.league && m.league.id === leagueId && resultFor(m, teamId)));
  let w = 0; let d = 0; let l = 0; let gf = 0; let ga = 0;
  let homePts = 0; let awayPts = 0;
  played.forEach((m) => {
    const r = resultFor(m, teamId);
    const home = isHome(m, teamId);
    gf += home ? m.score.home : m.score.away;
    ga += home ? m.score.away : m.score.home;
    const pts = r === 'W' ? 3 : r === 'G' ? 1 : 0;
    if (r === 'W') w++; else if (r === 'G') d++; else l++;
    if (home) homePts += pts; else awayPts += pts;
  });
  let unbeaten = 0;
  for (let i = played.length - 1; i >= 0 && resultFor(played[i], teamId) !== 'V'; i--) unbeaten++;
  let winless = 0;
  for (let i = played.length - 1; i >= 0 && resultFor(played[i], teamId) !== 'W'; i--) winless++;
  return {
    played: played.length, w, d, l, gf, ga, points: w * 3 + d, homePts, awayPts,
    form: played.slice(-5).map((m) => resultFor(m, teamId)),
    unbeaten, winless,
  };
}

export function nextMatch(list, now = Date.now()) {
  return sortByDate(list).find((m) => m.status !== 'finished' && ts(m) >= now - 3 * 3600e3) || null;
}

export function lastMatch(list) {
  const done = sortByDate(list).filter((m) => m.status === 'finished');
  return done.length ? done[done.length - 1] : null;
}

// ---------- Datum en tijd in Nederlandse tijd ----------

const fmt = (opts) => new Intl.DateTimeFormat('nl-NL', { timeZone: TIME_ZONE, ...opts });
const fDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const fLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const fTime = fmt({ hour: '2-digit', minute: '2-digit' });
const fMonth = fmt({ month: 'long', year: 'numeric' });
const fDayKey = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

export const dayShort = (iso) => fDay.format(new Date(iso)).replace('.', '');
export const dayLong = (iso) => fLong.format(new Date(iso));
export const timeOf = (iso) => fTime.format(new Date(iso));
export const monthOf = (iso) => fMonth.format(new Date(iso));

export function relativeDay(iso, now = new Date()) {
  const a = fDayKey.format(new Date(iso));
  const b = fDayKey.format(now);
  const tomorrow = fDayKey.format(new Date(now.getTime() + 864e5));
  if (a === b) return 'vandaag';
  if (a === tomorrow) return 'morgen';
  return null;
}

export function roundNumber(round) {
  const m = String(round || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

export function shortRound(round) {
  const n = roundNumber(round);
  if (/regular season/i.test(round || '') && n) return `R${n}`;
  return round || '';
}

/**
 * Publiek. Alleen gespeelde competitiewedstrijden met een ingevuld aantal tellen mee:
 * leeg is onbekend, niet 0. Thuis en uit worden nooit door elkaar gemiddeld.
 */
export function crowdSummary(list, teamId, leagueId) {
  const games = list.filter((m) => m.status === 'finished' && m.league && m.league.id === leagueId && m.notes);
  const home = games.filter((m) => isHome(m, teamId) && m.notes.attendance != null);
  const away = games.filter((m) => !isHome(m, teamId));
  const fans = away.filter((m) => m.notes.awayFans != null);
  const awayCrowd = away.filter((m) => m.notes.attendance != null);
  const sum = (arr, k) => arr.reduce((t, m) => t + m.notes[k], 0);
  const top = (arr, k) => arr.slice().sort((a, b) => b.notes[k] - a.notes[k])[0] || null;
  return {
    homeAvg: home.length ? Math.round(sum(home, 'attendance') / home.length) : null,
    homeCount: home.length,
    homeTop: top(home, 'attendance'),
    fansTotal: fans.length ? sum(fans, 'awayFans') : null,
    fansAvg: fans.length ? Math.round(sum(fans, 'awayFans') / fans.length) : null,
    fansCount: fans.length,
    fansTop: top(fans, 'awayFans'),
    awayTop: top(awayCrowd, 'attendance'),
  };
}
