// Competities die je volgt, in piramidevolgorde. Nu Eredivisie en KKD; later uit te breiden (Meer → Competities).
// Eén stand per scherm: #/stats/<leagueId>. Zonder id: de competitie van je club dat seizoen.

import { esc } from './ui.js';

export const LEAGUES = [
  { id: 75672, name: 'Eredivisie', short: 'Eredivisie', country: 'Nederland', tier: 1 },
  { id: 76523, name: 'Keuken Kampioen Divisie', short: 'KKD', country: 'Nederland', tier: 2 },
];

export const leagueInfo = (id) => LEAGUES.find((l) => l.id === Number(id)) || null;

/** Buren in de piramide (zelfde land): { up, down } of null. */
export function neighbours(id) {
  const me = leagueInfo(id); if (!me) return { up: null, down: null };
  const same = LEAGUES.filter((l) => l.country === me.country);
  return { up: same.find((l) => l.tier === me.tier - 1) || null, down: same.find((l) => l.tier === me.tier + 1) || null };
}

/**
 * Lijstregels. avail: Map(id → { clubs, has }) voor dit seizoen; mine: id van de competitie van je club; current: id die je nu bekijkt.
 */
export function leagueListHtml({ current, mine, avail, clubName, post = [] }) {
  const countries = [...new Set(LEAGUES.map((l) => l.country))];
  return `<div class="lg-list">${countries.map((c) => `<div class="lg-country">${esc(c)}</div>${LEAGUES.filter((l) => l.country === c).sort((a, b) => a.tier - b.tier).map((l) => {
    const a = (avail && avail.get(l.id)) || {};
    return `<a class="lg-row ${l.id === Number(current) ? 'is-on' : ''}" href="#/stats/${l.id}" ${l.id === Number(current) ? 'aria-current="page"' : ''}>
      <span class="lg-row__tier mono">${l.tier}</span>
      <span class="lg-row__main"><span class="lg-row__name">${esc(l.name)}</span>${a.clubs ? `<small>${a.clubs} clubs</small>` : ''}</span>
      ${l.id === Number(mine) ? `<span class="lg-me mono">● ${esc(clubName)}</span>` : a.has === false ? '<span class="lg-none">nog niet opgehaald</span>' : '<span></span>'}
    </a>`;
  }).join('')}`).join('')}${post.length ? `<div class="lg-country">Na de competitie</div>${post.map((p) => `<a class="lg-row ${p.key === current ? 'is-on' : ''}" href="#/stats/${p.key}" ${p.key === current ? 'aria-current="page"' : ''}>
      <span class="lg-row__tier mono"></span>
      <span class="lg-row__main"><span class="lg-row__name">${esc(p.name)}</span><small>${esc(p.sub)}</small></span>
      ${p.mine ? `<span class="lg-me mono">● ${esc(clubName)}</span>` : `<span class="lg-none">${esc(p.label)}</span>`}
    </a>`).join('')}` : ''}</div>`;
}

/** Mobiel: lijst als sheet onder in beeld. Kiezen = navigeren (een hashchange sluit de sheet). */
export function openLeagueSheet(html, seasonText) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet lg-sheet';
  dlg.innerHTML = `<div class="sheet__form"><div class="sheet__head"><span class="sheet__title">Competitie</span></div>
    <p class="muted sheet__note">Seizoen ${esc(seasonText)} · de competities die je volgt</p>${html}
    <div class="sheet__actions"><button class="btn" type="button" data-close>Sluiten</button></div></div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]') || e.target.closest('.lg-row')) dlg.close(); });
  dlg.showModal();
}
