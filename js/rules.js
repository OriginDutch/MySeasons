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

export const RULES = {
  // Eredivisie
  75672: [{
    from: 2026, to: 2026,
    source: 'KNVB-reglementen 2026/27',
    tiebreak: ['points', 'gd', 'gf', 'h2h'],
    zones: [
      { positions: [1, 1], kind: 'cl', label: 'Champions League' },
      { positions: [2, 2], kind: 'clq', label: 'CL-voorronde' },
      { positions: [3, 3], kind: 'el', label: 'EL-voorronde' },
      { positions: [4, 7], kind: 'po', label: 'Play-offs Conference League' },
      { positions: [16, 16], kind: 'playoff', label: 'Nacompetitie' },
      { positions: [17, 18], kind: 'down', label: 'Degradatie' },
    ],
    note: 'De bekerwinnaar krijgt een Europa League-ticket. Eindigt die bij de eerste drie, dan schuiven de tickets door en worden de play-offs 5 t/m 8. Eindigt die op 4 t/m 7, dan doet nummer 8 mee aan de play-offs.',
  }],
  // Eerste Divisie (Keuken Kampioen Divisie)
  76523: [{
    from: 2026, to: 2026,
    source: 'KNVB-reglementen 2026/27',
    tiebreak: ['points', 'gd', 'gf', 'h2h'],
    eligible: 'firstTeams', // beloftenteams kunnen niet promoveren en geen nacompetitie spelen
    direct: { count: 2, kind: 'up', label: 'Promotie' },
    periods: [
      { key: 'P1', rounds: [1, 10] },
      { key: 'P2', rounds: [11, 19] },
      { key: 'P3', rounds: [21, 28] },
      { key: 'P4', rounds: [29, 38] },
    ],
    periodTiebreak: ['points', 'gd', 'gf'], // geen onderling resultaat; daarna strafpunten, dan een beslissingswedstrijd
    playoff: { fillTo: 6, kind: 'playoff', label: 'Nacompetitie', excludeLast: true },
    note: 'Periodewinnaars plaatsen zich voor de nacompetitie. Is de winnaar al geplaatst of een beloftenteam, dan gaat de plek naar nummer 2 van die periode, anders naar de hoogste in de stand zonder periodetitel. Een periodewinnaar die direct promoveert, geeft zijn plek ook door aan de stand.',
  }],
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
export function periodTable(matches, period, teams, tiebreak, prefer) {
  const [from, to] = period.rounds;
  const inP = matches.filter((m) => { const n = roundNumber(m.round); return n != null && n >= from && n <= to && /regular/i.test(m.round || 'regular'); });
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
  const complete = inP.length > 0 && finished === inP.length && finished >= expected;
  return { ...period, rows: ranked, finished, total: Math.max(inP.length, expected), started, complete };
}

/**
 * Alle periodes met winnaar (titel) en wie de nacompetitieplek krijgt (art. 6 en 8).
 * holder.via: 'winst' | 'nr2' | 'ranglijst' (plek gaat naar de stand, pas bij het einde bekend).
 */
export function resolvePeriods(rules, matches, teams) {
  if (!rules || !rules.periods) return [];
  const qualified = new Set();
  return rules.periods.map((p) => {
    const t = periodTable(matches, p, teams, rules.periodTiebreak || ['points', 'gd', 'gf'], (r) => !qualified.has(String(r.team.id)));
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

// ---------- Zones ----------

/**
 * Zone per team voor een (berekende of echte) stand.
 * rows: gerangschikte rijen met .position. Geeft Map(teamId → { kind, label, tag }) en de legenda.
 */
export function zonesFor(rules, rows, { matches = [], final = false } = {}) {
  const map = new Map();
  if (!rules) return { map, legend: [], periods: [] };
  const firstTeams = rules.eligible === 'firstTeams' ? rows.filter((r) => !isJong(r.team)) : rows;
  const legend = [];
  const set = (r, z) => { if (!map.has(String(r.team.id))) map.set(String(r.team.id), z); };

  (rules.zones || []).forEach((z) => {
    const [a, b] = z.positions;
    rows.filter((r) => r.position >= a && r.position <= b).forEach((r) => set(r, { kind: z.kind, label: z.label }));
    legend.push({ kind: z.kind, label: z.label });
  });

  let periods = [];
  if (rules.direct) {
    const up = firstTeams.slice(0, rules.direct.count);
    up.forEach((r) => set(r, { kind: rules.direct.kind, label: rules.direct.label }));
    legend.push({ kind: rules.direct.kind, label: rules.direct.label });
    if (rules.playoff) {
      periods = resolvePeriods(rules, matches, rows.map((r) => r.team));
      const upIds = new Set(up.map((r) => String(r.team.id)));
      const last = rows[rows.length - 1];
      const seats = [];
      periods.forEach((p) => {
        if (p.state !== 'done' || !p.holder) return;
        const id = String(p.holder.id);
        if (upIds.has(id)) return; // art. 9: plek naar de stand
        if (rules.playoff.excludeLast && last && String(last.team.id) === id) return; // art. 7
        seats.push({ id, tag: p.key });
      });
      const taken = new Set(seats.map((s) => s.id));
      for (const r of firstTeams) {
        if (seats.length >= rules.playoff.fillTo) break;
        const id = String(r.team.id);
        if (upIds.has(id) || taken.has(id)) continue;
        seats.push({ id, tag: null }); taken.add(id);
      }
      seats.forEach((s) => { if (!map.has(s.id)) map.set(s.id, { kind: rules.playoff.kind, label: rules.playoff.label, tag: s.tag }); });
      legend.push({ kind: rules.playoff.kind, label: rules.playoff.label });
    }
  }
  rows.forEach((r) => { if (rules.eligible === 'firstTeams' && isJong(r.team) && !map.has(String(r.team.id))) map.set(String(r.team.id), { kind: 'jong', label: 'Beloftenteam', tag: null }); });
  return { map, legend, periods, provisional: !final };
}

/**
 * Nacompetitie KKD als het nu zou eindigen: fictieve ranglijst ED1..ED6 op de reguliere stand (art. 2),
 * A: ED6–ED1, B: ED5–ED2, C: ED4–ED3, halve finales D: A–B en E: Eredivisie-16 – C, finale E–D.
 */
export function playoffBracket(rules, rows, zones) {
  if (!rules || !rules.playoff) return null;
  const seeds = rows.filter((r) => { const z = zones.map.get(String(r.team.id)); return z && z.kind === rules.playoff.kind; }).slice(0, 6);
  if (seeds.length < 6) return null;
  const ed = (n) => seeds[n - 1].team;
  return {
    seeds: seeds.map((r) => r.team),
    first: [{ key: 'A', home: ed(6), away: ed(1) }, { key: 'B', home: ed(5), away: ed(2) }, { key: 'C', home: ed(4), away: ed(3) }],
  };
}
