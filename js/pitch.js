// Opstelling tonen: op het veld (rugnummer, achternaam, wat opvalt) of als lijst per linie (naam voluit, positie,
// een regel over zijn seizoen). Eén schakelaar Veld · Lijst, onthouden op dit apparaat. Gebruikt voor de verwachte
// opstellingen (predict.js) en de echte opstellingen op de wedstrijd- en duelpagina.
//
// rows: linies van achter naar voren (keeper eerst), elk een rij spelers van links naar rechts zoals Highlightly ze
// aanlevert: { id, number, full, short, info, tag, conf }. Links/rechts kan gespiegeld zijn (Highlightly draaide de
// volgorde al eens om); de lijst heeft daar geen last van.

import { esc } from './ui.js';

const KEY = 'ms-lineup-view';
export const lineupView = () => { try { return localStorage.getItem(KEY) || 'veld'; } catch { return 'veld'; } };
const PARTICLE = /^(van|de|der|den|ter|ten|te|el|al|da|dos|di|le|la|du|op|in|'t|bin|ben|von|y)$/i;

/** "Søren Tengstedt" → "Tengstedt", "Bas van Duijl" → "van Duijl", "T. Jansen" → "Jansen". */
export function shortName(full) {
  const w = String(full || '?').trim().split(/\s+/);
  if (w.length === 1) return w[0];
  const i = w.findIndex((x, k) => k > 0 && PARTICLE.test(x));
  return (i > 0 ? w.slice(i) : w.slice(1)).join(' ');
}

const DOT = { zeker: 'is-sure', waarschijnlijk: 'is-likely', twijfel: 'is-doubt' };

function pitch(rows, color) {
  return `<div class="lv-pitch" style="--lv-dot:${esc(color || 'var(--accent)')}">${rows.slice().reverse().map((row) => `<div class="lv-row">${row.map((p) => `
    <button type="button" class="lv-p ${DOT[p.conf] || ''}" data-lv-p="${esc(String(p.id))}" data-info="${esc(`${p.full}${p.pos ? ' · ' + p.pos : ''}${p.info ? ' · ' + p.info : ''}`)}">
      <span class="lv-dot">${p.number ?? ''}</span><span class="lv-nm">${esc(p.short || shortName(p.full))}</span>${p.tag ? `<small>${esc(p.tag)}</small>` : ''}
    </button>`).join('')}</div>`).join('')}</div>
    <p class="lv-info muted" data-lv-info>Tik op een speler voor zijn naam voluit, positie en seizoen.</p>`;
}

const CONF = { zeker: '🟢', waarschijnlijk: '🟡', twijfel: '⚪' };
function list(rows, names) {
  return `<div class="lv-list">${rows.map((row, i) => `<div class="lv-line mono">${esc(names[i] || '')}${row.length > 1 ? ` (${row.length})` : ''}</div>${row.map((p) => `
    <div class="lv-li"><span class="lv-n mono">${p.number ?? ''}</span><span class="lv-full">${esc(p.full)}<small>${esc([p.pos, p.info].filter(Boolean).join(' · '))}</small>${p.alt ? `<small>of ${esc(p.alt)}</small>` : ''}</span><span>${p.conf ? CONF[p.conf] : ''}</span></div>`).join('')}`).join('')}</div>`;
}

/** Veld en lijst samen, met de schakelaar. */
export function lineupHtml(rows, { names = [], color = null } = {}) {
  const v = lineupView();
  return `<div class="lv" data-lv="${v}">
    <div class="lv-toggle" role="group" aria-label="Weergave"><button type="button" data-lv-set="veld" aria-pressed="${v === 'veld'}">Veld</button><button type="button" data-lv-set="lijst" aria-pressed="${v === 'lijst'}">Lijst</button></div>
    <div class="lv-veld">${pitch(rows, color)}</div><div class="lv-lijst">${list(rows, names)}</div></div>`;
}

/** Positie in gewone taal uit Highlightly's Goalkeeper/Defender/Midfielder/Forward. */
export const posName = (p) => ({ Goalkeeper: 'keeper', Defender: 'verdediger', Midfielder: 'middenvelder', Forward: 'aanvaller' }[p] || '');

/** Tabjes per club boven een opstelling: [[naam, html], ...]. */
export function teamTabsHtml(list) {
  if (list.length === 1) return list[0][1];
  return `<div data-tabs><div class="page-tabs pred-tabs">${list.map(([n], i) => `<button type="button" data-tab="${i}" aria-current="${i === 0 ? 'page' : 'false'}">${esc(n)}</button>`).join('')}</div>
    ${list.map(([, h], i) => `<div data-tab-panel="${i}" ${i === 0 ? '' : 'hidden'}>${h}</div>`).join('')}</div>`;
}

// Eén keer, voor alle schermen: schakelaar, tabjes en tik-op-speler.
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('[data-tab]');
  if (t) {
    const box = t.closest('[data-tabs]');
    box.querySelectorAll(':scope > .page-tabs [data-tab]').forEach((b) => b.setAttribute('aria-current', b === t ? 'page' : 'false'));
    box.querySelectorAll(':scope > [data-tab-panel]').forEach((el) => { el.hidden = el.dataset.tabPanel !== t.dataset.tab; });
    return;
  }
  const set = e.target.closest && e.target.closest('[data-lv-set]');
  if (set) {
    const v = set.dataset.lvSet;
    try { localStorage.setItem(KEY, v); } catch { /* niet erg */ }
    document.querySelectorAll('[data-lv]').forEach((el) => { el.dataset.lv = v; el.querySelectorAll('[data-lv-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lvSet === v))); });
    return;
  }
  const p = e.target.closest && e.target.closest('[data-lv-p]');
  if (p) {
    const box = p.closest('.lv');
    box.querySelectorAll('.lv-p.is-on').forEach((x) => x.classList.remove('is-on'));
    p.classList.add('is-on');
    const info = box.querySelector('[data-lv-info]');
    if (info) info.textContent = p.dataset.info;
  }
});
