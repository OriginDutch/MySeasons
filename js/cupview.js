// KNVB Beker: Stats → competitiekiezer → KNVB Beker (#/stats/77374[/schema|/spelers]).
// Bron: de bekerlijst van de nachtploeg (alle duels, uitslag, verlenging, strafschoppen) plus de Cambuur-duels uit
// je eigen wedstrijden. Schutters en kaarten van andere bekerduels: nachtploeg-items 'events' (1 call per duel).
// Logo's: amateurclubs hebben bij Highlightly vaak geen logo. Dan een leeg rondje; tik erop om er zelf een te
// kiezen (clubs/{id}.logoOwn). Komt er later een logo van Highlightly, dan staat dat in Afwijkingen.

import { esc, toast } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getLeagueMatches, getSeasonMatches, getClubMarks, saveClubMarksBatch } from './store.js';
import { setOne } from './clubnames.js';
import { prepareImage } from './photos.js';

export const CUP_ID = 77374;
const TEAM = MAIN_CLUB.id;
const TZ = 'Europe/Amsterdam';
const fDay = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fTime = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayKey = (iso) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso));

// Highlightly-rondenamen (en de oude namen uit eigen/RSSSF-data) → volgorde, naam, korte naam.
const ROUNDS = [
  [/^1st preliminary/i, 1, 'Voorronde 1', 'VR1'],
  [/^2nd preliminary/i, 2, 'Voorronde 2', 'VR2'],
  [/^(1st round|round of 64|round 1)$/i, 3, '1e ronde', '1e'],
  [/^(2nd round|round of 32|round 2)$/i, 4, '2e ronde', '2e'],
  [/^(round of 16|1\/8)/i, 5, 'Achtste finale', '1/8'],
  [/^quarter/i, 6, 'Kwartfinale', '1/4'],
  [/^semi/i, 7, 'Halve finale', '1/2'],
  [/^final$/i, 8, 'Finale', 'F'],
];
export function roundOf(name) {
  const r = ROUNDS.find(([re]) => re.test(String(name || '').trim()));
  return r ? { n: r[1], name: r[2], short: r[3] } : { n: 0, name: String(name || 'Ronde'), short: '?' };
}

const isUs = (t) => t && t.id === TEAM;
const played = (m) => m.status === 'finished' && m.score;
/** 'home' | 'away' | null: wie ging door (strafschoppen beslissen bij gelijke stand na verlenging). */
export function winnerOf(m) {
  if (!played(m)) return null;
  const { home, away } = m.score;
  if (home !== away) return home > away ? 'home' : 'away';
  const p = m.penalties;
  if (p && p.home != null && p.home !== p.away) return p.home > p.away ? 'home' : 'away';
  return null;
}
const extraOf = (m) => {
  if (m.penalties && m.penalties.home != null) return `${m.penalties.home}–${m.penalties.away} pen.`;
  if (/extra time|verlenging/i.test(m.stateText || '')) return 'n.v.';
  return '';
};

/** Alle bekerduels van een seizoen: de lijst van de nachtploeg, met de Cambuur-duels uit je eigen data erover. */
export async function cupMatches(season) {
  const [lm, own] = await Promise.all([getLeagueMatches(CUP_ID, season).catch(() => []), getSeasonMatches(season).catch(() => [])]);
  const map = new Map(lm.map((m) => [String(m.id), m]));
  own.filter((m) => m.league && Number(m.league.id) === CUP_ID).forEach((m) => map.set(String(m.id), { ...(map.get(String(m.id)) || {}), ...m }));
  return [...map.values()].filter((m) => m.homeTeam && m.awayTeam && m.status !== 'cancelled')
    .map((m) => ({ ...m, r: roundOf(m.round) }))
    .sort((a, b) => a.r.n - b.r.n || Date.parse(a.date) - Date.parse(b.date));
}

function crest(t) {
  if (!t) return '<span class="cup-crest cup-crest--empty"></span>';
  if (t.logo) return `<img class="cup-crest" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.className='cup-crest cup-crest--empty';this.removeAttribute('src')"${!t.apiLogo ? ` data-logo-pick="${esc(String(t.id))}" data-logo-name="${esc(t.name)}" title="Eigen logo · tik om te wijzigen"` : ''}>`;
  return `<button class="cup-crest cup-crest--empty" type="button" data-logo-pick="${esc(String(t.id))}" data-logo-name="${esc(t.name)}" aria-label="Logo kiezen voor ${esc(t.name)}"></button>`;
}

function matchRow(m) {
  const w = winnerOf(m);
  const us = isUs(m.homeTeam) || isUs(m.awayTeam);
  const sc = played(m) ? `${m.score.home}–${m.score.away}` : m.status === 'postponed' ? 'uitg.' : fTime.format(new Date(m.date));
  const team = (t, side) => `<span class="cup-team cup-team--${side}${w && w !== side ? ' is-out' : ''}${isUs(t) ? ' is-us' : ''}">${side === 'home' ? `${crest(t)}<span>${esc(t.name)}</span>` : `<span>${esc(t.name)}</span>${crest(t)}`}</span>`;
  const inner = `${team(m.homeTeam, 'home')}<span class="cup-sc${played(m) ? '' : ' is-pre'}">${sc}<small>${esc(extraOf(m))}</small></span>${team(m.awayTeam, 'away')}`;
  return us ? `<a class="cup-m is-us" href="#/wedstrijd/${esc(String(m.id))}">${inner}</a>` : `<div class="cup-m">${inner}</div>`;
}

/** De weg van Cambuur door de beker. */
function pathHtml(all) {
  const ours = all.filter((m) => isUs(m.homeTeam) || isUs(m.awayTeam));
  if (!ours.length) return '';
  const last = ours[ours.length - 1];
  const steps = ours.map((m) => {
    const side = isUs(m.homeTeam) ? 'home' : 'away';
    const opp = side === 'home' ? m.awayTeam : m.homeTeam;
    if (!played(m)) return `<li class="is-next">${esc(m.r.name)} · ${side === 'home' ? 'thuis tegen' : 'bij'} ${esc(opp.name)} · ${esc(fDay.format(new Date(m.date)).replace(/\./g, ''))} ${esc(fTime.format(new Date(m.date)))}</li>`;
    const w = winnerOf(m);
    const us = side === 'home' ? m.score.home : m.score.away; const them = side === 'home' ? m.score.away : m.score.home;
    const ok = w === side;
    return `<li class="${ok ? 'is-ok' : 'is-out'}">${esc(m.r.name)} · ${us}–${them}${extraOf(m) ? ` (${esc(extraOf(m))})` : ''} ${side === 'home' ? 'tegen' : 'bij'} ${esc(opp.name)} ${ok ? '✓' : '✗'}</li>`;
  });
  const lw = winnerOf(last);
  const usSide = isUs(last.homeTeam) ? 'home' : 'away';
  const final = last.r.n === 8;
  const state = !played(last) ? 'nog in de beker' : lw === usSide ? (final ? '🏆 bekerwinnaar' : 'nog in de beker') : `uitgeschakeld in de ${last.r.name.toLowerCase()}`;
  const nextR = played(last) && lw === usSide && !final ? ROUNDS.find((r) => r[1] === last.r.n + 1) : null;
  const later = nextR && !all.some((m) => m.r.n === nextR[1] && (isUs(m.homeTeam) || isUs(m.awayTeam)));
  return `<section class="section cup-path"><div><b>${esc(MAIN_CLUB.name)}</b> · ${esc(state)}</div><ol>${steps.join('')}${later ? `<li class="is-next">${esc(nextR[2])} · loting volgt</li>` : ''}</ol></section>`;
}

function roundsHtml(all) {
  if (!all.length) return '<section class="section"><div class="empty"><span class="empty__title">Nog geen bekerduels</span><p class="muted">De nachtploeg haalt de bekerlijst op. Of tik op Stand → Alle wedstrijden bij een competitie.</p></div></section>';
  const rounds = [...new Map(all.map((m) => [m.r.n, m.r])).values()].sort((a, b) => a.n - b.n);
  // Standaard: de ronde van het eerstvolgende of laatst gespeelde duel van Cambuur, anders de laatste ronde.
  const ours = all.filter((m) => isUs(m.homeTeam) || isUs(m.awayTeam));
  const upcoming = all.find((m) => !played(m) && m.status !== 'postponed');
  const start = (ours.find((m) => !played(m)) || upcoming || ours[ours.length - 1] || all[all.length - 1]).r.n;
  return `<fieldset class="segmented cup-seg" style="grid-template-columns:repeat(${rounds.length}, minmax(0, 1fr))"><legend class="visually-hidden">Ronde</legend>
    ${rounds.map((r) => `<input type="radio" name="cup-round" id="cr-${r.n}" value="${r.n}" ${r.n === start ? 'checked' : ''}><label for="cr-${r.n}">${esc(r.short)}</label>`).join('')}</fieldset>
    ${rounds.map((r) => {
      const ms = all.filter((m) => m.r.n === r.n);
      const days = [...new Set(ms.map((m) => dayKey(m.date)))];
      const done = ms.filter(played).length;
      return `<div data-cup-round="${r.n}" ${r.n === start ? '' : 'hidden'}><section class="section"><div class="section__label"><span>${esc(r.name)} · ${ms.length} ${ms.length === 1 ? 'duel' : 'duels'}</span><span>${done === ms.length ? 'gespeeld' : `${done} gespeeld`}</span></div>
        ${days.map((d) => { const dm = ms.filter((m) => dayKey(m.date) === d); return `<div class="cup-day mono">${esc(fDay.format(new Date(dm[0].date)).replace(/\./g, ''))}</div>${dm.map(matchRow).join('')}`; }).join('')}
      </section></div>`;
    }).join('')}
    <p class="muted cup-note">Lege rondjes: clubs zonder logo bij Highlightly. Tik erop om er zelf een te kiezen.</p>`;
}

/** Schema vanaf de achtste finales. De KNVB loot elke ronde opnieuw: een ronde vult zich na de loting. */
function schemaHtml(all) {
  const cols = [[5, 8], [6, 4], [7, 2], [8, 1]].map(([n, size]) => {
    const r = ROUNDS.find((x) => x[1] === n);
    const ms = all.filter((m) => m.r.n === n);
    const slots = ms.map((m) => {
      const w = winnerOf(m);
      const us = isUs(m.homeTeam) || isUs(m.awayTeam);
      const line = (t, side) => `<div class="${w && w !== side ? 'is-out' : ''}${isUs(t) ? ' is-us' : ''}"><span>${esc(t.short || t.name)}</span><b>${played(m) ? m.score[side] : ''}${m.penalties && m.penalties.home != null ? `<small> (${m.penalties[side]})</small>` : ''}</b></div>`;
      return `<div class="cup-slot${us ? ' is-us' : ''}">${line(m.homeTeam, 'home')}${line(m.awayTeam, 'away')}${played(m) ? '' : `<small class="muted">${esc(fDay.format(new Date(m.date)).replace(/\./g, ''))}</small>`}</div>`;
    });
    while (slots.length < size) slots.push('<div class="cup-slot is-tbd"><span>loting</span></div>');
    return `<div class="cup-col"><div class="cup-col__h mono">${esc(r[3] === 'F' ? 'Finale' : r[3])}</div>${slots.join('')}</div>`;
  });
  return `<p class="muted cup-note" style="margin-top:0">Het schema begint bij de achtste finales. De KNVB loot elke ronde opnieuw, dus een ronde vult zich na de loting.</p>
    <div class="cup-bracket">${cols.join('')}</div>`;
}

/** Tabs boven de beker. */
function tabsHtml(tab) {
  const t = (k, l) => `<a href="#/stats/${CUP_ID}${k === 'rondes' ? '' : '/' + k}"${tab === k ? ' aria-current="page"' : ''}>${l}</a>`;
  return `<nav class="page-tabs" aria-label="Beker">${t('rondes', 'Rondes')}${t('schema', 'Schema')}${t('spelers', 'Spelers')}</nav>`;
}

/** Hele bekerpagina (zonder kop: die maakt het Stats-scherm, met de competitiekiezer). */
export async function cupHtml(season, tabArg) {
  const tab = ['schema', 'spelers'].includes(tabArg) ? tabArg : 'rondes';
  const all = await cupMatches(season);
  let body;
  if (tab === 'spelers') body = await import('./leaguestats.js').then((x) => x.leagueStatsHtml({ id: CUP_ID, name: 'KNVB Beker' }, season, 'spelers', { keepers: false }));
  else if (tab === 'schema') body = schemaHtml(all);
  else body = roundsHtml(all);
  return `<div data-cup>${tabsHtml(tab)}${tab === 'rondes' ? pathHtml(all) : ''}${body}</div>`;
}

/** Korte stand voor de competitiekiezer: "nog in de beker", "uitgeschakeld", ... */
export async function cupSub(season) {
  const all = await cupMatches(season).catch(() => []);
  const ours = all.filter((m) => isUs(m.homeTeam) || isUs(m.awayTeam));
  if (!all.length) return { sub: 'nog niet opgehaald', mine: false };
  if (!ours.length) return { sub: `${all.length} duels`, mine: false };
  const last = ours[ours.length - 1];
  const w = winnerOf(last); const side = isUs(last.homeTeam) ? 'home' : 'away';
  return { sub: !played(last) || w === side ? `${last.r.name}${w === side && last.r.n === 8 ? ' · gewonnen 🏆' : ''}` : `eruit in de ${last.r.name.toLowerCase()}`, mine: true };
}

// ---------- Interactie ----------
export function mountCup(root, ctx) {
  const box = root.querySelector('[data-cup]');
  if (!box) return;
  box.querySelectorAll('input[name="cup-round"]').forEach((r) => r.addEventListener('change', () => {
    box.querySelectorAll('[data-cup-round]').forEach((el) => { el.hidden = el.dataset.cupRound !== r.value; });
  }));
  if (box.querySelector('[name="ls-cat"], [data-ls-lineups]')) import('./leaguestats.js').then((x) => x.mountLeagueStats(root, ctx));
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-logo-pick]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    pickLogo(b.dataset.logoPick, b.dataset.logoName, ctx);
  });
}

/** Eigen logo kiezen voor een club (plaatje van je telefoon of pc), verkleind bewaard in clubs/{id}.logoOwn. */
export function pickLogo(id, name, ctx) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const img = await prepareImage(f);
      const url = img.thumb || img.small;
      if (!url || url.length > 200 * 1024) throw new Error('Dit plaatje is te groot voor een logo. Kies een kleiner bestand.');
      const marks = await getClubMarks().catch(() => ({}));
      const mark = { ...(marks[id] || {}), logoOwn: url, logoAt: new Date().toISOString() };
      await saveClubMarksBatch([[id, { logoOwn: url, logoAt: mark.logoAt }]]);
      setOne(id, mark);
      toast(`Logo van ${name} bewaard`);
      ctx.refresh();
    } catch (err) { toast(err.message || String(err)); }
  });
  input.click();
}
