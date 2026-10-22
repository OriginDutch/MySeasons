// Clubpagina vanuit de stand: positie, vorm en alle competitieduels van die club in het bekeken seizoen.
// Bronnen: Highlightly-competitiewedstrijden (leagueMatches), anders de RSSSF-basis; duels tegen
// Cambuur linken door naar je eigen wedstrijdpagina.

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getLeagueMatches, getStandings, getMeta, getClubMarks } from './store.js';
import { syncLeague, COST } from './sync.js';
import { correctedList, runWithButton, explain } from './matchviews.js';
import { getRsssf, rsssfStandings, mainDivision } from './rsssfimport.js';
import { getSeason, seasonLabel, isCurrentSeason } from './seasonstate.js';
import { mainLeague, sortByDate, dayShort, timeOf, shortRound } from './season.js';
import { tokens } from './rsssf.js';
import { bestStandings, regularOnly } from './livetable.js';
import { clubCode } from './clubnames.js';
import { leagueInfo } from './leagues.js';
import { loadPhotos, heroImg, galleryHtml, mountPhotos } from './photos.js';

let CUR_PH = null; // stadionfoto's van de geopende club

const TEAM = MAIN_CLUB.id;
const clean = (n) => String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const sameName = (a, b) => tokens(a).join(' ') === tokens(b).join(' ');

function crest(t, size = 24) {
  const txt = esc(clubCode(t));
  return t.logo
    ? `<img class="crest" src="${esc(t.logo)}" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'crest crest--txt',textContent:'${txt}'}))">`
    : `<span class="crest crest--txt" style="width:${size}px;height:${size}px">${txt}</span>`;
}

/** Eén vorm voor alle bronnen. */
function fromHighlightly(m) {
  return {
    date: m.date, round: m.round, status: m.status,
    home: m.homeTeam, away: m.awayTeam,
    hs: m.score ? m.score.home : null, as: m.score ? m.score.away : null,
    pen: m.penalties || null, id: m.id,
  };
}

function fromRsssf(m, idOf) {
  const h = clean(m.homeFull || m.home); const a = clean(m.awayFull || m.away);
  return {
    date: m.date ? `${m.date}T12:00:00Z` : null, dateOnly: true,
    round: m.round ? `Regular Season - ${m.round}` : m.label, status: m.status === 'played' ? 'finished' : m.status,
    home: { id: idOf(h), name: h, logo: null }, away: { id: idOf(a), name: a, logo: null },
    hs: m.hs, as: m.as, pen: m.penalties, stage: m.stage, note: m.note,
  };
}

function resultOf(row, teamId) {
  if (row.hs == null || row.as == null) return null;
  const home = String(row.home.id) === String(teamId);
  const gf = home ? row.hs : row.as; const ga = home ? row.as : row.hs;
  return gf > ga ? 'W' : gf < ga ? 'V' : 'G';
}

async function load(teamKey, leagueId = null) {
  const season = getSeason();
  const { list } = await correctedList();
  const rs = isCurrentSeason() ? null : await getRsssf(season).catch(() => null);
  const chosen = leagueId ? leagueInfo(leagueId) : null;
  const rsDiv = chosen ? (rs && rs.divisions ? rs.divisions.find((d) => d.leagueId === chosen.id) || null : null) : mainDivision(rs);
  const league = chosen ? { id: chosen.id, name: chosen.name } : (mainLeague(list) || (rsDiv && rsDiv.leagueId ? { id: rsDiv.leagueId, name: rsDiv.name } : null));
  if (!league) return { league: null };
  const standings = (await bestStandings(league.id, season)) || rsssfStandings(rs, league.id);
  const rows = standings && standings.groups && standings.groups[0] ? standings.groups[0].rows : [];
  const me = rows.find((r) => String(r.team.id) === teamKey) || null;
  const lmAll = await getLeagueMatches(league.id, season).catch(() => []);
  const lm = regularOnly(lmAll);
  const regIds = new Set(lm.map((m) => m.id));
  const poMatches = lmAll.filter((m) => !regIds.has(m.id) && [m.homeTeam, m.awayTeam].some((t) => t && String(t.id) === teamKey)).map(fromHighlightly).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const meta = await getMeta(`league_${league.id}_${season}`).catch(() => null);

  let team = me ? me.team : null;
  let matches = [];
  let source = null;
  if (lm.length) {
    source = 'highlightly';
    matches = lm.filter((m) => [m.homeTeam, m.awayTeam].some((t) => t && String(t.id) === teamKey)).map(fromHighlightly);
    if (!team) { const any = lm.find((m) => String(m.homeTeam.id) === teamKey) || lm.find((m) => String(m.awayTeam.id) === teamKey); if (any) team = String(any.homeTeam.id) === teamKey ? any.homeTeam : any.awayTeam; }
  } else if (rs && rsDiv && team) {
    source = 'rsssf';
    const idOf = (name) => {
      const row = rows.find((r) => sameName(r.team.name, name));
      return row ? row.team.id : `rs:${name}`;
    };
    matches = (rsDiv.matches || []).filter((m) => m.stage === 'regular' || m.stage === 'nacompetitie').map((m) => fromRsssf(m, idOf))
      .filter((m) => String(m.home.id) === teamKey || String(m.away.id) === teamKey);
  }
  // Duels tegen Cambuur uit je eigen data: altijd erbij, en doorklikbaar.
  const own = list.filter((m) => m.league && m.league.id === league.id && [m.homeTeam, m.awayTeam].some((t) => t && String(t.id) === teamKey));
  if (!source) { source = 'cambuur'; matches = own.map(fromHighlightly); }
  const ownIds = new Set(own.map((m) => m.id));
  if (!team && own.length) team = String(own[0].homeTeam.id) === teamKey ? own[0].homeTeam : own[0].awayTeam;
  // Logo's aanvullen uit Cambuur-data als een bron ze niet heeft.
  const logos = new Map();
  [...list, ...lm].forEach((m) => [m.homeTeam, m.awayTeam].forEach((t) => { if (t && t.logo) logos.set(String(t.id), t.logo); }));
  matches.forEach((m) => [m.home, m.away].forEach((t) => { if (!t.logo && logos.has(String(t.id))) t.logo = logos.get(String(t.id)); }));
  if (team && !team.logo && logos.has(teamKey)) team = { ...team, logo: logos.get(teamKey) };
  return { league, standings, me, team, matches: sortByDate(matches.filter((m) => m.date)), poMatches, source, meta, ownIds, rs };
}

function matchRow(m, teamKey, ownIds) {
  const home = String(m.home.id) === teamKey;
  const opp = home ? m.away : m.home;
  const r = resultOf(m, teamKey);
  const vsMe = String(opp.id) === String(TEAM) || String(teamKey) === String(TEAM);
  const link = m.id && ownIds.has(m.id) ? `#/wedstrijd/${m.id}` : null;
  const score = m.hs != null ? `${m.hs}–${m.as}${m.pen ? ' <span class="muted">(pen)</span>' : ''}` : m.status === 'finished' ? '' : (m.dateOnly ? '' : esc(timeOf(m.date)));
  const tag = link ? 'a' : 'div';
  return `<${tag} class="list-row club-row ${String(opp.id) === String(TEAM) ? 'is-me' : ''}" ${link ? `href="${link}"` : ''}>
    <span class="match-row__date mono">${esc(dayShort(m.date))}</span>
    <span class="list-row__main"><span class="list-row__title club-row__opp"><span class="club-row__at muted" aria-label="${home ? 'thuis' : 'uit'}">${home ? '' : '@'}</span>${crest(opp, 18)}<span>${esc(opp.name)}</span></span>
      <span class="list-row__sub">${esc(m.stage === 'nacompetitie' ? 'Nacompetitie' : shortRound(m.round))}${m.status && !['finished', 'scheduled'].includes(m.status) ? ' · ' + esc(m.status) : ''}${vsMe && link && String(teamKey) !== String(TEAM) ? ' · jouw wedstrijd' : ''}</span></span>
    <span class="match-row__end mono">${score} ${r ? `<span class="result result--${r}">${r}</span>` : ''}</span>
  </${tag}>`;
}

export const clubViews = {
  club: {
    title: 'Club',
    navKey: 'stats',
    async render(ctx, args) {
      const teamKey = decodeURIComponent(args[0] || '');
      const d = await load(teamKey, args[1] || null);
      const back = `<a class="back-btn" href="#/stats${args[1] ? `/${encodeURIComponent(args[1])}` : ''}" aria-label="Terug">${icons.back}</a>`;
      if (!d.league || !d.team) {
        return `<header class="page-head"><div class="page-head__titles">${back}<span class="page-head__kicker">Stand</span><h1 class="page-head__title">Club</h1></div></header>
          <section class="section"><p class="muted">Deze club staat niet in de stand van ${esc(seasonLabel())}.</p></section>`;
      }
      const t = d.team;
      const marks = await getClubMarks().catch(() => ({}));
      const mark = marks[teamKey] || null;
      const stadiumKey = t.id != null ? String(t.id) : teamKey;
      const stadiumGal = (marks[stadiumKey] || {}).stadiumGallery || null;
      CUR_PH = await loadPhotos('stadium', stadiumKey, stadiumGal);
      const stadiumHero = heroImg(CUR_PH.photos, stadiumGal, getSeason(), null, 'stadium-hero');
      const played = d.matches.filter((m) => m.hs != null);
      const upcoming = d.matches.filter((m) => m.hs == null && m.status !== 'finished');
      const form = played.slice(-5).map((m) => resultOf(m, teamKey));
      const line = d.me ? d.me.total : null;
      const fetchBtn = isCurrentSeason() || d.source !== 'rsssf'
        ? `<button class="btn btn--sm" type="button" data-sync-league="${d.league.id}">${icons.refresh}<span>${d.source === 'highlightly' ? 'Bijwerken' : `Alle ${esc(d.league.name)}-wedstrijden ophalen`} · ~${COST.league} calls</span></button>` : '';
      return `
        <header class="page-head"><div class="page-head__titles">${back}
          <span class="page-head__kicker">${esc(d.league.name)} · ${esc(seasonLabel())}</span>
          <h1 class="page-head__title club-head">${crest(t, 36)}<span>${esc(t.name)}</span></h1></div></header>
        <section class="section">
          <div class="stat-row">
            <div>${d.me ? `<span class="big-num">${d.me.position}<span class="ordinal">e</span></span> <span class="big-num big-num--sub">${d.me.points}</span><span class="muted"> pt</span>` : ''}</div>
            ${line ? `<div class="mono">${line.w}–${line.d}–${line.l}<br><span class="muted">${line.gf}:${line.ga}</span></div>` : ''}
            ${form.length ? `<div class="form">${form.map((r) => `<span class="form__tile form__tile--${r}">${r}</span>`).join('')}</div>` : ''}
          </div>
          ${mark && (mark.mark || mark.note) ? `<p class="muted" style="font-size:var(--fs-md);margin:0">${mark.mark === 'rivaal' ? '<strong class="accent-text">Rivaal</strong>' : mark.mark === 'interessant' ? '★ Interessant' : ''}${mark.note ? `${mark.mark ? ' · ' : ''}${esc(mark.note)}` : ''}</p>` : ''}
          ${d.me && d.me.deduction ? `<p class="warn-line">${d.me.deduction} punten in mindering gebracht</p>` : ''}
          <p style="font-size:var(--fs-sm);margin:0"><a class="muted" href="#/clubnamen/${encodeURIComponent(String(t.id))}">Naam aanpassen${t.apiName && t.apiName !== t.name ? ` · Highlightly: ${esc(t.apiName)}` : ''}</a></p>
        </section>
        <section class="section"><div class="section__label"><span>Stadion</span><span>${CUR_PH.photos.length ? CUR_PH.photos.length : ''}</span></div>
          ${stadiumHero || '<p class="muted" style="font-size:var(--fs-md);margin:0">Nog geen stadionfoto.</p>'}
          <div><button class="btn btn--sm" type="button" data-photo-add>Stadionfoto toevoegen</button></div></section>
        ${galleryHtml(CUR_PH.photos, stadiumGal, { title: "Stadionfoto's" })}
        ${upcoming.length ? `<section class="section"><div class="section__label"><span>Programma</span><span>${upcoming.length}</span></div>
          <div class="list">${upcoming.map((m) => matchRow(m, teamKey, d.ownIds)).join('')}</div></section>` : ''}
        <section class="section"><div class="section__label"><span>Gespeeld</span><span>${played.length}</span></div>
          ${played.length ? `<div class="list">${played.slice().reverse().map((m) => matchRow(m, teamKey, d.ownIds)).join('')}</div>` : '<p class="muted" style="font-size:var(--fs-md)">Nog geen uitslagen.</p>'}
        </section>
        ${(d.poMatches || []).length ? `<section class="section"><div class="section__label"><span>Na de competitie</span><span>${d.poMatches.length}</span></div>
          <div class="list">${d.poMatches.map((m) => matchRow(m, teamKey, d.ownIds)).join('')}</div>
          <p style="font-size:var(--fs-sm);margin:0"><a class="muted" href="#/stats/nacompetitie">Hele nacompetitie</a> · <a class="muted" href="#/stats/europa">Play-offs Europa</a></p></section>` : ''}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-sm)">${d.source === 'highlightly' ? `Alle competitieduels via Highlightly${d.meta ? ` · bijgewerkt ${esc(dayShort(d.meta.fetchedAt))} ${esc(timeOf(d.meta.fetchedAt))}` : ''}.`
            : d.source === 'rsssf' ? esc(d.rs.credit) + '.'
            : `Je ziet nu alleen de duels tegen ${esc(MAIN_CLUB.name)}. Haal alle ${esc(d.league.name)}-wedstrijden op om het hele seizoen van deze club te zien.`}</p>
          ${fetchBtn ? `<div>${fetchBtn}</div>` : ''}
        </section>`;
    },
    mount(root, ctx) {
      mountPhotos(root, ctx, () => CUR_PH);
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-sync-league]');
        if (!btn) return;
        try {
          const r = await runWithButton(btn, 'Ophalen…', () => syncLeague(Number(btn.dataset.syncLeague)));
          toast(`${r.count} wedstrijden opgehaald · ${r.calls} calls`);
          ctx.refresh();
        } catch (err) { toast(explain(err)); }
      });
    },
  },
};
