// Schorsingen als data: per competitie per seizoen(sreeks) een regelset, net als rules.js.
// Competitie zonder regelset = geen telling (alleen kaarten), nooit gokken met andermans regels.
//
// Bouwstenen:
//   yellow.steps     drempels in de telling: { at: 5, ban: 1 } en optioneel untilRound (bijv. Premier League:
//                    5 geel vóór ronde 19 = 1 duel, 10 vóór ronde 32 = 2 duels). Na de laatste stap:
//   yellow.thenEvery elke N gele kaarten erbij opnieuw `yellow.ban` duels.
//   secondYellow     2x geel in één duel: ban duels; countsInTally false = die twee gele tellen niet mee.
//   directRed        standaard ban duels; allCompetitions = geldt in elk officieel duel; confirm = jij vult
//                    de echte lengte in (aanklager/tuchtcommissie), tot dan geldt de standaard.
//   playoffs         resetTally = telling op nul bij de start van de nacompetitie; carryOpenBan = een open
//                    schorsing zit hij uit in de play-offs (zelfde competitie, dus dat gaat vanzelf).
//
// Bron: uitleg van de KNVB-regels (oktober 2026), nog niet het Reglement Wedstrijden Betaald Voetbal zelf.

import { MAIN_CLUB } from './config.js';
import { sortByDate } from './season.js';

const TEAM = MAIN_CLUB.id;
const SOURCE = 'Uitleg KNVB-regels, nog niet gecontroleerd in het reglement';

const KNVB_LEAGUE = {
  from: 2018, to: null, source: SOURCE,
  yellow: { steps: [{ at: 5, ban: 1 }], thenEvery: 2, ban: 1 },
  secondYellow: { ban: 1, countsInTally: false },
  directRed: { ban: 1, allCompetitions: true, confirm: true },
  playoffs: { resetTally: true, carryOpenBan: true },
};
const KNVB_CUP = {
  from: 2018, to: null, source: SOURCE,
  yellow: { steps: [{ at: 2, ban: 1 }], thenEvery: 2, ban: 1 },
  secondYellow: { ban: 1, countsInTally: false },
  directRed: { ban: 1, allCompetitions: true, confirm: true },
  playoffs: null,
};

export const CUP_ID = 77374;
export const DISCIPLINE = {
  75672: [KNVB_LEAGUE], // Eredivisie
  76523: [KNVB_LEAGUE], // Keuken Kampioen Divisie
  [CUP_ID]: [KNVB_CUP], // KNVB Beker
};

export function disciplineFor(leagueId, season) {
  const sets = DISCIPLINE[leagueId] || [];
  return sets.find((r) => season >= r.from && (r.to == null || season <= r.to)) || null;
}

const PLAYOFF = /play-?off|promotion|relegation|nacompetitie|degradatie|promotie/i;
export const isPlayoffRound = (m) => !/regular season/i.test(m.round || '') && PLAYOFF.test(m.round || '');
const roundNo = (m) => { const x = String(m.round || '').match(/(\d+)\s*$/); return x ? Number(x[1]) : null; };
const seasonOf = (m) => (m.league && m.league.season != null ? Number(m.league.season) : null);
const cardKind = (type) => {
  const t = String(type || '');
  if (/second yellow|yellow.?red/i.test(t)) return 'second';
  if (/red/i.test(t)) return 'red';
  if (/yellow/i.test(t)) return 'yellow';
  return null;
};
const minuteKey = (e) => (e.minute ?? 0) * 100 + (e.extra ?? 0);

/** Hoeveel duels schorsing levert gele kaart nummer n op (0 = geen). */
export function yellowBan(rule, n, round) {
  const y = rule && rule.yellow; if (!y) return 0;
  const steps = y.steps || [];
  for (const s of steps) if (n === s.at && (s.untilRound == null || round == null || round <= s.untilRound)) return s.ban;
  const last = steps[steps.length - 1];
  if (last && y.thenEvery && n > last.at && (n - last.at) % y.thenEvery === 0) return y.ban ?? last.ban;
  return 0;
}

/** Eerstvolgende drempel vanaf telling n, of null. */
export function nextThreshold(rule, n) {
  const y = rule && rule.yellow; if (!y) return null;
  for (let k = n + 1; k <= n + 50; k++) if (yellowBan(rule, k, null)) return k;
  return null;
}

/** Sleutel voor een rode kaart: wedstrijd + speler. */
export const redKey = (matchId, playerId) => `${matchId}:${playerId}`;

/**
 * Telling en schorsingen voor de eigen club uit een (gecorrigeerde) wedstrijdlijst.
 * decisions: { 'matchId:playerId': { kind: 'direct'|'second', ban: n } } uit meta/discipline.
 * Geeft { players: Map(id → info), reds: [...], coverage: Map(leagueId → { counted, total }) }.
 */
export function discipline(list, decisions = {}, teamId = TEAM) {
  const games = sortByDate((list || []).filter((m) => m.status === 'finished' && m.league && disciplineFor(m.league.id, seasonOf(m))));
  const players = new Map();
  const reds = [];
  const coverage = new Map();
  const bans = [];
  const get = (id, name) => {
    if (!players.has(id)) players.set(id, { id, name, tallies: new Map(), cards: [], bans: [] });
    const p = players.get(id); if (name && !p.name) p.name = name; return p;
  };

  games.forEach((m) => {
    const lid = m.league.id;
    const rule = disciplineFor(lid, seasonOf(m));
    const phase = rule.playoffs && rule.playoffs.resetTally && isPlayoffRound(m) ? 'playoff' : 'regular';
    const cov = coverage.get(lid) || { counted: 0, total: 0 }; cov.total++; coverage.set(lid, cov);

    // 1. Schorsingen die al openstonden: dit duel telt als uitgezeten (vóór de kaarten van dit duel).
    bans.forEach((b) => {
      if (b.left > 0 && b.matchId !== m.id && (b.scope === 'all' || b.scope === lid)) { b.left--; b.served.push(m.id); }
    });

    if (!m.detail || !Array.isArray(m.detail.events)) return;
    cov.counted++;
    const evs = m.detail.events.filter((e) => e.teamId === teamId && e.playerId != null && cardKind(e.type));
    const byPlayer = new Map();
    evs.forEach((e) => byPlayer.set(e.playerId, [...(byPlayer.get(e.playerId) || []), e]));

    byPlayer.forEach((list2, pid) => {
      const p = get(pid, list2[0].player);
      const tkey = `${lid}:${phase}`;
      const t = p.tallies.get(tkey) || { leagueId: lid, phase, yellows: 0, rule };
      p.tallies.set(tkey, t);
      const yellows = list2.filter((e) => cardKind(e.type) === 'yellow');
      const red = list2.find((e) => cardKind(e.type) === 'red' || cardKind(e.type) === 'second');
      let kind = null; let ban = 0;
      if (red) {
        const key = redKey(m.id, pid);
        const dec = decisions[key];
        const guess = cardKind(red.type) === 'second' || yellows.some((y) => minuteKey(y) <= minuteKey(red)) ? 'second' : 'direct';
        kind = (dec && dec.kind) || guess;
        ban = dec && dec.ban != null ? Number(dec.ban) : kind === 'second' ? rule.secondYellow.ban : rule.directRed.ban;
        reds.push({ key, match: m, playerId: pid, name: p.name, kind, guess, ban, decided: !!dec, confirm: kind === 'direct' ? !!rule.directRed.confirm : false });
      }
      // Gele kaarten in de telling: bij 2x geel tellen ze niet mee (als de regel dat zegt).
      const countYellows = red && kind === 'second' && !rule.secondYellow.countsInTally ? [] : yellows;
      countYellows.forEach(() => {
        t.yellows++;
        const b = yellowBan(rule, t.yellows, roundNo(m));
        p.cards.push({ match: m, kind: 'yellow', n: t.yellows, phase, ban: b });
        if (b) bans.push(Object.assign({ kind: 'yellow', playerId: pid, matchId: m.id, date: m.date, scope: lid, games: b, left: b, served: [], reason: `${t.yellows}e gele kaart${lid === CUP_ID ? ' (beker)' : ''}` }));
      });
      if (red) {
        p.cards.push({ match: m, kind: kind === 'second' ? 'second' : 'red', ban });
        if (ban > 0) {
          const scope = kind === 'direct' && rule.directRed.allCompetitions ? 'all' : lid;
          bans.push({ kind, playerId: pid, matchId: m.id, date: m.date, scope, games: ban, left: ban, served: [], reason: kind === 'second' ? '2x geel' : 'rode kaart' });
        }
      }
    });
  });

  bans.forEach((b) => { const p = players.get(b.playerId); if (p) p.bans.push(b); });
  return { players, reds, coverage };
}

/** Status van een speler voor het volgende duel (of null = geen duel bekend): { banned, edge }. */
export function statusFor(info, next) {
  if (!info) return { banned: null, edge: [] };
  const lid = next && next.league ? next.league.id : null;
  const open = info.bans.filter((b) => b.left > 0);
  const banned = next ? open.find((b) => b.scope === 'all' || b.scope === lid) || null : open[0] || null;
  const edge = [...info.tallies.values()].filter((t) => {
    if (next && t.leagueId !== lid) return false;
    if (next && t.phase === 'regular' && isPlayoffRound(next) && t.rule.playoffs && t.rule.playoffs.resetTally) return false;
    const nt = nextThreshold(t.rule, t.yellows);
    return nt != null && nt - t.yellows === 1;
  });
  return { banned, open, edge };
}

/** Labels voor Selectie: geschorst (elke open schorsing) en op scherp (alleen competitie, niet de beker). */
export function squadTags(info) {
  if (!info) return [];
  const out = [];
  info.bans.filter((b) => b.left > 0).forEach((b) => out.push({ kind: 'ban', text: `geschorst${b.scope === CUP_ID ? ' (beker)' : ''} · ${b.left} ${b.left === 1 ? 'duel' : 'duels'}` }));
  const latest = new Map(); info.tallies.forEach((t) => latest.set(t.leagueId, t)); // nacompetitie vervangt de reguliere telling
  [...latest.values()].filter((t) => t.leagueId !== CUP_ID).forEach((t) => {
    const nt = nextThreshold(t.rule, t.yellows);
    if (nt != null && nt - t.yellows === 1) out.push({ kind: 'edge', text: `op scherp · ${t.yellows} geel` });
  });
  return out;
}
