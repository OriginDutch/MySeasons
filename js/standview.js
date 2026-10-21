// Ranglijst: volledige stand (Stats-scherm) en een mini-stand rond de eigen club (Home).
// Zones komen uit de regelmotor (rules.js): zonesFor(rules, rows) → { map, legend }.

import { esc } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { nameHtml } from './clubnames.js';

const TEAM = MAIN_CLUB.id;

function crest(t) {
  const txt = esc((t.name || '?').replace(/^(FC|SC|sc|SV|AFC|Jong)\s+/, '').slice(0, 3).toUpperCase());
  return t.logo
    ? `<img class="crest crest--sm" src="${esc(t.logo)}" width="20" height="20" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'crest crest--txt crest--sm',textContent:'${txt}'}))">`
    : `<span class="crest crest--txt crest--sm">${txt}</span>`;
}

/** Rijen voor 'total', 'home' of 'away'. Bij thuis/uit rangschikken we zelf. */
export function rowsFor(group, mode = 'total') {
  if (mode === 'total') {
    return group.rows.map((r) => ({ ...r, line: r.total, pts: r.points, pos: r.position }));
  }
  return group.rows
    .filter((r) => r[mode])
    .map((r) => ({ ...r, line: r[mode], pts: r[mode].w * 3 + r[mode].d }))
    .sort((a, b) => b.pts - a.pts || (b.line.gf - b.line.ga) - (a.line.gf - a.line.ga) || b.line.gf - a.line.gf)
    .map((r, i) => ({ ...r, pos: i + 1 }));
}

/** Rijen van een periodestand (rules.periodTable) in hetzelfde formaat. */
export function periodRows(table) {
  return table.rows.map((r) => ({ ...r, line: r.total, pts: r.points, pos: r.position }));
}

const gd = (l) => {
  const v = l.gf - l.ga;
  return v > 0 ? `+${v}` : String(v);
};

const MARK = { rivaal: 'rivaal', interessant: '★' };
/** Labels: P1, P3 voor elke echte periodekampioen; "via P2" voor een club die het ticket van een ander kreeg. */
function periodTagsHtml(zones, teamId, z) {
  const won = (zones && zones.periodTags && zones.periodTags.get(String(teamId))) || [];
  let out = won.map((k) => `<i class="st-tag mono" title="Periodekampioen ${esc(k)}">${esc(k)}</i>`).join('');
  if (z && z.tag && !won.includes(z.tag)) out += `<i class="st-tag st-tag--via mono" title="Kreeg het nacompetitieticket van ${esc(z.tag)}: de winnaar was al geplaatst">via ${esc(z.tag)}</i>`;
  return out;
}

function rowHtml(r, zones, marks, highlight, form, leagueId) {
  const z = zones ? zones.map.get(String(r.team.id)) : null;
  const me = r.team.id === TEAM;
  const hl = highlight && highlight.get(String(r.team.id));
  return `<tr class="${me ? 'is-me' : ''} ${z ? 'zone--' + z.kind : ''} ${hl ? 'is-hl' : ''}">
    <td class="mono st-pos">${r.pos}</td>
    <td class="st-club"><a class="st-link" href="#/club/${encodeURIComponent(String(r.team.id))}${leagueId ? `/${leagueId}` : ''}">${crest(r.team)}<span>${nameHtml(r.team, esc)}</span>${periodTagsHtml(zones, r.team.id, z)}${hl ? `<i class="st-tag st-tag--hl mono">${esc(hl)}</i>` : ''}${marks && marks[r.team.id] && MARK[marks[r.team.id].mark] ? `<i class="st-mark st-mark--${esc(marks[r.team.id].mark)}" title="${esc(marks[r.team.id].note || marks[r.team.id].mark)}">${MARK[marks[r.team.id].mark]}</i>` : ''}</a></td>
    <td class="mono">${r.line.played}</td>
    <td class="mono st-wide">${r.line.w}</td><td class="mono st-wide">${r.line.d}</td><td class="mono st-wide">${r.line.l}</td>
    <td class="mono st-wide">${r.line.gf}:${r.line.ga}</td>
    <td class="mono">${gd(r.line)}</td>
    <td class="mono st-pts">${r.pts}</td>
    ${form ? `<td class="st-form">${(form.get(String(r.team.id)) || []).map((x) => `<i class="form__tile form__tile--${x}">${x}</i>`).join('')}</td>` : ''}
  </tr>`;
}

/** zones: uitkomst van zonesFor, of null. highlight: Map(teamId → korte tekst), bijv. periodewinnaar. */
/** Laatste 5 uitslagen per team (oud → nieuw) uit een lijst competitiewedstrijden. */
/** Laatste 5 per club. side 'home'/'away': alleen thuis- of uitduels van die club. */
export function formMap(matches, side = 'total') {
  const out = new Map();
  (matches || []).filter((m) => m.status === 'finished' && m.score && m.score.home != null)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .forEach((m) => {
      const r = m.score.home > m.score.away ? ['W', 'V'] : m.score.home < m.score.away ? ['V', 'W'] : ['G', 'G'];
      [[m.homeTeam, r[0], 'home'], [m.awayTeam, r[1], 'away']].filter((x) => side === 'total' || x[2] === side).forEach(([t, x]) => { const k = String(t.id); out.set(k, [...(out.get(k) || []), x].slice(-5)); });
    });
  return out;
}

export function standTable(rows, { zones = null, marks = null, highlight = null, form = null, mini = false, leagueId = null } = {}) {
  return `
    <div class="table-wrap"><table class="table stand${mini ? ' stand--mini' : ''}">
      <thead><tr><th>#</th><th>Club</th><th>GS</th><th class="st-wide">W</th><th class="st-wide">G</th><th class="st-wide">V</th><th class="st-wide">Doelen</th><th>DS</th><th>PT</th>${form ? '<th class="st-form">Vorm</th>' : ''}</tr></thead>
      <tbody>${rows.map((r) => rowHtml(r, zones, marks, highlight, form, leagueId)).join('')}</tbody>
    </table></div>`;
}

export function zoneLegend(zones, rules, { provisional = zones ? zones.provisional !== false : true } = {}) {
  if (!zones || !zones.legend.length) return '';
  const hasJong = [...zones.map.values()].some((z) => z.kind === 'jong');
  const hasTag = [...zones.map.values()].some((z) => z.tag) || (zones.periodTags && zones.periodTags.size > 0);
  return `<div class="zone-legend">${zones.legend.map((x) => `<span><i class="zone-key zone-key--${x.kind}"></i>${esc(x.label)}</span>`).join('')}${hasJong ? '<span><i class="zone-key zone-key--jong"></i>Beloftenteam, telt niet mee</span>' : ''}${hasTag ? '<span><i class="st-tag mono">P1</i> periodekampioen</span>' : ''}${[...zones.map.values()].some((z) => z.tag && z.via && z.via !== 'winst') ? '<span><i class="st-tag st-tag--via mono">via P2</i> ticket doorgeschoven</span>' : ''}</div>
    ${provisional ? '<p class="muted" style="font-size:12px;margin:0">Voorlopig: zo zou het zijn als de competitie nu eindigt.</p>' : ''}
    ${rules && rules.cup ? `<p class="muted" style="font-size:12px;margin:0">${zones.cup ? `Bekerwinnaar: <strong>${esc(zones.cup.team.name)}</strong>. De tickets zijn daarop aangepast.` : provisional ? 'Bekerwinnaar nog niet bekend: de tickets schuiven door zodra de bekerfinale gespeeld is.' : 'Bekerwinnaar onbekend in je data: tickets zonder bekerverschuiving.'}</p>` : ''}
    ${rules && rules.note ? `<p class="muted" style="font-size:12px">${esc(rules.note)}</p>` : ''}`;
}

/** Twee plekken boven en onder de eigen club. */
export function miniStand(standings, zones) {
  const g = standings && standings.groups && standings.groups[0];
  if (!g) return '';
  const rows = rowsFor(g, 'total');
  const i = rows.findIndex((r) => r.team.id === TEAM);
  if (i < 0) return '';
  const start = Math.max(0, Math.min(i - 2, rows.length - 5));
  return standTable(rows.slice(start, start + 5), { zones, mini: true });
}
