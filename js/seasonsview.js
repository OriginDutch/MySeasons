// Seizoenen: kiezen wat je bekijkt (paneel "Bekijken") en seizoenen beheren (Meer → Seizoenen).

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB, CURRENT_SEASON, LEAGUES } from './config.js';
import { getAllMatches, getSeasons, saveSeason, getCallsToday } from './store.js';
import { syncSeason, COST } from './sync.js';
import { getSeason, setSeason, isCurrentSeason, seasonLabel, seasonOf } from './seasonstate.js';
import { mainLeague } from './season.js';
import { openSheet } from './editor.js';
import { explain, runWithButton } from './matchviews.js';

const FIRST_YEAR = 2018;
const DEFAULT_FOLLOWS = [75672, 76523]; // Eredivisie en Eerste Divisie, elk seizoen standaard

const leagueShort = (l) => (!l ? '' : l.id === 76523 ? 'KKD' : l.name);

/** Alle seizoenen die opgehaald of aangemaakt zijn, nieuwste eerst, met wat erin zit. */
export async function seasonRows() {
  const [matches, saved] = await Promise.all([getAllMatches(), getSeasons().catch(() => [])]);
  const map = new Map();
  const row = (year) => {
    if (!map.has(year)) map.set(year, { year, saved: null, matches: [] });
    return map.get(year);
  };
  row(CURRENT_SEASON);
  saved.forEach((s) => { row(Number(s.year)).saved = s; });
  matches.forEach((m) => { const y = seasonOf(m); if (y != null) row(y).matches.push(m); });
  return [...map.values()].sort((a, b) => b.year - a.year).map((r) => {
    const own = r.matches.filter((m) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === MAIN_CLUB.id));
    const league = mainLeague(own);
    return {
      ...r, league,
      count: own.length,
      played: own.filter((m) => m.status === 'finished').length,
      detailed: own.filter((m) => m.detail).length,
      source: r.saved ? r.saved.source : own.length ? 'highlightly' : null,
    };
  });
}

function rowSub(r) {
  if (!r.count) return r.source === 'manual' ? 'Leeg seizoen, zelf in te vullen' : 'Nog niets opgehaald';
  return `${r.played} gespeeld · ${r.detailed} met details`;
}

/** Paneel "Bekijken": club en seizoen kiezen. */
export async function openViewSheet(ctx) {
  const rows = await seasonRows();
  const cur = getSeason();
  const data = await openSheet({
    title: 'Bekijken',
    submitLabel: 'Bekijken',
    body: `
      <div class="pick-label mono"><span>Club</span><span>meer clubs volgen later</span></div>
      <div class="pick pick--on"><span class="pick__crest">${esc(MAIN_CLUB.short)}</span><span><b>${esc(MAIN_CLUB.name)}</b><small>Hoofdclub</small></span><span class="pick__tick">✓</span></div>
      <div class="pick-label mono"><span>Seizoen</span><a href="#/seizoenen" data-close-sheet>Seizoenen beheren</a></div>
      ${rows.map((r) => `<label class="pick">
        <input type="radio" name="season" value="${r.year}" ${r.year === cur ? 'checked' : ''}>
        <span class="mono pick__year">${esc(seasonLabel(r.year))}</span>
        <span><b>${esc(r.league ? leagueShort(r.league) : '—')}</b><small>${r.year === CURRENT_SEASON ? 'Nu · ' : ''}${esc(rowSub(r))}</small></span>
        <span class="pick__tick">✓</span></label>`).join('')}`,
  });
  if (!data) return;
  setSeason(data.get('season'));
  if (location.hash.startsWith('#/wedstrijd/') || location.hash.startsWith('#/speler/')) location.hash = '#/home';
  else ctx.refresh();
}

// Sluit een open sheet als je op een link erin tikt.
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-close-sheet]');
  if (a) { const d = a.closest('dialog'); if (d) d.close(); }
});

export function pastSeasonBar() {
  if (isCurrentSeason()) return '';
  return `<div class="past-bar"><span>Je bekijkt ${esc(seasonLabel())}</span><button type="button" data-season-now>Terug naar nu</button></div>`;
}

export const seasonViews = {
  seizoenen: {
    title: 'Seizoenen',
    navKey: 'meer',
    async render() {
      const [rows, calls] = await Promise.all([seasonRows(), getCallsToday().catch(() => 0)]);
      const have = new Set(rows.map((r) => r.year));
      const addable = [];
      for (let y = CURRENT_SEASON - 1; y >= FIRST_YEAR; y--) if (!have.has(y)) addable.push(y);
      return `
        <header class="page-head"><div class="page-head__titles">
          <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
          <span class="page-head__kicker">Meer / Seizoenen</span><h1 class="page-head__title">Seizoenen</h1></div></header>
        <section class="section">
          <p class="muted" style="font-size:13px">Per seizoen volg je ${esc(MAIN_CLUB.name)} en standaard de ${DEFAULT_FOLLOWS.map((id) => esc(LEAGUES[id])).join(' en ')}. API vandaag: ${calls} calls.</p>
          <div class="list">${rows.map((r) => `
            <div class="season-row">
              <span class="season-row__year mono">${esc(seasonLabel(r.year))}</span>
              <span class="list-row__main"><span class="list-row__title">${esc(r.league ? r.league.name : '—')}${r.year === CURRENT_SEASON ? ' <span class="muted">· nu</span>' : ''}</span>
                <span class="list-row__sub">${esc(rowSub(r))}</span></span>
              <span class="season-row__actions">
                <button class="btn btn--sm" type="button" data-view-season="${r.year}">Bekijken</button>
                ${r.source !== 'manual' ? `<button class="btn btn--sm" type="button" data-fetch-season="${r.year}">${r.count ? 'Bijwerken' : 'Ophalen'} · ${COST.season}</button>` : ''}
              </span>
            </div>`).join('')}</div>
        </section>
        ${addable.length ? `<section class="section">
          <div class="section__label"><span>Seizoen toevoegen</span></div>
          <label class="field"><span>Seizoen</span><select name="add-year">${addable.map((y) => `<option value="${y}">${esc(seasonLabel(y))}</option>`).join('')}</select></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn--primary" type="button" data-add="highlightly">Ophalen bij Highlightly · ${COST.season} calls</button>
            <button class="btn" type="button" data-add="manual">Leeg aanmaken</button>
          </div>
          <p class="muted" style="font-size:12px">Ophalen haalt het programma en de uitslagen van ${esc(MAIN_CLUB.name)} plus de stand. Details per wedstrijd haal je later op, of laat je 's nachts ophalen. Heeft Highlightly het seizoen niet, dan maak je het leeg aan.</p>
        </section>` : ''}`;
    },
    mount(root, ctx) {
      root.addEventListener('click', async (e) => {
        const view = e.target.closest('[data-view-season]');
        if (view) { setSeason(view.dataset.viewSeason); location.hash = '#/home'; return; }
        const fetchBtn = e.target.closest('[data-fetch-season]');
        const add = e.target.closest('[data-add]');
        if (!fetchBtn && !add) return;
        const year = Number(fetchBtn ? fetchBtn.dataset.fetchSeason : root.querySelector('select[name="add-year"]').value);
        const btn = fetchBtn || add;
        try {
          if (add && add.dataset.add === 'manual') {
            await saveSeason(year, { source: 'manual', follows: DEFAULT_FOLLOWS, createdAt: new Date().toISOString() });
            toast(`${seasonLabel(year)} aangemaakt als leeg seizoen`);
          } else {
            const n = await runWithButton(btn, 'Ophalen…', () => syncSeason(year));
            await saveSeason(year, { source: n ? 'highlightly' : 'manual', follows: DEFAULT_FOLLOWS, createdAt: new Date().toISOString() });
            toast(n ? `${seasonLabel(year)}: ${n} wedstrijden · ${COST.season} calls` : `Highlightly heeft ${seasonLabel(year)} niet; leeg seizoen aangemaakt`);
          }
          ctx.refresh();
        } catch (err) {
          toast(explain(err));
        }
      });
    },
  },
};
