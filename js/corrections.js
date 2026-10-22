// Correctielaag: jouw aanpassingen bovenop de Highlightly-data.
//
// Elke correctie onthoudt de API-waarde op het moment van aanpassen (`api`),
// jouw waarde (`mine`) en wanneer (`at`). Bij tonen vergelijken we met de huidige API-waarde:
//   active     API is nog hetzelfde als toen → jouw waarde geldt
//   redundant  API is nu gelijk aan jouw waarde → correctie mag weg
//   conflict   API is veranderd, of het event bestaat niet meer → jij beslist
// Tot je beslist, blijft jouw waarde gelden.

import { MAIN_CLUB } from './config.js';
import { manualDetail } from './manual.js';

export const EVENT_FIELDS = {
  goal: [['player', 'schutter'], ['assist', 'assist'], ['minute', 'minuut'], ['extra', 'blessuretijd']],
  yellow: [['player', 'speler'], ['minute', 'minuut'], ['extra', 'blessuretijd']],
  red: [['player', 'speler'], ['minute', 'minuut'], ['extra', 'blessuretijd']],
  sub: [['in', 'speler erin'], ['out', 'speler eruit'], ['minute', 'minuut'], ['extra', 'blessuretijd']],
};

/** Telt dit event als doelpunt? "Goal", "Own Goal" en een benutte "Penalty".
 *  Niet: "Missed Penalty", en VAR-events ("VAR Penalty" = penalty toegekend, de goal zelf komt los). */
export function isGoalType(type) {
  const t = String(type || '').trim();
  if (/missed|var|cancel|disallow/i.test(t)) return false;
  return /goal/i.test(t) || /^penalty( goal| scored)?$/i.test(t);
}

export function kindOf(type) {
  const t = String(type || '');
  if (isGoalType(t)) return 'goal';
  if (/yellow/i.test(t)) return 'yellow';
  if (/red/i.test(t)) return 'red';
  if (/subst/i.test(t)) return 'sub';
  return 'other';
}

export const KIND_LABEL = { goal: 'Goal', yellow: 'Gele kaart', red: 'Rode kaart', sub: 'Wissel', other: 'Event', score: 'Uitslag' };
export const FILTER_OF = { goal: 'goals', yellow: 'kaarten', red: 'kaarten', sub: 'wissels', score: 'uitslag', other: 'overig' };

/**
 * Sleutel van een event: soort, team en volgnummer (de 2e Goal van team X).
 * Bewust zonder speler en minuut: juist die kunnen Highlightly of jij aanpassen.
 * Verdwijnt er bij Highlightly een eerder event, dan schuift het volgnummer en
 * wijkt de waarde af van wat er toen stond: dat wordt een conflict, nooit een stille fout.
 */
export function indexEvents(events) {
  const count = {};
  const map = new Map();
  (events || []).forEach((e) => {
    const base = `${e.type}~${e.teamId ?? ''}`;
    count[base] = (count[base] || 0) + 1;
    map.set(`${base}~${count[base]}`, e);
  });
  return map;
}

export const keyOf = (sig, field) => `ev:${sig}:${field}`;

function parseKey(key) {
  if (key === 'score') return { kind: 'score' };
  const m = key.match(/^ev:(.*):([a-z]+)$/);
  return m ? { kind: 'event', sig: m[1], field: m[2] } : null;
}

const person = (id, name) => (id || name ? { id: id ?? null, name: name || null } : null);

export function fieldValue(e, field) {
  switch (field) {
    case 'player': return person(e.playerId, e.player);
    case 'assist': return person(e.assistId, e.assist);
    case 'in': return person(e.inId, e.inName);
    case 'out': return person(e.outId, e.outName);
    case 'minute': return e.minute ?? null;
    case 'extra': return e.extra ?? null;
    default: return null;
  }
}

export function setField(e, field, v) {
  if (field === 'player') { e.playerId = v ? v.id : null; e.player = v ? v.name : null; }
  if (field === 'assist') { e.assistId = v ? v.id : null; e.assist = v ? v.name : null; }
  if (field === 'in') { e.inId = v ? v.id : null; e.inName = v ? v.name : null; }
  if (field === 'out') { e.outId = v ? v.id : null; e.outName = v ? v.name : null; }
  if (field === 'minute') { e.minute = v; }
  if (field === 'extra') { e.extra = v; }
}

export function same(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === 'object') {
    if ('home' in a) return a.home === b.home && a.away === b.away;
    if (a.id && b.id) return a.id === b.id;
    return (a.name || '') === (b.name || '');
  }
  return a === b;
}

export function display(v, field) {
  if (field === 'extra') return v ? `+${v}` : 'geen';
  if (v === null || v === undefined) return 'geen';
  if (typeof v === 'object' && 'home' in v) return `${v.home}–${v.away}`;
  if (typeof v === 'object') return v.name || '?';
  return typeof v === 'number' ? `${v}'` : String(v);
}

/** API-waarde van een correctiesleutel in de huidige data, of undefined als het event weg is. */
export function apiValue(match, key) {
  const p = parseKey(key);
  if (!p) return undefined;
  if (p.kind === 'score') return match.score || null;
  const ev = indexEvents(match.detail && match.detail.events).get(p.sig);
  return ev ? fieldValue(ev, p.field) : undefined;
}

export function describe(match, key) {
  const p = parseKey(key);
  if (!p) return { kind: 'other', what: key };
  if (p.kind === 'score') return { kind: 'score', what: 'Uitslag' };
  const [type, teamId, nth] = p.sig.split('~');
  const kind = kindOf(type);
  const label = (EVENT_FIELDS[kind] || []).find(([f]) => f === p.field);
  const ev = indexEvents(match.detail && match.detail.events).get(p.sig);
  const when = ev ? `${ev.minute ?? '?'}${ev.extra ? '+' + ev.extra : ''}'` : `#${nth}`;
  const team = [match.homeTeam, match.awayTeam].find((t) => t && String(t.id) === teamId);
  return { kind, field: p.field, what: `${KIND_LABEL[kind]} ${when}${team ? ' ' + team.name : ''} · ${label ? label[1] : p.field}` };
}

/**
 * Past correcties toe. Geeft een kopie van de wedstrijd terug met gecorrigeerde
 * score en events, plus per correctie de status.
 */
export function applyCorrections(match, notes) {
  const corrections = (notes && notes.corrections) || {};
  const out = JSON.parse(JSON.stringify(match));
  const statuses = [];
  const events = out.detail ? out.detail.events : [];
  // _sig onthoudt de API-sleutel, ook nadat we minuut of speler aanpassen.
  const bySig = indexEvents(events);
  bySig.forEach((e, sig) => { e._sig = sig; e._fix = []; });

  Object.entries(corrections).forEach(([key, c]) => {
    const now = apiValue(match, key);
    const p = parseKey(key);
    let status = 'active';
    if (now === undefined) status = 'conflict';
    else if (same(now, c.mine)) status = 'redundant';
    else if (!same(now, c.api)) status = 'conflict';

    if (p && p.kind === 'score') out.score = c.mine;
    if (p && p.kind === 'event' && bySig.has(p.sig)) {
      const ev = bySig.get(p.sig);
      setField(ev, p.field, c.mine);
      ev._fix.push(p.field);
    }
    statuses.push({ key, status, api: c.api, now, mine: c.mine, at: c.at, ...describe(match, key) });
  });

  if (out.detail) out.detail.events.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (a.extra ?? 0) - (b.extra ?? 0));
  out.scoreCorrected = !!corrections.score;
  // Handmatige details gaan voor (zie manual.js); de Highlightly-details blijven bewaard voor de vergelijking.
  if (notes && notes.manual && (notes.manual.starters || []).length) {
    out.apiDetail = out.detail || null;
    out.detail = manualDetail(notes.manual, out, MAIN_CLUB.id);
    out.manualDetail = true;
  }
  return { match: out, statuses };
}

/**
 * Zet nieuwe waarden om naar correctie-wijzigingen voor saveCorrections.
 * Gelijk aan de API → correctie weg. Anders → correctie met de huidige API-waarde.
 */
export function buildChanges(apiMatch, notes, entries) {
  const existing = (notes && notes.corrections) || {};
  const at = new Date().toISOString();
  const changes = {};
  entries.forEach(({ key, value }) => {
    const api = apiValue(apiMatch, key);
    if (api !== undefined && same(api, value)) {
      if (existing[key]) changes[key] = null;
    } else if (!existing[key] || !same(existing[key].mine, value)) {
      changes[key] = { api: api === undefined ? null : api, mine: value, at };
    }
  });
  return changes;
}

/** Aantal correcties en hoeveel daarvan een conflict zijn. */
export function correctionSummary(statuses) {
  return { total: statuses.length, conflicts: statuses.filter((s) => s.status === 'conflict').length };
}

/** Telt goals per team uit de events (eigen goal telt voor de tegenstander). */
export function goalCheck(match) {
  if (!match.detail || !match.score) return null;
  const homeId = match.homeTeam.id;
  let h = 0; let a = 0;
  match.detail.events.forEach((e) => {
    if (kindOf(e.type) !== 'goal') return;
    const own = /own/i.test(e.type);
    const forHome = (e.teamId === homeId) !== own;
    if (forHome) h++; else a++;
  });
  return h === match.score.home && a === match.score.away ? null : { home: h, away: a };
}

// ---------- Typfout-hint ----------

function lev(a, b) {
  const m = a.length; const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[m][n];
}

export function looksLikeTypo(api, mine) {
  if (typeof api === 'number' && typeof mine === 'number') {
    const x = String(api); const y = String(mine);
    return x.length === y.length && x !== y && [...x].sort().join('') === [...y].sort().join('');
  }
  if (api && mine && typeof api === 'object' && api.name && mine.name && !('home' in api)) {
    const d = lev(api.name.toLowerCase(), mine.name.toLowerCase());
    return d > 0 && d <= 2;
  }
  return false;
}
