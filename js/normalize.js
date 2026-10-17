// Zet Highlightly-responses om naar het eigen datamodel.
// Puur rekenwerk, geen netwerk of opslag: makkelijk te testen.

import { SCHEMA_VERSION } from './config.js';

const one = (v) => (Array.isArray(v) ? v[0] : v);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function parseScore(current) {
  if (!current || typeof current !== 'string') return null;
  const m = current.match(/(\d+)\s*-\s*(\d+)/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

export function statusOf(description) {
  const d = String(description || '').toLowerCase();
  if (d.includes('finished')) return 'finished';
  if (d.includes('not started') || d === '' || d.includes('to be')) return 'scheduled';
  if (/postpon|cancel|suspend|abandon|delay/.test(d)) return 'postponed';
  return 'live';
}

function team(t) {
  return t ? { id: t.id, name: t.name, logo: t.logo || null } : null;
}

/** Eén wedstrijd uit /matches → basis-document (zonder detail). */
export function normalizeListMatch(m) {
  return {
    id: m.id,
    schemaVersion: SCHEMA_VERSION,
    date: m.date,
    round: m.round || null,
    league: m.league ? { id: m.league.id, name: m.league.name, season: m.league.season } : null,
    homeTeam: team(m.homeTeam),
    awayTeam: team(m.awayTeam),
    status: statusOf(m.state && m.state.description),
    stateText: (m.state && m.state.description) || null,
    score: parseScore(m.state && m.state.score && m.state.score.current),
    penalties: parseScore(m.state && m.state.score && m.state.score.penalties),
  };
}

function minuteOf(time) {
  const m = String(time || '').match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!m) return { minute: null, extra: null };
  return { minute: Number(m[1]), extra: m[2] ? Number(m[2]) : null };
}

/**
 * Events. Let op de Highlightly-naamgeving bij wissels:
 * `player` = speler die eruit gaat, `substituted` + `assistingPlayerId` = speler die erin komt.
 */
export function normalizeEvents(events) {
  return (events || []).map((e) => {
    const { minute, extra } = minuteOf(e.time);
    const base = { minute, extra, type: e.type, teamId: e.team ? e.team.id : null };
    if (e.type === 'Substitution') {
      return { ...base, outId: e.playerId ?? null, outName: e.player || null, inId: e.assistingPlayerId ?? null, inName: e.substituted || null };
    }
    return {
      ...base,
      playerId: e.playerId ?? null,
      player: e.player || null,
      assistId: e.assistingPlayerId ?? null,
      assist: e.assist || null,
    };
  }).sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (a.extra ?? 0) - (b.extra ?? 0));
}

function statsOf(entry) {
  const out = {};
  (entry && entry.statistics || []).forEach((s) => { out[s.displayName] = s.value; });
  return out;
}

export function normalizeStats(statistics, homeId) {
  const list = statistics || [];
  const home = list.find((s) => s.team && s.team.id === homeId) || list[0];
  const away = list.find((s) => s !== home) || null;
  return { home: statsOf(home), away: statsOf(away) };
}

function lineupSide(side) {
  if (!side) return null;
  const starters = [];
  (side.initialLineup || []).forEach((line, lineIndex) => {
    (line || []).forEach((p) => starters.push({ id: p.id, name: p.name, number: num(p.number), position: p.position || null, line: lineIndex }));
  });
  const subs = (side.substitutes || []).map((p) => ({ id: p.id, name: p.name, number: num(p.number), position: p.position || null }));
  return { teamId: side.id, formation: side.formation || null, starters, subs };
}

export function normalizeLineups(raw) {
  const l = one(raw) || {};
  return { home: lineupSide(l.homeTeam), away: lineupSide(l.awayTeam) };
}

export function normalizeBoxScore(raw) {
  const out = {};
  (raw || []).forEach((t) => {
    out[t.team.id] = (t.players || []).map((p) => {
      const s = p.statistics || {};
      return {
        id: p.id,
        name: p.fullName || p.name,
        number: num(p.shirtNumber),
        position: p.position || null,
        minutes: num(p.minutesPlayed) ?? 0,
        rating: num(p.matchRating),
        captain: !!p.isCaptain,
        sub: !!p.isSubstitute,
        goals: num(s.goalsScored) ?? 0,
        assists: num(s.assists) ?? 0,
        yellow: num(s.cardsYellow) ?? 0,
        // cardsSecondYellow is onbetrouwbaar (staat op 1 bij elke gele kaart), dus niet gebruikt.
        red: num(s.cardsRed) ?? 0,
        saves: num(s.goalsSaved) ?? 0,
        conceded: num(s.goalsConceded) ?? 0,
      };
    });
  });
  return out;
}

function standLine(s) {
  if (!s) return null;
  const n = (v) => num(v) ?? 0;
  return { played: n(s.games), w: n(s.wins), d: n(s.draws), l: n(s.loses), gf: n(s.scoredGoals), ga: n(s.receivedGoals) };
}

/** /standings → { league, groups: [{ name, rows: [...] }] }. Punten komen van de API (puntenaftrek zit erin). */
export function normalizeStandings(raw) {
  const r = one(raw) || {};
  return {
    league: r.league ? { id: r.league.id, name: r.league.name, season: r.league.season } : null,
    groups: (r.groups || []).map((g) => ({
      name: g.name || '',
      rows: (g.standings || []).map((s) => ({
        position: num(s.position),
        points: num(s.points) ?? 0,
        team: { id: s.team.id, name: s.team.name, logo: s.team.logo || null },
        total: standLine(s.total),
        home: standLine(s.home),
        away: standLine(s.away),
      })).sort((a, b) => a.position - b.position),
    })),
  };
}

/** Detail + lineups + box score → het `detail`-deel van een wedstrijddocument. */
export function normalizeDetail(detailRaw, lineupsRaw, boxRaw) {
  const d = one(detailRaw) || {};
  const homeId = d.homeTeam ? d.homeTeam.id : null;
  const venue = d.venue ? { name: d.venue.name || null, city: d.venue.city || null, capacity: num(d.venue.capacity) } : null;
  return {
    base: normalizeListMatch(d),
    detail: {
      fetchedAt: new Date().toISOString(),
      venue,
      referee: d.referee ? d.referee.name || null : null,
      events: normalizeEvents(d.events),
      stats: normalizeStats(d.statistics, homeId),
      lineups: normalizeLineups(lineupsRaw),
      players: normalizeBoxScore(boxRaw),
    },
  };
}
