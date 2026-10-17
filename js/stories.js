// Magazineteksten uit je eigen data. Vaste sjablonen, niets verzonnen:
// elk sjabloon checkt zelf of de data het waarmaakt, anders komt het er niet in.

import { MAIN_CLUB, ZONES } from './config.js';
import { sortByDate, resultFor, opponentOf, isHome, shortRound, roundNumber } from './season.js';
import { kindOf } from './corrections.js';

const TEAM = MAIN_CLUB.id;
const nl = (v) => Number(v).toLocaleString('nl-NL');
const pts = (r) => (r === 'W' ? 3 : r === 'G' ? 1 : 0);
const goalsFor = (m) => (isHome(m, TEAM) ? m.score.home : m.score.away);
const goalsAgainst = (m) => (isHome(m, TEAM) ? m.score.away : m.score.home);
const signed = (v) => (v > 0 ? `+${v}` : String(v));

function leagueGames(list, leagueId) {
  return sortByDate(list.filter((m) => m.league && m.league.id === leagueId && resultFor(m, TEAM)));
}

function standRow(standings, teamId) {
  const g = standings && standings.groups && standings.groups[0];
  return g ? g.rows.find((r) => r.team.id === teamId) || null : null;
}

// ---------- Voorbeschouwing ----------

export function preview(next, list, league, standings) {
  if (!next) return null;
  const opp = opponentOf(next, TEAM);
  const oppName = opp ? opp.name : 'de tegenstander';
  const home = isHome(next, TEAM);
  const cup = next.league && /beker|cup/i.test(next.league.name);
  const friendly = next.league && /friendl/i.test(next.league.name);

  let title;
  if (friendly) title = `Oefenen tegen ${oppName}`;
  else if (cup) title = home ? `Bekeravond tegen ${oppName}` : `Bekerduel bij ${oppName}`;
  else title = home ? `${oppName} komt naar ${MAIN_CLUB.city}` : `${MAIN_CLUB.name} op bezoek bij ${oppName}`;

  let sub = null;
  if (league && !friendly) {
    const games = leagueGames(list, league.id);
    const last4 = games.slice(-4);
    let unbeaten = 0;
    for (let i = games.length - 1; i >= 0 && resultFor(games[i], TEAM) !== 'V'; i--) unbeaten++;
    let winless = 0;
    for (let i = games.length - 1; i >= 0 && resultFor(games[i], TEAM) !== 'W'; i--) winless++;
    const me = standRow(standings, TEAM);
    const them = opp ? standRow(standings, opp.id) : null;
    if (unbeaten >= 3 && last4.length === 4) {
      sub = `${last4.reduce((t, m) => t + pts(resultFor(m, TEAM)), 0)} punten uit de laatste 4 duels. Houdt de reeks stand?`;
    } else if (winless >= 3) {
      sub = `Al ${winless} competitieduels zonder zege. Tijd voor de ommekeer?`;
    } else if (me && them && !cup) {
      const diff = me.points - them.points;
      sub = `${MAIN_CLUB.name} staat ${me.position}e met ${me.points} punten, ${oppName} ${them.position}e${diff ? ` met ${them.points}` : ', met evenveel punten'}.`;
    }
  }
  return { title, sub, home, cup, friendly };
}

// ---------- Verhalen (veegrij) ----------

export function seasonStories(list, league, standings, extra = {}) {
  if (!league) return [];
  const games = leagueGames(list, league.id);
  const out = [];
  if (!games.length) return out;

  // De reeks
  let unbeaten = 0;
  for (let i = games.length - 1; i >= 0 && resultFor(games[i], TEAM) !== 'V'; i--) unbeaten++;
  let winless = 0;
  for (let i = games.length - 1; i >= 0 && resultFor(games[i], TEAM) !== 'W'; i--) winless++;
  if (unbeaten >= 3) {
    const run = games.slice(-unbeaten);
    const p = run.reduce((t, m) => t + pts(resultFor(m, TEAM)), 0);
    const from = shortRound(run[0].round);
    out.push({ label: 'De reeks', fig: `${p} uit ${unbeaten}`, text: unbeaten === games.length ? 'Nog ongeslagen dit seizoen.' : `Sinds ${/^R\d+$/.test(from) ? 'speelronde ' + from.slice(1) : from} niet meer verloren.` });
  } else if (winless >= 3) {
    out.push({ label: 'De reeks', fig: String(winless), text: 'competitieduels op rij zonder zege.' });
  }

  // De omslag: laatste vier vs daarvoor
  if (games.length >= 7) {
    const last = games.slice(-4); const before = games.slice(0, -4);
    const lf = last.reduce((t, m) => t + goalsFor(m), 0); const la = last.reduce((t, m) => t + goalsAgainst(m), 0);
    const bf = before.reduce((t, m) => t + goalsFor(m), 0); const ba = before.reduce((t, m) => t + goalsAgainst(m), 0);
    const perLast = (lf - la) / last.length; const perBefore = (bf - ba) / before.length;
    if (Math.abs(perLast - perBefore) >= 1) {
      out.push({ label: perLast > perBefore ? 'De omslag' : 'De dip', fig: `${lf}–${la}`, text: `Doelen in de laatste vier duels. Daarvoor: ${bf}–${ba}.` });
    }
  }

  // Thuis vs uit
  if (games.length >= 4) {
    const home = games.filter((m) => isHome(m, TEAM)); const away = games.filter((m) => !isHome(m, TEAM));
    const hp = home.reduce((t, m) => t + pts(resultFor(m, TEAM)), 0);
    const ap = away.reduce((t, m) => t + pts(resultFor(m, TEAM)), 0);
    if (home.length && away.length && hp !== ap) {
      out.push(ap > hp
        ? { label: 'Thuis vs uit', fig: `${ap} van ${ap + hp}`, text: `punten haalde ${MAIN_CLUB.name} buiten ${MAIN_CLUB.city}.` }
        : { label: 'Thuis vs uit', fig: `${hp} van ${ap + hp}`, text: `punten haalde ${MAIN_CLUB.name} in eigen huis.` });
    }
  }

  // Ruimte in de stand
  const me = standRow(standings, TEAM);
  const g = standings && standings.groups && standings.groups[0];
  const zones = ZONES[league.id] || [];
  if (me && g) {
    const at = (pos) => g.rows.find((r) => r.position === pos);
    const po = zones.find((z) => z.kind === 'po'); const pl = zones.find((z) => z.kind === 'playoff');
    if (pl && me.position < pl.from && at(pl.from)) {
      const gap = me.points - at(pl.from).points;
      out.push({ label: 'Ruimte', fig: signed(gap), text: `punten op plek ${pl.from}, de nacompetitie.` });
    } else if (pl && me.position >= pl.from && at(pl.from - 1)) {
      out.push({ label: 'Het gat', fig: String(at(pl.from - 1).points - me.points), text: `punten tot plek ${pl.from - 1}, veilig.` });
    }
    if (po && me.position > po.to && at(po.to)) {
      const gap = at(po.to).points - me.points;
      if (gap <= 6) out.push({ label: 'Europa?', fig: String(gap), text: `punten tot plek ${po.to}, de play-offs.` });
    }
  }

  // Topscorer en publiek (uit Selectie en Aanvullen)
  if (extra.topScorer && extra.topScorer.goals >= 2) {
    out.push({ label: 'Topscorer', fig: String(extra.topScorer.goals), text: `goals voor ${extra.topScorer.name} in officiële duels.` });
  }
  if (extra.homeAvg != null) out.push({ label: 'Publiek', fig: nl(extra.homeAvg), text: `gemiddeld in ${MAIN_CLUB.city}, over ${extra.homeCount} ${extra.homeCount === 1 ? 'duel' : 'duels'}.` });
  return out.slice(0, 6);
}

// ---------- Vorige week ----------

function playerSide(m) {
  const box = (m.detail && m.detail.players && m.detail.players[TEAM]) || [];
  return new Map(box.map((p) => [p.id, p]));
}

export function matchReport(m) {
  if (!m || m.status !== 'finished' || !m.score) return null;
  const r = resultFor(m, TEAM);
  const opp = opponentOf(m, TEAM);
  const oppName = opp ? opp.name : 'de tegenstander';
  const home = isHome(m, TEAM);
  const city = m.detail && m.detail.venue && m.detail.venue.city;
  const place = home ? `in ${MAIN_CLUB.city}` : city ? `in ${city}` : `bij ${oppName}`;
  const gf = goalsFor(m); const ga = goalsAgainst(m);
  const short = (t) => (t ? t.name.slice(0, 3).toUpperCase() : '?');
  const scoreLine = `${short(m.homeTeam)} ${m.score.home}–${m.score.away} ${short(m.awayTeam)}`;

  if (!m.detail) {
    const title = r === 'W' ? `${MAIN_CLUB.name} wint ${place}` : r === 'G' ? `Gelijkspel ${place}` : `Nederlaag ${place}`;
    return { title, sub: null, scoreLine, hero: null, needsDetail: true };
  }

  const box = playerSide(m);
  const goals = m.detail.events.filter((e) => kindOf(e.type) === 'goal' && !/own/i.test(e.type) && e.teamId === TEAM);
  const byPlayer = {};
  goals.forEach((e) => { if (e.playerId) byPlayer[e.playerId] = (byPlayer[e.playerId] || []).concat(e); });
  const top = Object.entries(byPlayer).sort((a, b) => b[1].length - a[1].length)[0];
  const topEv = top ? top[1] : [];
  const topName = topEv.length ? topEv[0].player : null;
  const topId = top ? Number(top[0]) : null;
  const lastGoal = goals[goals.length - 1];
  const late = (e) => e && ((e.minute ?? 0) >= 85);

  let title;
  if (r === 'W') {
    if (topEv.length >= 3) title = `Hattrick ${topName} ${place}`;
    else if (gf - ga >= 3) title = `${MAIN_CLUB.name} walst over ${oppName} heen`;
    else if (gf - ga === 1 && lastGoal && lastGoal.player && (late(lastGoal) || gf === 1)) title = `${lastGoal.player} beslist het ${place}`;
    else if (topEv.length === 2) title = `${topName} schiet ${MAIN_CLUB.name} langs ${oppName}`;
    else title = `${MAIN_CLUB.name} wint ${place}`;
  } else if (r === 'G') {
    if (lastGoal && late(lastGoal) && lastGoal.player && gf > 0) title = `${lastGoal.player} redt een punt ${place}`;
    else title = gf === 0 ? `Brilstand ${place}` : `Punt ${place}`;
  } else {
    title = gf === 0 ? `${MAIN_CLUB.name} blijft zonder goal ${place}` : `Nederlaag ${place}`;
  }

  // Ondertitel: twee feiten, als ze kloppen.
  const lines = [];
  const heroEv = r === 'W' && gf - ga === 1 && lastGoal ? lastGoal : topEv[0];
  if (heroEv && heroEv.playerId) {
    const p = box.get(heroEv.playerId);
    const min = `${heroEv.minute}${heroEv.extra ? '+' + heroEv.extra : ''}e minuut`;
    if (p && p.sub) lines.push(`Invaller ${heroEv.player} scoort in de ${min}.`);
    else if (topEv.length < 2) lines.push(`${heroEv.player} scoort in de ${min}.`);
  }
  if (ga === 0) {
    const keeper = [...box.values()].find((p) => /goalkeeper/i.test(p.position || '') && p.minutes > 0);
    if (keeper) lines.push(keeper.saves >= 3 ? `${keeper.name} houdt de nul met ${keeper.saves} reddingen.` : `${keeper.name} houdt de nul.`);
  }
  const best = [...box.values()].filter((p) => p.rating != null && p.minutes > 0).sort((a, b) => b.rating - a.rating)[0];
  if (best && lines.length < 2 && !lines.some((l) => l.includes(best.name))) lines.push(`${best.name} was met een ${best.rating.toFixed(1)} de beste ${MAIN_CLUB.name}-speler.`);

  const heroId = heroEv && heroEv.playerId ? heroEv.playerId : best ? best.id : topId;
  const heroP = heroId ? box.get(heroId) : null;
  return {
    title, sub: lines.slice(0, 2).join(' ') || null, scoreLine,
    hero: heroP ? { id: heroP.id, name: heroP.name, number: heroP.number } : null,
    needsDetail: false,
  };
}

export { roundNumber };
