// Divisiestatistieken: Stats → tabs Spelers en Clubs, per competitie en seizoen.
// Bron: de events van alle competitieduels (nachtploeg, 1 call per duel) en voor Cambuur de volledige details.
// Keepers: de basiskeeper uit de opstelling (nachtploeg of de knop, 1 call per duel); een clean sheet telt als
// zijn club niets tegenkreeg en hij niet gewisseld werd.
// Gelijke stand = gedeelde rang (1, 1, 1, 4). Binnen een gelijke stand: goals → minder penalty's eerst,
// keepers → minder duels eerst, de rest alfabetisch. Valt de grens van de top 10 midden in een gelijke stand,
// dan "+n anderen met x", de rest onder "Toon alles".

import { esc, toast } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getLeagueMatches, getSeasonMatches, saveLeagueExtra, addToLeagueIndex, countCalls } from './store.js';
import { hl } from './api.js';
import { normalizeLineups } from './normalize.js';

const TEAM = MAIN_CLUB.id;
const GOAL = /^(goal|penalty)$/i;
const PEN = /^penalty$/i;
const YELLOW = /^yellow card$/i;
const RED = /^(red card|yellow red card|second yellow card)$/i;
const TOP = 10;

const gkOf = (side) => {
  if (!side) return null;
  const p = (side.starters || []).find((x) => /goalkeeper/i.test(x.position || '')) || (side.starters || []).find((x) => x.line === 0);
  return p ? { id: p.id, name: p.name, teamId: side.teamId } : null;
};

/** Alle gespeelde duels van deze competitie en dit seizoen, met events en keepers waar bekend. */
async function collect(leagueId, season) {
  const [lm, own] = await Promise.all([getLeagueMatches(leagueId, season).catch(() => []), getSeasonMatches(season).catch(() => [])]);
  const map = new Map();
  lm.forEach((m) => map.set(String(m.id), m));
  own.filter((m) => m.league && Number(m.league.id) === Number(leagueId)).forEach((m) => map.set(String(m.id), { ...(map.get(String(m.id)) || {}), ...m, own: true }));
  return [...map.values()].filter((m) => m.status === 'finished' && m.score && m.homeTeam && m.awayTeam).map((m) => {
    const d = m.own ? m.detail : null;
    const events = d ? d.events || [] : Array.isArray(m.events) ? m.events : null;
    let keepers = null; let subsOut = [];
    if (d && d.lineups && ((d.lineups.home && d.lineups.home.starters || []).length)) {
      keepers = { home: gkOf(d.lineups.home), away: gkOf(d.lineups.away) };
      subsOut = (d.events || []).filter((e) => /subst/i.test(e.type || '') && e.outId != null).map((e) => e.outId);
    } else if (!m.own && m.keepers !== undefined) {
      keepers = m.keepers || { home: null, away: null };
      subsOut = m.subsOut || [];
    }
    // Speelminuten: Cambuur uit de details, andere duels uit het compacte 'mins' (nachtploeg, volledig verloop).
    let mins = null;
    if (d && d.players && Object.keys(d.players).length) {
      const st = new Set(['home', 'away'].flatMap((k) => (d.lineups && d.lineups[k] ? d.lineups[k].starters : []).map((x) => x.id)));
      mins = Object.entries(d.players).flatMap(([tid, list]) => (list || []).filter((x) => x.minutes > 0).map((x) => [x.id, Number(tid), x.minutes, st.has(x.id) || !x.sub ? 1 : 0, x.name]));
    } else if (!m.own && Array.isArray(m.mins)) mins = m.mins;
    return { m, events, keepers, subsOut, mins, missingLineup: !m.own && m.keepers === undefined };
  });
}

function aggregate(rows) {
  const players = new Map(); const clubs = new Map();
  const club = (t) => { if (!clubs.has(t.id)) clubs.set(t.id, { id: t.id, name: t.name, played: 0, cs: 0, yellow: 0, red: 0, withEvents: 0 }); return clubs.get(t.id); };
  const player = (id, name, teamId, date) => {
    if (!players.has(id)) players.set(id, { id, name: name || '?', teamId, date: 0, goals: 0, pens: 0, assists: 0, yellow: 0, red: 0, apps: 0, cs: 0, minutes: 0, played: 0, starts: 0 });
    const p = players.get(id);
    if (name && name.length > (p.name || '').length) p.name = name; // voluit wint van "S. Haugen"
    if (teamId && date >= p.date) { p.teamId = teamId; p.date = date; }
    return p;
  };
  let withEvents = 0; let goals = 0; let withAssist = 0; let withKeepers = 0; let withMins = 0;
  rows.forEach(({ m, events, keepers, subsOut, mins }) => {
    const date = Date.parse(m.date) || 0;
    const h = club(m.homeTeam); const a = club(m.awayTeam);
    h.played++; a.played++;
    if (m.score.away === 0) h.cs++;
    if (m.score.home === 0) a.cs++;
    if (events) {
      withEvents++; h.withEvents++; a.withEvents++;
      events.forEach((e) => {
        if (e.shootout) return; // strafschoppenserie telt niet
        const t = e.type || '';
        const c = e.teamId === m.homeTeam.id ? h : e.teamId === m.awayTeam.id ? a : null;
        if (GOAL.test(t)) {
          goals++;
          if (e.playerId != null) { const p = player(e.playerId, e.player, e.teamId, date); p.goals++; if (PEN.test(t)) p.pens++; }
          if (e.assistId != null) { withAssist++; player(e.assistId, e.assist, e.teamId, date).assists++; }
        } else if (YELLOW.test(t)) {
          if (c) c.yellow++;
          if (e.playerId != null) player(e.playerId, e.player, e.teamId, date).yellow++;
        } else if (RED.test(t)) {
          if (c) c.red++;
          if (e.playerId != null) player(e.playerId, e.player, e.teamId, date).red++;
        }
      });
    }
    if (mins) {
      withMins++;
      mins.forEach(([id, teamId, min, start, name]) => { const p = player(id, name, teamId, date); p.minutes += min; p.played++; if (start) p.starts++; });
    }
    if (keepers) {
      withKeepers++;
      [['home', m.homeTeam, m.score.away], ['away', m.awayTeam, m.score.home]].forEach(([side, team, against]) => {
        const k = keepers[side];
        if (!k || k.id == null) return;
        const p = player(k.id, k.name, team.id, date);
        p.apps++;
        if (against === 0 && !(subsOut || []).includes(k.id)) p.cs++;
      });
    }
  });
  const teamName = new Map([...clubs.values()].map((c) => [c.id, c.name]));
  // Highlightly heeft soms twee id's voor dezelfde speler ("Jean-Paul N'djoli" en "N'Djoli"): samenvoegen bij
  // dezelfde naam (zonder hoofdletters en accenten) bij dezelfde club.
  const norm = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const merged = new Map();
  [...players.values()].forEach((p) => {
    const k = `${p.teamId}|${norm(p.name)}`;
    const q = merged.get(k);
    if (!q) { merged.set(k, p); return; }
    ['goals', 'pens', 'assists', 'yellow', 'red', 'apps', 'cs', 'minutes', 'played', 'starts'].forEach((f) => { q[f] += p[f]; });
  });
  const list = [...merged.values()];
  list.forEach((p) => { p.club = teamName.get(p.teamId) || ''; });
  return { players: list, clubs: [...clubs.values()], total: rows.length, withEvents, goals, withAssist, withKeepers, withMins, missing: rows.filter((r) => r.missingLineup).map((r) => r.m) };
}

/** Gedeelde rang: 1 + het aantal met een hogere waarde. */
function ranked(list, val, tie = (a, b) => (a.name || '').localeCompare(b.name || '', 'nl')) {
  const s = list.filter((x) => val(x) > 0).sort((a, b) => val(b) - val(a) || tie(a, b));
  return s.map((x) => ({ x, v: val(x), rank: 1 + s.filter((y) => val(y) > val(x)).length }));
}

function rowHtml({ x, v, rank }, sub, unit, fmt = (n) => n) {
  const us = x.teamId === TEAM || x.id === TEAM;
  return `<div class="ls-row${us ? ' is-us' : ''}"><span class="ls-rank mono">${rank}</span><span class="ls-name">${esc(x.name || '?')}${sub ? `<small>${sub}</small>` : ''}</span><b class="ls-val">${fmt(v)}${unit || ''}</b></div>`;
}

/** Top 10 met gedeelde rang; "+n anderen met x" als de grens midden in een gelijke stand valt; de rest uitklapbaar. */
function board(label, list, { sub = () => '', note = '', unit = '', fmt = (n) => n } = {}) {
  if (!list.length) return `<section class="section"><div class="section__label"><span>${label}</span><span></span></div><p class="muted" style="margin:0;font-size:var(--fs-sm)">Nog niets.</p>${note}</section>`;
  let shown = list.filter((r) => r.rank <= TOP);
  let extra = '';
  if (shown.length > TOP) {
    const cutV = list[TOP - 1].v; // waarde op plek 10
    const keep = shown.filter((r) => r.v > cutV);
    const group = list.filter((r) => r.v === cutV);
    if (keep.length) { shown = keep; extra = `<p class="ls-plus muted">+${group.length} ${group.length === 1 ? 'ander' : 'anderen'} met ${fmt(cutV)}${unit}</p>`; }
    else { shown = group.slice(0, TOP); extra = `<p class="ls-plus muted">+${group.length - TOP} anderen met ${fmt(cutV)}${unit}</p>`; }
  }
  const rest = list.slice(shown.length);
  return `<section class="section"><div class="section__label"><span>${label}</span><span>top ${TOP}</span></div>
    <div class="ls-list">${shown.map((r) => rowHtml(r, sub(r.x), unit, fmt)).join('')}</div>${extra}
    ${rest.length ? `<details class="ls-more"><summary>Toon alles (${list.length})</summary><div class="ls-list">${rest.map((r) => rowHtml(r, sub(r.x), unit, fmt)).join('')}</div></details>` : ''}
    ${note}</section>`;
}

const noteP = (t) => `<p class="muted ls-note">${t}</p>`;

function lineupButton(a, label) {
  if (!a.missing.length) return '';
  return `<div class="btn-row"><button class="btn" type="button" data-ls-lineups>${label} · ~${a.missing.length} ${a.missing.length === 1 ? 'call' : 'calls'}</button></div>`;
}

let CACHE = null; // { key, a } voor de knop

/** Inhoud van de tab Spelers of Clubs. */
export async function leagueStatsHtml(league, season, tab, { keepers: withKeepersTab = true } = {}) {
  const rows = await collect(league.id, season);
  const a = aggregate(rows);
  CACHE = { key: `${league.id}_${season}`, a };
  if (!a.total) return '<section class="section"><div class="empty"><span class="empty__title">Nog geen gespeelde duels</span><p class="muted">Haal eerst alle wedstrijden van deze competitie op (Stand → Alle wedstrijden) of laat de nachtploeg het doen.</p></div></section>';
  const evNote = noteP(`Gebaseerd op ${a.withEvents} van de ${a.total} gespeelde wedstrijden met events.`);
  const clubOf = (p) => esc(p.club);
  if (tab === 'clubs') {
    const cs = ranked(a.clubs, (c) => c.cs);
    const y = ranked(a.clubs, (c) => c.yellow); const r = ranked(a.clubs, (c) => c.red);
    return `${board('Clean sheets', cs, { sub: (c) => `${c.played} gespeeld`, note: noteP(`Uit de uitslagen, alle ${a.total} duels.`) })}
      ${board('Gele kaarten', y, { sub: (c) => `${c.withEvents} duels met events` })}
      ${board('Rode kaarten', r, { sub: (c) => `${c.withEvents} duels met events`, note: evNote })}`;
  }
  // Gelijke stand bij goals: minder minuten eerst als die bekend zijn, anders minder penalty's.
  const goals = ranked(a.players, (p) => p.goals, (x, z) => (x.minutes && z.minutes ? x.minutes - z.minutes : 0) || x.pens - z.pens || (x.name || '').localeCompare(z.name || '', 'nl'));
  const minutes = ranked(a.players, (p) => p.minutes, (x, z) => z.starts - x.starts || (x.name || '').localeCompare(z.name || '', 'nl'));
  const starts = ranked(a.players, (p) => p.starts, (x, z) => z.minutes - x.minutes || (x.name || '').localeCompare(z.name || '', 'nl'));
  const per90 = ranked(a.players.filter((p) => p.minutes >= 450), (p) => Math.round((p.goals / p.minutes) * 90 * 100) / 100, (x, z) => z.goals - x.goals);
  const nl2 = (n) => n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const minsNote = noteP(`Minuten bekend van ${a.withMins} van de ${a.total} wedstrijden (volledig verloop; de nachtploeg vult aan).`);
  const usage = (p) => (p.minutes ? ` · ${p.played} ${p.played === 1 ? 'duel' : 'duels'} · ${p.minutes} min` : '');
  const assists = ranked(a.players, (p) => p.assists);
  const yellow = ranked(a.players, (p) => p.yellow);
  const red = ranked(a.players, (p) => p.red);
  const keepers = ranked(a.players.filter((p) => p.apps), (p) => p.cs, (x, z) => x.apps - z.apps || (x.name || '').localeCompare(z.name || '', 'nl'));
  const pct = a.goals ? Math.round((a.withAssist / a.goals) * 100) : 0;
  const panels = [
    ['goals', 'Goals', board('Topscorers', goals, { sub: (p) => `${clubOf(p)}${usage(p)}${p.pens ? ` · ${p.pens} pen.` : ''}`, note: evNote })],
    ['assists', 'Assists', board('Assists', assists, { sub: clubOf, note: noteP(`Assists bij ${pct}% van de goals bekend. ${a.withEvents} van de ${a.total} wedstrijden met events.`) })],
    ['cards', 'Kaarten', `${board('Gele kaarten', yellow, { sub: clubOf })}${board('Rode kaarten', red, { sub: clubOf, note: evNote })}`],
    ['keepers', 'Keepers', a.withKeepers
      ? board('Clean sheets · keepers', keepers, { sub: (p) => `${clubOf(p)} · ${p.apps} ${p.apps === 1 ? 'duel' : 'duels'}`, note: `${noteP(`Op basis van ${a.withKeepers} van de ${a.total} wedstrijden met opstelling. Telt voor de basiskeeper, als hij niet gewisseld werd.`)}${lineupButton(a, 'Rest van de opstellingen ophalen')}` })
      : `<section class="section"><div class="section__label"><span>Clean sheets · keepers</span><span></span></div><p class="muted" style="font-size:var(--fs-md)">Hiervoor zijn de opstellingen van de duels nodig: 1 call per wedstrijd. De nachtploeg haalt ze ook vanzelf op.</p>${lineupButton(a, 'Opstellingen ophalen')}</section>`],
    ['minutes', 'Minuten', a.withMins
      ? `${board('Meeste minuten', minutes, { sub: (p) => `${clubOf(p)} · ${p.starts}× basis` })}${board('Meeste basisplaatsen', starts, { sub: (p) => `${clubOf(p)} · ${p.minutes} min` })}${board('Goals per 90 minuten', per90, { sub: (p) => `${clubOf(p)} · ${p.goals} in ${p.minutes} min`, fmt: nl2, note: `${noteP('Vanaf 450 minuten.')}${minsNote}` })}`
      : `<section class="section"><div class="section__label"><span>Minuten</span><span></span></div><p class="muted" style="font-size:var(--fs-md)">Hiervoor is het volledige verloop van de duels nodig. De nachtploeg haalt het op, dit seizoen eerst.</p></section>`],
  ].filter(([k]) => withKeepersTab || k !== 'keepers'); // beker: geen keepers (geen opstellingen van bekerduels)
  return `<fieldset class="segmented segmented--${panels.length} ls-seg"><legend class="visually-hidden">Categorie</legend>
      ${panels.map(([k, l], i) => `<input type="radio" name="ls-cat" id="ls-${k}" value="${k}" ${i === 0 ? 'checked' : ''}><label for="ls-${k}">${l}</label>`).join('')}</fieldset>
    ${panels.map(([k, , html], i) => `<div data-ls-panel="${k}" ${i === 0 ? '' : 'hidden'}>${html}</div>`).join('')}`;
}

/** Tabs boven het Stats-scherm. */
export function statsTabsHtml(leagueId, tab) {
  const t = (k, l) => `<a href="#/stats/${leagueId}${k === 'stand' ? '' : '/' + k}"${tab === k ? ' aria-current="page"' : ''}>${l}</a>`;
  return `<nav class="page-tabs" aria-label="Stats">${t('stand', 'Stand')}${t('spelers', 'Spelers')}${t('clubs', 'Clubs')}</nav>`;
}

/** Interactie: categorie kiezen (onthouden per sessie) en opstellingen ophalen. */
export function mountLeagueStats(root, ctx) {
  const radios = root.querySelectorAll('input[name="ls-cat"]');
  const show = (v) => root.querySelectorAll('[data-ls-panel]').forEach((el) => { el.hidden = el.dataset.lsPanel !== v; });
  let last = null; try { last = sessionStorage.getItem('ms-ls-cat'); } catch { /* niet erg */ }
  if (last) { const r = root.querySelector(`#ls-${last}`); if (r) { r.checked = true; show(last); } }
  radios.forEach((r) => r.addEventListener('change', () => { show(r.value); try { sessionStorage.setItem('ms-ls-cat', r.value); } catch { /* niet erg */ } }));
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ls-lineups]');
    if (!b || !CACHE) return;
    const list = CACHE.a.missing.slice();
    b.disabled = true;
    let calls = 0; let done = 0;
    try {
      for (const m of list) {
        b.textContent = `Ophalen… ${done + 1}/${list.length}`;
        const raw = await hl(`/lineups/${m.id}`);
        calls++;
        const l = normalizeLineups(raw);
        await saveLeagueExtra(m.id, { keepers: { home: gkOf(l.home), away: gkOf(l.away) }, lineupsAt: new Date().toISOString() });
        await addToLeagueIndex(m.league.id, m.league.season, { withLineups: [m.id] });
        done++;
        if (calls % 10 === 0) { await countCalls(10).catch(() => {}); calls = 0; }
      }
      toast(`${done} opstellingen opgehaald`);
    } catch (err) {
      toast(`Gestopt na ${done}: ${err.message || err}`);
    } finally {
      if (calls) await countCalls(calls).catch(() => {});
      ctx.refresh();
    }
  });
}
