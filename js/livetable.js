// Live stand: Highlightly's /standings loopt achter tot een speelronde klaar is. Hebben we alle
// competitiewedstrijden (leagueMatches), dan rekenen we de stand zelf uit de uitslagen.
// Puntenaftrek nemen we over uit de Highlightly-stand: het verschil tussen hun punten en W/G/V.

import { getStandings, getLeagueMatches } from './store.js';
import { rankRows } from './rules.js';

const blank = () => ({ played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
function add(line, gf, ga) {
  line.played++; line.gf += gf; line.ga += ga;
  if (gf > ga) line.w++; else if (gf < ga) line.l++; else line.d++;
}

// Play-offs en nacompetitie staan bij Highlightly onder dezelfde competitie. Die tellen niet mee in de stand
// (anders "speelt" een club 44 KKD-duels: 38 + 6 play-offduels).
const PLAYOFF = /play-?off|promotion|relegation|nacompetitie|knock|semi|quarter|final|degradatie|promotie/i;
export function regularOnly(list) {
  const all = list || [];
  if (all.some((m) => /regular season/i.test(m.round || ''))) return all.filter((m) => /regular season/i.test(m.round || ''));
  return all.filter((m) => !PLAYOFF.test(m.round || ''));
}

export function liveStandings(hl, matches) {
  const finished = regularOnly(matches).filter((m) => m.status === 'finished' && m.score && m.score.home != null);
  if (!finished.length) return null;
  const base = hl && hl.groups && hl.groups[0] ? hl.groups[0].rows : [];
  const rows = new Map();
  const row = (t) => {
    if (!rows.has(t.id)) {
      const h = base.find((r) => r.team.id === t.id);
      const deduction = h && h.total ? (h.total.w * 3 + h.total.d) - h.points : 0;
      rows.set(t.id, { team: h ? h.team : { id: t.id, name: t.name, logo: t.logo || null }, total: blank(), home: blank(), away: blank(), deduction: Math.max(0, deduction) });
    }
    return rows.get(t.id);
  };
  base.forEach((r) => row(r.team));
  finished.forEach((m) => {
    const H = row(m.homeTeam); const A = row(m.awayTeam);
    add(H.total, m.score.home, m.score.away); add(H.home, m.score.home, m.score.away);
    add(A.total, m.score.away, m.score.home); add(A.away, m.score.away, m.score.home);
  });
  // Gelijk op punten, doelsaldo en doelpunten: onderling resultaat (KNVB art. 17 lid 4).
  const list = rankRows([...rows.values()].map((r) => ({ ...r, points: r.total.w * 3 + r.total.d - r.deduction })), { tiebreak: ['points', 'gd', 'gf', 'h2h'], matches: finished });
  const playedSum = (rs) => rs.reduce((t, r) => t + (r.total ? r.total.played : 0), 0);
  return {
    source: 'live', league: hl ? hl.league : null,
    fetchedAt: finished.map((m) => m.date).sort().pop(),
    groups: [{ name: hl && hl.groups && hl.groups[0] ? hl.groups[0].name : '', rows: list }],
    ahead: playedSum(list) - playedSum(base),
  };
}

/** De meest actuele stand plus alle competitiewedstrijden (voor periodes en onderling resultaat). */
export async function standingsAndMatches(leagueId, season) {
  const [hl, all] = await Promise.all([getStandings(leagueId, season), getLeagueMatches(leagueId, season).catch(() => [])]);
  const lm = regularOnly(all);
  if (!lm.length) return { standings: hl, matches: lm };
  const live = liveStandings(hl, lm);
  if (!live) return { standings: hl, matches: lm };
  return { standings: !hl || live.ahead > 0 ? live : hl, matches: lm };
}

/** De meest actuele stand: zelf berekend als die verder is dan Highlightly, anders Highlightly. */
export async function bestStandings(leagueId, season) {
  return (await standingsAndMatches(leagueId, season)).standings;
}
