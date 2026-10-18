// Selectie en spelersstats, opgebouwd uit opgehaalde wedstrijden.
//
// Wie: iedereen die bij de club op het wedstrijdformulier stond (basis of bank), op speler-id.
// Goals en assists: uit de tijdlijn, mét jouw correcties. Minuten, kaarten en cijfer: box score.
// Oefenduels tellen niet mee.

import { kindOf } from './corrections.js';
import { sortByDate, resultFor } from './season.js';
import { bestApiName, fullName, shortName } from './names.js';

export const LINES = [
  ['Goalkeeper', 'Keepers'],
  ['Defender', 'Verdedigers'],
  ['Midfielder', 'Middenvelders'],
  ['Forward', 'Aanvallers'],
  ['', 'Overig'],
];
export const LINE_SHORT = { Goalkeeper: 'Keeper', Defender: 'Verdediger', Midfielder: 'Middenvelder', Forward: 'Aanvaller', '': '—' };

const official = (m) => m.league && !/friendl/i.test(m.league.name);

function sideOf(m, teamId) {
  const l = m.detail.lineups || {};
  return ['home', 'away'].map((s) => l[s]).find((x) => x && x.teamId === teamId) || null;
}

/** list: wedstrijden mét correcties toegepast. Geeft { players: [...], matches: n }. */
export function buildSquad(list, teamId, profiles = {}) {
  const games = sortByDate(list.filter((m) => m.detail && m.status === 'finished' && official(m)));
  const map = new Map();
  const get = (id) => {
    if (!map.has(id)) {
      map.set(id, {
        id, rawNames: [], numbers: {}, positions: {},
        squads: 0, apps: 0, starts: 0, subIns: 0, minutes: 0,
        goals: 0, assists: 0, penalties: 0, yellow: 0, red: 0, ratings: [], log: [],
      });
    }
    return map.get(id);
  };

  games.forEach((m) => {
    const side = sideOf(m, teamId);
    const box = (m.detail.players && m.detail.players[teamId]) || [];
    const starters = new Set(side ? side.starters.map((p) => p.id) : box.filter((p) => !p.sub).map((p) => p.id));
    const entries = new Map();
    const add = (p) => {
      if (!p || !p.id) return;
      const e = entries.get(p.id) || { id: p.id };
      if (p.apiName || p.name) e.name = p.apiName || p.name; // Highlightly-spelling, niet jouw korte naam
      if (p.number != null) e.number = p.number;
      if (p.position) e.position = p.position;
      entries.set(p.id, e);
    };
    if (side) [...side.starters, ...side.subs].forEach(add);
    box.forEach(add);

    const goals = {}; const assists = {}; const pens = {};
    m.detail.events.forEach((e) => {
      if (kindOf(e.type) !== 'goal' || /own/i.test(e.type) || e.teamId !== teamId) return;
      if (e.playerId) goals[e.playerId] = (goals[e.playerId] || 0) + 1;
      if (e.playerId && /penalty/i.test(e.type)) pens[e.playerId] = (pens[e.playerId] || 0) + 1;
      if (e.assistId) assists[e.assistId] = (assists[e.assistId] || 0) + 1;
    });
    // Een gecorrigeerde schutter staat soms niet in de opstelling (bijv. naam zonder id): niet bijtellen als speler.

    entries.forEach((e) => {
      const p = get(e.id);
      const b = box.find((x) => x.id === e.id) || {};
      const min = b.minutes || 0;
      const started = starters.has(e.id);
      if (e.name) p.rawNames.push(e.name);
      if (e.number != null) p.numbers[e.number] = (p.numbers[e.number] || 0) + 1;
      if (e.position) p.positions[e.position] = (p.positions[e.position] || 0) + 1;
      p.squads++;
      if (min > 0 || started) { p.apps++; if (started) p.starts++; else p.subIns++; }
      p.minutes += min;
      const g = goals[e.id] || 0; const a = assists[e.id] || 0;
      p.goals += g; p.assists += a; p.penalties += pens[e.id] || 0;
      p.yellow += b.yellow || 0; p.red += b.red || 0;
      if (b.rating != null && min > 0) p.ratings.push(b.rating);
      p.log.push({
        match: m, started, minutes: min, goals: g, assists: a,
        yellow: b.yellow || 0, red: b.red || 0, rating: min > 0 ? b.rating ?? null : null,
        captain: !!b.captain, result: resultFor(m, teamId),
      });
    });
  });

  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  const players = [...map.values()].map((p) => {
    const apiName = bestApiName(p.rawNames);
    const prof = profiles[p.id];
    const name = fullName(prof, apiName);
    const latest = p.log.length ? p.log[p.log.length - 1] : null;
    const num = top(p.numbers);
    const pos = top(p.positions);
    return {
      id: p.id, name, short: shortName(prof, apiName), apiName, profile: prof || null, number: num ? Number(num[0]) : null, position: pos ? pos[0] : '',
      squads: p.squads, apps: p.apps, starts: p.starts, subIns: p.subIns, minutes: p.minutes,
      goals: p.goals, assists: p.assists, penalties: p.penalties, yellow: p.yellow, red: p.red,
      rating: p.ratings.length ? p.ratings.reduce((t, r) => t + r, 0) / p.ratings.length : null,
      rated: p.ratings.length, log: p.log, lastSeen: latest ? latest.match.date : null,
    };
  });
  return { players, matches: games.length };
}

/** Een paar feitjes over een speler, alleen als ze iets zeggen. */
export function playerFacts(p, squad) {
  const facts = [];
  const last5 = p.log.slice(-5);
  const scored5 = last5.filter((l) => l.goals > 0).length;
  if (scored5 >= 2) facts.push(`Scoorde in ${scored5} van zijn laatste ${last5.length} duels`);
  const ga = p.goals + p.assists;
  if (ga && p.minutes >= 90) facts.push(`Elke ${Math.round(p.minutes / ga)} minuten betrokken bij een goal`);
  const ranked = squad.filter((x) => x.rated >= 3).sort((a, b) => b.rating - a.rating);
  const ri = ranked.findIndex((x) => x.id === p.id);
  if (ri === 0) facts.push('Hoogste gemiddelde cijfer van de selectie (min. 3 duels)');
  const byMin = squad.slice().sort((a, b) => b.minutes - a.minutes);
  if (byMin[0] && byMin[0].id === p.id && p.minutes) facts.push('Meeste speelminuten van de selectie');
  const topScorer = squad.slice().sort((a, b) => b.goals - a.goals)[0];
  if (topScorer && topScorer.id === p.id && p.goals) facts.push('Clubtopscorer');
  let streak = 0;
  for (let i = p.log.length - 1; i >= 0 && p.log[i].started; i--) streak++;
  if (streak >= 4) facts.push(`${streak} duels op rij in de basis`);
  const benchOnly = p.squads - p.apps;
  if (benchOnly >= 3 && p.apps === 0) facts.push(`${benchOnly} keer op de bank, nog geen minuut gespeeld`);
  const motm = p.log.filter((l) => l.match.notes && l.match.notes.motm && Number(l.match.notes.motm.playerId) === p.id).length;
  if (motm) facts.unshift(`${motm}× jouw man van de wedstrijd`);
  return facts.slice(0, 4);
}
