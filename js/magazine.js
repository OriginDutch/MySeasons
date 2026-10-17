// Home als clubmagazine: te-doen, voorbeschouwing, verhalen, vorige week, seizoen.

import { esc, icons } from './ui.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import { getMeta, getCallsToday, getStandings } from './store.js';
import { COST } from './sync.js';
import {
  correctedList, crest, devBar, syncFooter, handleSync, handleFetch, scoreText, compName, matchTitle,
} from './matchviews.js';
import { preview, seasonStories, matchReport } from './stories.js';
import { buildSquad } from './players.js';
import {
  sortByDate, resultFor, opponentOf, isHome, mainLeague, leagueSummary, nextMatch, lastMatch,
  dayShort, timeOf, relativeDay, shortRound, crowdSummary,
} from './season.js';

const TEAM = MAIN_CLUB.id;
const today = () => dayShort(new Date().toISOString());

function clubTeam(list) {
  for (const m of list) {
    if (m.homeTeam && m.homeTeam.id === TEAM) return m.homeTeam;
    if (m.awayTeam && m.awayTeam.id === TEAM) return m.awayTeam;
  }
  return { id: TEAM, name: MAIN_CLUB.name, logo: null };
}

function masthead(team) {
  return `
    <header class="mast">
      <div class="mast__club">
        <span class="mast__crest">${team.logo ? crest(team, 30) : esc(MAIN_CLUB.short)}</span>
        <h1 class="mast__name">${esc(MAIN_CLUB.name)}</h1>
      </div>
      <span class="mast__date mono">${esc(today())}</span>
    </header>`;
}

function todoCard(m) {
  if (!m || m.status !== 'finished') return '';
  const n = m.notes || {};
  if (n.attendance != null || n.awayFans != null || n.note) return '';
  if ((Date.now() - Date.parse(m.date)) / 864e5 > 10) return '';
  return `
    <section class="todo">
      <div class="todo__line"><span class="todo__dot"></span><strong>${matchTitle(m)} ${esc(scoreText(m).replace(/<[^>]+>/g, ''))} aanvullen</strong></div>
      <span class="muted" style="font-size:12px">Toeschouwers en je notitie ontbreken nog</span>
      <div><a class="btn btn--primary btn--pill" href="#/wedstrijd/${m.id}">Aanvullen</a></div>
    </section>`;
}

function cover(next, p) {
  if (!next || !p) return '';
  const rel = relativeDay(next.date);
  const when = rel ? rel[0].toUpperCase() + rel.slice(1) : dayShort(next.date);
  const round = next.round && !/friendl/i.test(next.round) ? ' ' + shortRound(next.round) : '';
  return `
    <a class="cover" href="#/wedstrijd/${next.id}">
      <div class="cover__photo">
        <div class="cover__crests">${crest(next.homeTeam, 64)}<span class="cover__vs">vs</span>${crest(next.awayTeam, 64)}</div>
        <span class="cover__tag">${p.cup ? 'Beker' : 'Voorbeschouwing'}</span>
        <span class="cover__time mono">${esc(timeOf(next.date))}</span>
      </div>
      <div class="cover__band">
        <span class="cover__kicker mono">${esc(when)} · ${esc(compName(next))}${esc(round)} · ${isHome(next, TEAM) ? 'thuis' : 'uit'}</span>
        <h2 class="cover__title">${esc(p.title)}</h2>
        ${p.sub ? `<p class="cover__sub">${esc(p.sub)}</p>` : ''}
      </div>
    </a>`;
}

function storiesRow(stories) {
  if (!stories.length) return '';
  return `
    <section class="stories">
      <div class="stories__head mono"><span>Verhalen</span><span>${stories.length > 1 ? 'veeg →' : ''}</span></div>
      <div class="stories__track">${stories.map((s) => `
        <div class="story"><span class="story__label mono">${esc(s.label)}</span>
          <span class="story__fig">${esc(s.fig)}</span><span class="story__text">${esc(s.text)}</span></div>`).join('')}
      </div>
    </section>`;
}

function lastWeek(m, rep) {
  if (!m || !rep) return '';
  return `
    <section class="mag-section">
      <div class="mag-section__head"><h2>Vorige week</h2><span class="mono muted">${esc(dayShort(m.date))}</span></div>
      <a class="report" href="#/wedstrijd/${m.id}">
        <div class="report__photo">${rep.hero && rep.hero.number != null
          ? `<span class="report__num">${rep.hero.number}</span><span class="report__who mono">${esc(rep.hero.name)}</span>`
          : `${crest(opponentOf(m, TEAM), 44)}`}</div>
        <div class="report__body">
          <span class="report__title">${esc(rep.title)}</span>
          ${rep.sub ? `<span class="report__sub muted">${esc(rep.sub)}</span>` : ''}
          <span class="mono report__score">${esc(rep.scoreLine)} <span class="result result--${resultFor(m, TEAM)}">${resultFor(m, TEAM)}</span></span>
        </div>
      </a>
      ${rep.needsDetail ? `<div><button class="btn" type="button" data-action="fetch-match" data-id="${m.id}">Details ophalen voor het verhaal · ${COST.match} calls</button></div>` : ''}
    </section>`;
}

function seasonStrip(list, league, standings) {
  if (!league) return '';
  const s = leagueSummary(list, TEAM, league.id);
  const games = sortByDate(list.filter((m) => m.league && m.league.id === league.id));
  if (!games.length) return '';
  const g = standings && standings.groups && standings.groups[0];
  const me = g ? g.rows.find((r) => r.team.id === TEAM) : null;
  return `
    <section class="mag-section">
      <div class="mag-section__head"><h2>Seizoen</h2><span class="mono muted">${me ? `${me.position}e · ` : ''}${me ? me.points : s.points} pt · ${s.w}–${s.d}–${s.l} · ${s.gf}:${s.ga}</span></div>
      <div class="strip">${games.map((m) => {
        const r = resultFor(m, TEAM);
        const opp = opponentOf(m, TEAM);
        return `<a class="strip__tile strip__tile--${r || 'open'}" href="#/wedstrijd/${m.id}" title="${matchTitle(m)}">
          <span class="mono strip__res">${r || '·'}</span><span class="mono strip__rd">${esc(shortRound(m.round).replace(/^R/, '') || '')}</span>
          <span class="visually-hidden">${esc(opp ? opp.name : '')}</span></a>`;
      }).join('')}</div>
      <div class="strip__links"><span class="muted" style="font-size:12px">Tik op een ronde voor de wedstrijd.</span><a class="link-btn" href="#/stats">Stand</a></div>
    </section>`;
}

export const magazineViews = {
  home: {
    title: 'Home',
    async render() {
      const [{ list, total, conflicts, profiles }, meta, calls] = await Promise.all([correctedList(), getMeta('sync'), getCallsToday()]);
      const team = clubTeam(list);
      if (!list.length) {
        return `${masthead(team)}
          <section class="section"><div class="empty">
            <span class="empty__title">Haal je seizoen op</span>
            <p class="muted">Eén keer synchroniseren haalt het hele programma en alle uitslagen van dit seizoen op. Dat kost ${COST.season} van je 100 API-calls van vandaag.</p>
            <div><button class="btn btn--primary" type="button" data-action="sync-season">${icons.refresh}<span>Seizoen ophalen · ${COST.season} calls</span></button></div>
          </div></section>`;
      }
      const league = mainLeague(list);
      const standings = league ? await getStandings(league.id, CURRENT_SEASON) : null;
      const next = nextMatch(list);
      const last = lastMatch(list);
      const { players } = buildSquad(list, TEAM, profiles);
      const topScorer = players.slice().sort((a, b) => b.goals - a.goals)[0] || null;
      const crowd = league ? crowdSummary(list, TEAM, league.id) : {};
      const stories = seasonStories(list, league, standings, { topScorer, homeAvg: crowd.homeAvg, homeCount: crowd.homeCount });
      return `
        <div class="mag">
          ${masthead(team)}
          ${conflicts ? `<div class="mag-pad">${devBar(total, conflicts, '#/afwijkingen')}</div>` : ''}
          ${todoCard(last)}
          ${cover(next, preview(next, list, league, standings))}
          ${storiesRow(stories)}
          ${lastWeek(last, matchReport(last))}
          ${seasonStrip(list, league, standings)}
          <div class="mag-pad">${syncFooter(meta, calls)}</div>
        </div>`;
    },
    mount(root, ctx) {
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'sync-season') handleSync(btn, ctx);
        if (btn.dataset.action === 'fetch-match') handleFetch(btn, ctx, btn.dataset.id);
      });
    },
  },
};
