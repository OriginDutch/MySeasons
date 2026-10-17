// Ranglijst: volledige stand (Stats-scherm) en een mini-stand rond de eigen club (Home).

import { esc } from './ui.js';
import { MAIN_CLUB, ZONES } from './config.js';

const TEAM = MAIN_CLUB.id;

function crest(t) {
  const txt = esc((t.name || '?').slice(0, 3).toUpperCase());
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

function zoneOf(leagueId, pos) {
  return (ZONES[leagueId] || []).find((z) => pos >= z.from && pos <= z.to) || null;
}

const gd = (l) => {
  const v = l.gf - l.ga;
  return v > 0 ? `+${v}` : String(v);
};

function rowHtml(r, leagueId, withZones) {
  const z = withZones ? zoneOf(leagueId, r.pos) : null;
  const me = r.team.id === TEAM;
  return `<tr class="${me ? 'is-me' : ''} ${z ? 'zone--' + z.kind : ''}">
    <td class="mono st-pos">${r.pos}</td>
    <td class="st-club">${crest(r.team)}<span>${esc(r.team.name)}</span></td>
    <td class="mono">${r.line.played}</td>
    <td class="mono st-wide">${r.line.w}</td><td class="mono st-wide">${r.line.d}</td><td class="mono st-wide">${r.line.l}</td>
    <td class="mono st-wide">${r.line.gf}:${r.line.ga}</td>
    <td class="mono">${gd(r.line)}</td>
    <td class="mono st-pts">${r.pts}</td>
  </tr>`;
}

export function standTable(rows, leagueId, { withZones = true } = {}) {
  return `
    <div class="table-wrap"><table class="table stand">
      <thead><tr><th>#</th><th>Club</th><th>GS</th><th class="st-wide">W</th><th class="st-wide">G</th><th class="st-wide">V</th><th class="st-wide">Doelen</th><th>DS</th><th>PT</th></tr></thead>
      <tbody>${rows.map((r) => rowHtml(r, leagueId, withZones)).join('')}</tbody>
    </table></div>`;
}

export function zoneLegend(leagueId) {
  const z = ZONES[leagueId];
  if (!z) return '';
  return `<div class="zone-legend">${z.map((x) => `<span><i class="zone-key zone-key--${x.kind}"></i>${esc(x.label)}</span>`).join('')}</div>`;
}

/** Twee plekken boven en onder de eigen club. */
export function miniStand(standings, leagueId) {
  const g = standings && standings.groups && standings.groups[0];
  if (!g) return '';
  const rows = rowsFor(g, 'total');
  const i = rows.findIndex((r) => r.team.id === TEAM);
  if (i < 0) return '';
  const start = Math.max(0, Math.min(i - 2, rows.length - 5));
  return standTable(rows.slice(start, start + 5), leagueId);
}
