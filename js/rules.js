// Competitieregels als data: wie promoveert, wie gaat naar Europa, wie speelt nacompetitie.
// Eén regelset per competitie per seizoen(sreeks). Nieuwe competitie = nieuwe regelset, geen nieuwe code.
//
// Bouwstenen:
//   positions  vaste plekken in de stand (1, 2-3, 17-18), geteld onder de toegestane teams
//   direct     de eerste N toegestane teams (bijv. promotie in de KKD)
//   periods    periodestanden op speelronden, met de periodewinnaars
//   fillTo     aanvullen tot N deelnemers met de hoogst geklasseerde teams die er nog niet bij zijn
//   eligible   wie mag meedoen aan promotie/nacompetitie (geen beloftenteams)
//   tiebreak   volgorde bij gelijke punten
//
// Bronnen 2026-27: KNVB Promotie- en degradatieregeling, Reglement periodekampioenschappen eerste divisie,
// Reglement play-off promotie/degradatie en Reglement play-off Europees ticket (alle seizoen 2026/'27).

import { roundNumber } from './season.js';

const JONG = /^jong\s/i;
export const isJong = (team) => JONG.test((team && team.name) || '');

// ---------- Eredivisie ----------
// Europa als "ladder": tickets op volgorde van waarde voor plek 1, 2, 3...; het bekerticket staat op
// plek `cupRank` in die ladder; daarna 4 clubs in de play-offs om één Conference League-ticket.
// Bekerwinnaar al hoger geplaatst → de tickets schuiven één plek door. Anders neemt hij het bekerticket
// en schuift iedereen onder hem op (KNVB Reglement play-off Europees ticket, art. 2).
const T = {
  cl: { kind: 'cl', label: 'Champions League' },
  clq: { kind: 'clq', label: 'CL-voorronde' },
  el: { kind: 'el', label: 'Europa League' },
  elq: { kind: 'elq', label: 'EL-voorronde' },
  eclq: { kind: 'eclq', label: 'Conference League-voorronde' },
};
const ED_BOTTOM = [
  { positions: [16, 16], kind: 'playoff', label: 'Nacompetitie' },
  { positions: [17, 18], kind: 'down', label: 'Degradatie' },
];
const ED_NOTE = 'De bekerwinnaar krijgt een Europa League-ticket. Staat die al hoger, dan schuiven de tickets een plek door; anders doet de eerstvolgende club mee aan de play-offs.';
const ed = (from, to, ladder, cupRank, source) => ({
  from, to, source,
  tiebreak: ['points', 'gd', 'gf', 'h2h'],
  europe: { ladder, cupRank, cup: { ...T.el, label: 'Europa League (beker)' }, playoff: { count: 4, kind: 'po', label: 'Play-offs Conference League' } },
  zones: ED_BOTTOM,
  cup: { leagueId: 77374 },
  note: ED_NOTE,
});

const KKD_NOTE = 'Periodewinnaars plaatsen zich voor de nacompetitie. Is de winnaar al geplaatst of een beloftenteam, dan gaat de plek naar nummer 2 van die periode, anders naar de hoogste in de stand zonder periodetitel. Een periodewinnaar die direct promoveert, geeft zijn plek ook door aan de stand.';
const kkd = (from, to, periods, bracket, source) => ({
  from, to, source,
  tiebreak: ['points', 'gd', 'gf', 'h2h'],
  eligible: 'firstTeams', // beloftenteams kunnen niet promoveren en geen nacompetitie spelen
  direct: { count: 2, kind: 'up', label: 'Promotie' },
  periods: periods.map((r, i) => ({ key: `P${i + 1}`, rounds: r })),
  periodTiebreak: ['points', 'gd', 'gf'], // geen onderling resultaat; daarna strafpunten, dan een beslissingswedstrijd
  playoff: { fillTo: 6, kind: 'playoff', label: 'Nacompetitie', excludeLast: true, bracket },
  note: KKD_NOTE,
});

export const RULES = {
  75672: [
    // 2019-20: afgebroken (zie SPECIAL_SEASONS), geen zones.
    // 2020-21 t/m 2022-23: bekerwinnaar EL (play-offronde), nr. 3 Conference League-voorronde.
    ed(2020, 2022, [T.cl, T.clq, T.eclq], 2, 'Wikipedia-seizoensartikelen Eredivisie 2020-21 t/m 2022-23'),
    // 2023-24 t/m 2025-26 (nieuw UEFA-format): nr. 1-2 CL hoofdtoernooi, nr. 3 CL-voorronde, nr. 4 EL-voorronde.
    ed(2023, 2025, [T.cl, T.cl, T.clq, T.elq], 3, 'Wikipedia-seizoensartikelen Eredivisie 2023-24 t/m 2025-26'),
    // 2026-27: Nederland een plek minder: nr. 1 CL, nr. 2 CL-voorronde, nr. 3 EL-voorronde.
    ed(2026, 2026, [T.cl, T.clq, T.elq], 2, 'KNVB Reglement play-off Europees ticket 2026/27'),
  ],
  // Eerste Divisie (Keuken Kampioen Divisie). Format per seizoen gelijk, behalve de periodegrenzen en het
  // nacompetitieschema. Periodegrenzen 2020-2025 volgens RSSSF/Wikipedia, 2025-26 en 2026-27 volgens de KNVB.
  76523: [
    kkd(2020, 2021, [[1, 9], [10, 19], [20, 28], [29, 38]], 'six-ed16-semi', 'RSSSF ned2021-ned2022, Wikipedia'),
    kkd(2022, 2022, [[1, 10], [11, 19], [20, 28], [29, 38]], 'six-ed16-semi', 'RSSSF ned2023, Wikipedia'),
    kkd(2023, 2024, [[1, 9], [10, 19], [20, 29], [30, 38]], 'six-ed16-semi', 'RSSSF ned2024-ned2025, Wikipedia'),
    kkd(2025, 2025, [[1, 10], [11, 20], [21, 29], [30, 38]], 'six-ed16-final', 'KNVB Reglement periodekampioenschappen 2025/26'),
    kkd(2026, 2026, [[1, 10], [11, 19], [21, 28], [29, 38]], 'six-ed16-semi', 'KNVB-reglementen 2026/27'),
  ],
};

/** Seizoenen met een bijzonderheid, voor alle competities. */
export const SPECIAL_SEASONS = {
  2019: { status: 'afgebroken', note: 'Seizoen 2019-20 is in april 2020 afgebroken vanwege corona: geen kampioen, geen promotie en geen degradatie.' },
};

export function rulesFor(leagueId, season) {
  const sets = RULES[leagueId] || [];
  return sets.find((r) => season >= r.from && (r.to == null || season <= r.to)) || null;
}

// ---------- Rangschikken ----------

const gdOf = (l) => l.gf - l.ga;

/** Onderling resultaat: mini-stand tussen de gelijk geëindigde teams (punten, doelsaldo, doelpunten). */
function h2hScores(ids, matches) {
  const set = new Set(ids.map(String));
  const s = new Map(ids.map((id) => [String(id), { pts: 0, gf: 0, ga: 0 }]));
  matches.forEach((m) => {
    if (m.status !== 'finished' || !m.score || m.score.home == null) return;
    const h = String(m.homeTeam.id); const a = String(m.awayTeam.id);
    if (!set.has(h) || !set.has(a)) return;
    const H = s.get(h); const A = s.get(a);
    H.gf += m.score.home; H.ga += m.score.away; A.gf += m.score.away; A.ga += m.score.home;
    if (m.score.home > m.score.away) H.pts += 3; else if (m.score.home < m.score.away) A.pts += 3; else { H.pts++; A.pts++; }
  });
  return s;
}

/**
 * Sorteert standrijen { team, points, total:{gf,ga} } volgens de tiebreak van de regelset.
 * prefer(row) => true geeft voorrang bij volledig gelijk (art. 8.7: wie nog geen periodekampioen is).
 */
export function rankRows(rows, { tiebreak = ['points', 'gd', 'gf'], matches = [], prefer = null } = {}) {
  const base = (a, b) => {
    for (const k of tiebreak) {
      if (k === 'points' && b.points !== a.points) return b.points - a.points;
      if (k === 'gd' && gdOf(b.total) !== gdOf(a.total)) return gdOf(b.total) - gdOf(a.total);
      if (k === 'gf' && b.total.gf !== a.total.gf) return b.total.gf - a.total.gf;
    }
    return 0;
  };
  const sorted = rows.slice().sort((a, b) => base(a, b) || a.team.name.localeCompare(b.team.name));
  // Groepen die op alles gelijk staan: onderling resultaat en/of voorkeur.
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && base(sorted[i], sorted[j]) === 0) j++;
    let group = sorted.slice(i, j);
    if (group.length > 1) {
      const h = tiebreak.includes('h2h') && matches.length ? h2hScores(group.map((r) => r.team.id), matches) : null;
      group = group.sort((a, b) => {
        if (h) {
          const A = h.get(String(a.team.id)); const B = h.get(String(b.team.id));
          if (B.pts !== A.pts) return B.pts - A.pts;
          if ((B.gf - B.ga) !== (A.gf - A.ga)) return (B.gf - B.ga) - (A.gf - A.ga);
          if (B.gf !== A.gf) return B.gf - A.gf;
        }
        if (prefer) { const pa = prefer(a) ? 1 : 0; const pb = prefer(b) ? 1 : 0; if (pa !== pb) return pb - pa; }
        return a.team.name.localeCompare(b.team.name);
      });
      group.forEach((r) => { r.tied = true; });
    }
    out.push(...group);
    i = j;
  }
  out.forEach((r, k) => { r.position = k + 1; });
  return out;
}

// ---------- Periodes ----------

const blank = () => ({ played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
function add(line, gf, ga) { line.played++; line.gf += gf; line.ga += ga; if (gf > ga) line.w++; else if (gf < ga) line.l++; else line.d++; }

/** Stand over een reeks speelronden. Uitgestelde duels tellen mee in hun oorspronkelijke ronde (art. 2). */
export function periodTable(matches, period, teams, tiebreak, prefer, { final = false } = {}) {
  const [from, to] = period.rounds;
  const raw = matches.filter((m) => { const n = roundNumber(m.round); return n != null && n >= from && n <= to && /regular/i.test(m.round || 'regular'); });
  // Dubbele duels (een uitgestelde kopie naast de echt gespeelde) maar één keer: de gespeelde wint.
  const byPair = new Map();
  raw.forEach((m) => {
    const k = `${m.homeTeam && m.homeTeam.id}-${m.awayTeam && m.awayTeam.id}-${roundNumber(m.round)}`;
    const prev = byPair.get(k);
    if (!prev || (prev.status !== 'finished' && m.status === 'finished')) byPair.set(k, m);
  });
  const inP = [...byPair.values()];
  const rows = new Map(teams.map((t) => [String(t.id), { team: t, total: blank(), points: 0 }]));
  const row = (t) => { const k = String(t.id); if (!rows.has(k)) rows.set(k, { team: t, total: blank(), points: 0 }); return rows.get(k); };
  let finished = 0;
  inP.forEach((m) => {
    if (m.status !== 'finished' || !m.score || m.score.home == null) return;
    finished++;
    add(row(m.homeTeam).total, m.score.home, m.score.away);
    add(row(m.awayTeam).total, m.score.away, m.score.home);
  });
  rows.forEach((r) => { r.points = r.total.w * 3 + r.total.d; });
  const ranked = rankRows([...rows.values()], { tiebreak, prefer });
  const expected = Math.floor(rows.size / 2) * (to - from + 1);
  const started = finished > 0;
  // Afgelopen seizoen: compleet zodra alle verwachte duels gespeeld zijn (losse spookduels in de data tellen niet).
  const complete = inP.length > 0 && finished >= expected && (final || finished === inP.length);
  return { ...period, rows: ranked, finished, total: Math.max(inP.length, expected), started, complete };
}

/**
 * Alle periodes met winnaar (titel) en wie de nacompetitieplek krijgt (art. 6 en 8).
 * holder.via: 'winst' | 'nr2' | 'ranglijst' (plek gaat naar de stand, pas bij het einde bekend).
 */
export function resolvePeriods(rules, matches, teams, { final = false } = {}) {
  if (!rules || !rules.periods) return [];
  const qualified = new Set();
  return rules.periods.map((p) => {
    const t = periodTable(matches, p, teams, rules.periodTiebreak || ['points', 'gd', 'gf'], (r) => !qualified.has(String(r.team.id)), { final });
    if (!t.complete) {
      const leader = t.started ? t.rows[0] : null;
      return { ...t, state: t.started ? 'running' : 'open', leader };
    }
    const n1 = t.rows[0]; const n2 = t.rows[1];
    const ok = (r) => r && !isJong(r.team) && !qualified.has(String(r.team.id));
    let holder = null; let via = 'ranglijst';
    if (ok(n1)) { holder = n1.team; via = 'winst'; } else if (ok(n2)) { holder = n2.team; via = 'nr2'; }
    if (holder) qualified.add(String(holder.id));
    return { ...t, state: 'done', winner: n1.team, holder, via };
  });
}

// ---------- Bekerwinnaar ----------

/** Winnaar van de bekerfinale uit een lijst bekerwedstrijden (Highlightly), of null als die nog niet gespeeld is. */
export function cupWinner(matches) {
  const finals = (matches || []).filter((m) => /\bfinal\b/i.test(m.round || '') && !/semi|quarter|1\/\d|round of/i.test(m.round || '') && m.status === 'finished' && m.score);
  const f = finals.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!f) return null;
  const { home, away } = f.score;
  let winHome = home > away ? true : home < away ? false : null;
  if (winHome === null && f.penalties) winHome = f.penalties.home > f.penalties.away ? true : f.penalties.home < f.penalties.away ? false : null;
  if (winHome === null) return null;
  return { team: winHome ? f.homeTeam : f.awayTeam, match: f };
}

/**
 * Europese tickets op de stand. winner = bekerwinnaar ({ id }) of null (nog niet bekend).
 * Geeft Map(teamId → zone) voor de bovenkant van de stand.
 */
export function europeZones(eu, rows, winner) {
  const out = new Map();
  if (!eu) return out;
  const sorted = rows.slice().sort((a, b) => a.position - b.position);
  const po = Array.from({ length: eu.playoff.count }, () => ({ kind: eu.playoff.kind, label: eu.playoff.label }));
  const wRow = winner ? sorted.find((r) => String(r.team.id) === String(winner.id)) : null;
  const wIdx = wRow ? sorted.indexOf(wRow) : -1;
  let tickets; let skip = null;
  if (!winner) tickets = [...eu.ladder, ...po]; // nog geen bekerwinnaar: alleen de ladder
  else if (wIdx >= 0 && wIdx < eu.cupRank) tickets = [...eu.ladder.slice(0, eu.cupRank), { ...eu.cup, label: 'Europa League (via beker)' }, ...eu.ladder.slice(eu.cupRank), ...po];
  else {
    tickets = [...eu.ladder, ...po];
    if (wRow) { out.set(String(wRow.team.id), eu.cup); skip = String(wRow.team.id); }
  }
  let i = 0;
  for (const r of sorted) {
    if (i >= tickets.length) break;
    if (String(r.team.id) === skip) continue;
    out.set(String(r.team.id), tickets[i++]);
  }
  return out;
}

/** Bekerwinnaar uit de RSSSF-seizoenspagina (finale), gekoppeld aan een team uit de stand. */
export function cupWinnerRsssf(rs, rows) {
  const f = rs && rs.cup && (rs.cup.matches || []).filter((m) => /^final$/i.test(m.label || '') && m.status === 'played').pop();
  if (!f) return null;
  let homeWins = f.hs > f.as ? true : f.hs < f.as ? false : null;
  if (homeWins === null && f.penalties) homeWins = f.penalties.home > f.penalties.away;
  if (homeWins === null) return null;
  const name = homeWins ? f.home : f.away;
  const key = (n) => String(n || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w && !['fc', 'sc', 'sv', 'afc', 'bv'].includes(w)).join(' ');
  const nm = (r) => key(r.team.rsName || r.team.name);
  const row = rows.find((r) => nm(r) === key(name)) || rows.find((r) => nm(r).includes(key(name)) || key(name).includes(nm(r)));
  return { team: row ? row.team : { id: `rs:${name}`, name }, source: 'rsssf' };
}

// ---------- Zones ----------

/**
 * Zone per team voor een (berekende of echte) stand.
 * rows: gerangschikte rijen met .position. Geeft Map(teamId → { kind, label, tag }) en de legenda.
 */
export function zonesFor(rules, rows, { matches = [], final = false, cup = null } = {}) {
  const map = new Map();
  if (!rules) return { map, legend: [], periods: [] };
  const firstTeams = rules.eligible === 'firstTeams' ? rows.filter((r) => !isJong(r.team)) : rows;
  const legend = [];
  const set = (r, z) => { if (!map.has(String(r.team.id))) map.set(String(r.team.id), z); };

  if (rules.europe) {
    const eu = europeZones(rules.europe, rows, cup && cup.team);
    eu.forEach((z, id) => map.set(id, { kind: z.kind, label: z.label }));
    // Legenda in volgorde van de stand, zonder dubbele.
    rows.slice().sort((a, b) => a.position - b.position).forEach((r) => {
      const z = eu.get(String(r.team.id));
      if (z && !legend.some((l) => l.label === z.label)) legend.push({ kind: z.kind, label: z.label });
    });
  }
  (rules.zones || []).forEach((z) => {
    const [a, b] = z.positions;
    rows.filter((r) => r.position >= a && r.position <= b).forEach((r) => set(r, { kind: z.kind, label: z.label }));
    if (!legend.some((l) => l.kind === z.kind)) legend.push({ kind: z.kind, label: z.label });
  });

  let periods = [];
  if (rules.direct) {
    const up = firstTeams.slice(0, rules.direct.count);
    up.forEach((r) => set(r, { kind: rules.direct.kind, label: rules.direct.label }));
    legend.push({ kind: rules.direct.kind, label: rules.direct.label });
    if (rules.playoff) {
      periods = resolvePeriods(rules, matches, rows.map((r) => r.team), { final });
      const upIds = new Set(up.map((r) => String(r.team.id)));
      const last = rows[rows.length - 1];
      const seats = [];
      periods.forEach((p) => {
        if (p.state !== 'done' || !p.holder) return;
        const id = String(p.holder.id);
        if (upIds.has(id)) return; // art. 9: plek naar de stand
        if (rules.playoff.excludeLast && last && String(last.team.id) === id) return; // art. 7
        seats.push({ id, tag: p.key, via: p.via });
      });
      const taken = new Set(seats.map((s) => s.id));
      for (const r of firstTeams) {
        if (seats.length >= rules.playoff.fillTo) break;
        const id = String(r.team.id);
        if (upIds.has(id) || taken.has(id)) continue;
        seats.push({ id, tag: null }); taken.add(id);
      }
      seats.forEach((s) => { if (!map.has(s.id)) map.set(s.id, { kind: rules.playoff.kind, label: rules.playoff.label, tag: s.tag, via: s.via }); });
      legend.push({ kind: rules.playoff.kind, label: rules.playoff.label });
    }
  }
  rows.forEach((r) => { if (rules.eligible === 'firstTeams' && isJong(r.team) && !map.has(String(r.team.id))) map.set(String(r.team.id), { kind: 'jong', label: 'Beloftenteam', tag: null }); });
  // Elke echte periodekampioen een label, ook als hij al rechtstreeks promoveert of meerdere periodes won.
  const periodTags = new Map();
  periods.forEach((p) => { if (p.state === 'done' && p.winner) { const k = String(p.winner.id); periodTags.set(k, [...(periodTags.get(k) || []), p.key]); } });
  return { map, legend, periods, periodTags, provisional: !final, cup };
}

/**
 * Nacompetitie KKD: fictieve ranglijst E1..E6 op de reguliere stand.
 * 'six-ed16-semi' (t/m 2024-25 en vanaf 2026-27): A E6–E1, B E5–E2, C E4–E3; halve finales A–B en Eredivisie-16 – C; finale.
 * 'six-ed16-final' (2025-26): ronde 1 E6–E3 en E5–E4; ronde 2 met E2 en E1; ronde 3; finale tegen Eredivisie-16.
 */
export function playoffBracket(rules, rows, zones) {
  if (!rules || !rules.playoff) return null;
  const seeds = rows.filter((r) => { const z = zones.map.get(String(r.team.id)); return z && z.kind === rules.playoff.kind; }).slice(0, 6);
  if (seeds.length < 6) return null;
  const e = (n) => seeds[n - 1].team;
  if (rules.playoff.bracket === 'six-ed16-final') {
    return {
      format: rules.playoff.bracket, seeds: seeds.map((r) => r.team),
      first: [{ key: 'A', home: e(6), away: e(3) }, { key: 'B', home: e(5), away: e(4) }],
      later: [['C', `Winnaar A – ${e(2).name}`], ['D', `Winnaar B – ${e(1).name}`], ['E', 'Winnaar C – winnaar D'], ['F', 'Finale: nr. 16 Eredivisie – winnaar E, om een plek in de Eredivisie']],
    };
  }
  return {
    format: 'six-ed16-semi', seeds: seeds.map((r) => r.team),
    first: [{ key: 'A', home: e(6), away: e(1) }, { key: 'B', home: e(5), away: e(2) }, { key: 'C', home: e(4), away: e(3) }],
    later: [['D', 'Winnaar A – winnaar B'], ['E', 'Nr. 16 Eredivisie – winnaar C'], ['F', 'Finale: winnaar E – winnaar D, om een plek in de Eredivisie']],
  };
}

/** RSSSF-uitslagen in de vorm van Highlightly-wedstrijden (voor periodes van oude seizoenen). */
export function rsssfAsMatches(division, idOf) {
  return ((division && division.matches) || []).filter((m) => m.stage === 'regular' && m.round).map((m, i) => {
    const h = String(m.homeFull || m.home).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    const a = String(m.awayFull || m.away).replace(/\s*\(.*?\)\s*/g, ' ').trim();
    return {
      id: `rs${i}`, date: m.date, round: `Regular Season - ${m.round}`,
      status: m.status === 'played' ? 'finished' : m.status,
      score: m.hs != null ? { home: m.hs, away: m.as } : null,
      homeTeam: { id: idOf(h), name: h }, awayTeam: { id: idOf(a), name: a },
    };
  });
}
