// Competities die je volgt, in piramidevolgorde. Eén lijst in Firestore (meta/leagues), te beheren via
// Meer → Competities. Zonder opgeslagen lijst: Eredivisie en KKD.
// Eén stand per scherm: #/stats/<leagueId>. Zonder id: de competitie van je club dat seizoen.
// follow: false = niet meer verversen; de data blijft staan (wordt dan vanzelf oud).

import { esc } from './ui.js';
import { getMeta, replaceMeta } from './store.js';

export const DEFAULT_LEAGUES = [
  { id: 75672, name: 'Eredivisie', short: 'Eredivisie', country: 'Nederland', tier: 1, follow: true, source: 'standaard' },
  { id: 76523, name: 'Keuken Kampioen Divisie', short: 'KKD', country: 'Nederland', tier: 2, follow: true, source: 'standaard' },
];
const HOME_COUNTRY = 'Nederland';

const clean = (l) => ({
  id: Number(l.id), name: String(l.name || `Competitie ${l.id}`), short: String(l.short || l.name || l.id),
  country: String(l.country || 'Overig'), tier: Number(l.tier) || 9, follow: l.follow !== false,
  source: l.source || 'handmatig', ...(l.logo ? { logo: l.logo } : {}), ...(l.addedAt ? { addedAt: l.addedAt } : {}),
});

/** Levende lijst: andere modules lezen LEAGUES gewoon; setLeagues vult hem in place. */
export const LEAGUES = DEFAULT_LEAGUES.map(clean);
let loaded = false;

export function setLeagues(list) {
  const seen = new Set();
  const next = (list || []).map(clean).filter((l) => Number.isInteger(l.id) && l.id > 0 && !seen.has(l.id) && seen.add(l.id));
  LEAGUES.splice(0, LEAGUES.length, ...next);
  loaded = true;
}
export const leaguesLoaded = () => loaded;

/** Eenmalig uit Firestore laden (offline of mislukt: standaardlijst, volgende keer opnieuw). */
export async function ensureLeagues() {
  if (loaded) return LEAGUES;
  const m = await getMeta('leagues').catch(() => undefined);
  if (m === undefined) return LEAGUES;
  if (m && Array.isArray(m.list)) setLeagues(m.list); else loaded = true;
  return LEAGUES;
}

/** Hele lijst opslaan (vervangt het document). */
export async function saveLeagues(list) {
  const next = list.map(clean);
  await replaceMeta('leagues', { list: next, updatedAt: new Date().toISOString() });
  setLeagues(next);
}

export const followedIds = () => LEAGUES.filter((l) => l.follow).map((l) => l.id);
export const leagueInfo = (id) => LEAGUES.find((l) => l.id === Number(id)) || null;

/** Korte naam voor krappe plekken: uit je lijst, anders de naam van het object zelf. */
export function leagueShort(league) {
  if (!league) return '';
  const i = leagueInfo(typeof league === 'object' ? league.id : league);
  return (i && (i.short || i.name)) || (typeof league === 'object' ? league.name : '') || '';
}

/** Landen: je eigen land eerst, dan alfabetisch. */
export function countriesOf(list = LEAGUES) {
  return [...new Set(list.map((l) => l.country))].sort((a, b) => (a === HOME_COUNTRY ? -1 : b === HOME_COUNTRY ? 1 : a.localeCompare(b, 'nl')));
}

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
  const countries = countriesOf();
  return `<div class="lg-list">${countries.map((c) => `<div class="lg-country">${esc(c)}</div>${LEAGUES.filter((l) => l.country === c).sort((a, b) => a.tier - b.tier).map((l) => {
    const a = (avail && avail.get(l.id)) || {};
    return `<a class="lg-row ${l.id === Number(current) ? 'is-on' : ''}" href="#/stats/${l.id}" ${l.id === Number(current) ? 'aria-current="page"' : ''}>
      <span class="lg-row__tier mono">${l.tier}</span>
      <span class="lg-row__main"><span class="lg-row__name">${esc(l.name)}</span>${a.clubs ? `<small>${a.clubs} clubs</small>` : ''}</span>
      ${l.id === Number(mine) ? `<span class="lg-me mono">● ${esc(clubName)}</span>` : !l.follow ? '<span class="lg-none">niet gevolgd</span>' : a.has === false ? '<span class="lg-none">nog niet opgehaald</span>' : '<span></span>'}
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
