// Home als clubmagazine: te-doen, voorbeschouwing, verhalen, vorige week, seizoen.

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getSeason, isCurrentSeason, seasonLabel } from './seasonstate.js';
import { getMeta, getCallsToday, getStandings, getLeagueMatches } from './store.js';
import { COST } from './sync.js';
import {
  correctedList, resultChip, crest, devBar, syncFooter, handleSync, handleFetch, scoreText, compName, matchTitle,
} from './matchviews.js';
import { preview, seasonStories, matchReport } from './stories.js';
import { buildSquad } from './players.js';
import { refreshNews, newsFor } from './news.js';
import { standingsAndMatches } from './livetable.js';
import { rulesFor, zonesFor, cupWinner } from './rules.js';
import { miniStand } from './standview.js';
import { bellButton, unreadCount } from './inbox.js';
import { getRsssf, rsssfStandings, mainDivision } from './rsssfimport.js';
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

function masthead(team, league, unread = null) {
  return `
    <header class="mast">
      <button class="mast__club mast__btn" type="button" data-open-season aria-label="Club of seizoen wisselen">
        <span class="mast__crest">${team.logo ? crest(team, 30) : esc(MAIN_CLUB.short)}</span>
        <span class="mast__titles"><span class="mast__name">${esc(MAIN_CLUB.name)} <svg class="mast__chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span>
        <span class="mast__sub mono">${league ? esc(league.id === 76523 ? 'KKD' : league.name) + ' · ' : ''}${esc(seasonLabel())}</span></span>
      </button>
      <span class="mast__end"><span class="mast__date mono">${esc(today())}</span>${unread != null ? bellButton(unread) : ''}</span>
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

// ---------- Countdown op wedstrijddag ----------
const MATCH_MS = 2 * 3600e3; // aftrap + ~2 uur = afgelopen

/** { state: 'far'|'soon'|'close'|'live'|'done', text } voor een aftrap. */
export function countdown(iso, now = Date.now()) {
  const diff = Date.parse(iso) - now;
  if (diff > 24 * 3600e3) return { state: 'far', text: '' };
  if (diff > 3600e3) {
    const h = Math.floor(diff / 3600e3); const m = Math.floor((diff % 3600e3) / 60e3);
    return { state: 'soon', text: `Nog ${h} u ${String(m).padStart(2, '0')} min` };
  }
  if (diff > 0) {
    const m = Math.max(1, Math.ceil(diff / 60e3));
    return { state: 'close', text: m === 1 ? 'Over 1 minuut!' : `Over ${m} minuten!` };
  }
  if (-diff < MATCH_MS) return { state: 'live', text: 'Bezig' };
  return { state: 'done', text: 'Afgelopen' };
}

function countdownChip(next) {
  const c = countdown(next.date);
  if (c.state === 'far') return '';
  return `<span class="cover__count cover__count--${c.state} mono" data-countdown="${esc(next.date)}" data-state="${c.state}">${c.state === 'live' ? '<i class="live-dot"></i>' : ''}${esc(c.text)}</span>`;
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
        ${countdownChip(next)}
      </div>
      <div class="cover__band">
        <span class="cover__kicker mono">${esc(when)} · ${esc(compName(next))}${esc(round)} · ${isHome(next, TEAM) ? 'thuis' : 'uit'}</span>
        <h2 class="cover__title">${esc(p.title)}</h2>
        ${p.sub ? `<p class="cover__sub">${esc(p.sub)}</p>` : ''}
      </div>
    </a>`;
}

function seasonCover(list, league, standings, team) {
  if (!league) return '';
  const g = standings && standings.groups && standings.groups[0];
  const me = g ? g.rows.find((r) => r.team.id === TEAM) : null;
  const ls = leagueSummary(list, TEAM, league.id);
  const s = !ls.played && me ? { ...me.total, points: me.points } : ls;
  const done = s.played && !list.some((m) => m.league && m.league.id === league.id && m.status !== 'finished');
  const title = me ? `${me.position}e in de ${league.id === 76523 ? 'KKD' : league.name}` : `${MAIN_CLUB.name} in de ${league.name}`;
  return `
    <div class="cover">
      <div class="cover__photo" style="height:150px"><div class="cover__crests">${crest(team, 64)}</div><span class="cover__tag">Seizoensverslag</span></div>
      <div class="cover__band">
        <span class="cover__kicker mono">${esc(league.name)} · ${esc(seasonLabel())}${done ? ' · eindstand' : ''}</span>
        <h2 class="cover__title">${esc(title)}</h2>
        <p class="cover__sub">${s.played} duels · ${s.w} winst, ${s.d} gelijk, ${s.l} verlies · ${s.gf}:${s.ga}${me ? ` · ${me.points} punten` : ''}</p>
      </div>
    </div>`;
}

/** Alleen op desktop: stand rond de eigen club, met zones uit de regelmotor. */
function standSide(standings, league, leagueMatches, cup) {
  const g = standings && standings.groups && standings.groups[0];
  if (!g || !league) return '';
  const rules = isCurrentSeason() ? rulesFor(league.id, getSeason()) : null;
  const zones = rules ? zonesFor(rules, g.rows, { matches: leagueMatches || [], cup }) : null;
  return `
    <section class="mag-section desk-only">
      <div class="mag-section__head"><h2>Stand</h2><span class="mono muted">${esc(league.name)}</span></div>
      ${miniStand(standings, zones)}
      <div><a class="link-btn" href="#/stats">Hele stand</a></div>
    </section>`;
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
          <span class="mono report__score">${esc(rep.scoreLine)} ${resultChip(m)}</span>
        </div>
      </a>
      ${rep.needsDetail ? `<div><button class="btn" type="button" data-action="fetch-match" data-id="${m.id}">Details ophalen voor het verhaal · ${COST.match} calls</button></div>` : ''}
    </section>`;
}

export function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'net';
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gisteren' : d < 7 ? `${d} dagen geleden` : dayShort(iso);
}

/** Alle clubs uit je programma: Cambuur plus elke tegenstander. */
export function knownTeams(list) {
  const map = new Map();
  list.forEach((m) => [m.homeTeam, m.awayTeam].forEach((t) => { if (t && t.id) map.set(t.id, { id: t.id, name: t.name }); }));
  if (!map.has(TEAM)) map.set(TEAM, { id: TEAM, name: MAIN_CLUB.name });
  return [...map.values()];
}

export function newsItem(n, teams) {
  const tags = n.clubs.map((id) => (teams.find((t) => t.id === id) || {}).name).filter(Boolean);
  return `<a class="news-item" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
    <span class="news-item__title">${esc(n.title)}</span>
    ${n.teaser ? `<span class="news-item__teaser muted">${esc(n.teaser)}</span>` : ''}
    <span class="news-item__meta mono muted">${esc(ago(n.date))} · ${esc(tags.join(', '))} · lees op vi.nl ↗</span>
  </a>`;
}

let newsUnavailable = false;

function newsBlock(items, teams) {
  if (!items.length) {
    return `
      <section class="mag-section" data-news>
        <div class="mag-section__head"><h2>Nieuws</h2><span class="mono muted">via VI</span></div>
        <p class="muted" style="font-size:13px">${newsUnavailable
          ? 'Nieuws komt zodra de Worker is bijgewerkt met de nieuwe code.'
          : `Nog geen VI-nieuws over ${esc(MAIN_CLUB.name)} of de volgende tegenstander gezien. De app kijkt elk kwartier.`}</p>
        <div><a class="link-btn" href="#/nieuws">Al het nieuws</a></div>
      </section>`;
  }
  return `
    <section class="mag-section" data-news>
      <div class="mag-section__head"><h2>Nieuws</h2><span class="mono muted">via VI</span></div>
      <div class="news-list">${items.map((n) => newsItem(n, teams)).join('')}</div>
      <div><a class="link-btn" href="#/nieuws">Meer nieuws</a></div>
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
      <div class="strip" style="--half:${Math.ceil(games.length / 2)}">${games.map((m) => {
        const r = resultFor(m, TEAM);
        const opp = opponentOf(m, TEAM);
        const home = isHome(m, TEAM);
        const short = opp ? opp.name.replace(/^(FC|SC|sc|SV|AFC|Jong)\s+/, '').slice(0, 3).toUpperCase() : '?';
        const score = m.status === 'finished' && m.score ? `${home ? m.score.home : m.score.away}–${home ? m.score.away : m.score.home}` : '';
        return `<a class="strip__tile strip__tile--${r || 'open'}" href="#/wedstrijd/${m.id}" title="${matchTitle(m)}">
          <span class="mono strip__res">${r || '·'}</span><span class="mono strip__rd">${esc(shortRound(m.round).replace(/^R/, '') || '')}</span>
          <span class="strip__opp mono" aria-hidden="true">${home ? '' : '@'}${esc(short)}</span>${score ? `<span class="strip__score mono" aria-hidden="true">${score}</span>` : ''}
          <span class="visually-hidden">${esc(opp ? opp.name : '')}</span></a>`;
      }).join('')}</div>
      <div class="strip__links"><span class="muted" style="font-size:12px">Tik op een ronde voor de wedstrijd.</span><a class="link-btn" href="#/stats">Stand</a></div>
    </section>`;
}

export const magazineViews = {
  home: {
    title: 'Home',
    async render() {
      const [{ list, total, conflicts, profiles }, meta, calls] = await Promise.all([correctedList(), getMeta(`sync_${getSeason()}`).then((m) => m || (isCurrentSeason() ? getMeta('sync') : null)), getCallsToday()]);
      const team = clubTeam(list);
      if (!list.length && !isCurrentSeason()) {
        const rs0 = await getRsssf(getSeason()).catch(() => null);
        const d0 = mainDivision(rs0);
        const lg0 = d0 && d0.leagueId ? { id: d0.leagueId, name: d0.name } : null;
        if (lg0) {
          return `<div class="mag">${masthead(team, lg0)}${seasonCover(list, lg0, rsssfStandings(rs0, lg0.id), team)}
            <section class="mag-section"><p class="muted" style="font-size:13px;margin:0">Dit seizoen heeft alleen de RSSSF-basis: eindstand en uitslagen. Schutters, opstellingen en spelersstats komen van Highlightly (Meer → Seizoenen → Ophalen) of 's nachts.</p>
            <div><a class="link-btn" href="#/stats">Eindstand</a></div><p class="muted" style="font-size:11px">${esc(rs0.credit)}</p></section></div>`;
        }
      }
      if (!list.length) {
        return `${masthead(team, null)}
          <section class="section"><div class="empty">
            <span class="empty__title">Haal je seizoen op</span>
            <p class="muted">Eén keer synchroniseren haalt het hele programma en alle uitslagen van dit seizoen op. Dat kost ${COST.season} van je 100 API-calls van vandaag.</p>
            <div><button class="btn btn--primary" type="button" data-action="sync-season">${icons.refresh}<span>Seizoen ophalen · ${COST.season} calls</span></button></div>
          </div></section>`;
      }
      const rs = isCurrentSeason() ? null : await getRsssf(getSeason()).catch(() => null);
      const rsDiv = mainDivision(rs);
      const league = mainLeague(list) || (rsDiv && rsDiv.leagueId ? { id: rsDiv.leagueId, name: rsDiv.name } : null);
      const both = league ? await standingsAndMatches(league.id, getSeason()) : { standings: null, matches: [] };
      const standings = league ? (both.standings || rsssfStandings(rs, league.id)) : null;
      const next = nextMatch(list);
      const last = lastMatch(list);
      const { players } = buildSquad(list, TEAM, profiles);
      const topScorer = players.slice().sort((a, b) => b.goals - a.goals)[0] || null;
      const crowd = league ? crowdSummary(list, TEAM, league.id) : {};
      const rulesNow = league && isCurrentSeason() ? rulesFor(league.id, getSeason()) : null;
      const cupNow = rulesNow && rulesNow.cup ? cupWinner([...(await getLeagueMatches(rulesNow.cup.leagueId, getSeason()).catch(() => [])), ...list.filter((m) => m.league && m.league.id === rulesNow.cup.leagueId)]) : null;
      const stories = seasonStories(list, league, standings, { topScorer, homeAvg: crowd.homeAvg, homeCount: crowd.homeCount, season: getSeason(), current: isCurrentSeason(), leagueMatches: both.matches, cup: cupNow });
      const teams = knownTeams(list);
      const nextOpp = next ? opponentOf(next, TEAM) : null;
      const news = await newsFor([TEAM, ...(nextOpp ? [nextOpp.id] : [])], 3).catch(() => []);
      this._teams = teams;
      this._focus = [TEAM, ...(nextOpp ? [nextOpp.id] : [])];
      return `
        <div class="mag">
          ${masthead(team, league, await unreadCount({ list, profiles, conflicts }).catch(() => null))}
          ${conflicts ? `<div class="mag-pad">${devBar(total, conflicts, '#/afwijkingen')}</div>` : ''}
          <div class="mag-main">
          ${todoCard(last)}
          ${isCurrentSeason() ? cover(next, preview(next, list, league, standings)) : seasonCover(list, league, standings, team)}
          ${isCurrentSeason() && next && countdown(next.date).state === 'done' ? `<div class="mag-pad"><p class="muted" style="font-size:13px;margin:0 0 8px">${matchTitle(next)} is afgelopen. Haal de uitslag op:</p><button class="btn btn--primary" type="button" data-action="sync-season">${icons.refresh}<span>Uitslag ophalen · ${COST.season} calls</span></button></div>` : ''}
          ${storiesRow(stories)}
          ${lastWeek(last, matchReport(last))}
          </div>
          <aside class="mag-side">
          ${standSide(standings, league, both.matches, cupNow)}
          ${newsBlock(news, teams)}
          </aside>
          <div class="mag-full">
          ${seasonStrip(list, league, standings)}
          <div class="mag-pad">${syncFooter(meta, calls)}</div>
          </div>
        </div>`;
    },
    mount(root, ctx) {
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'sync-season') handleSync(btn, ctx);
        if (btn.dataset.action === 'fetch-match') handleFetch(btn, ctx, btn.dataset.id);
      });
      // Countdown laten aftellen; bij een nieuwe fase (bijv. van 'bezig' naar 'afgelopen') het scherm verversen.
      const chip = root.querySelector('[data-countdown]');
      if (chip) {
        const timer = setInterval(() => {
          if (!chip.isConnected) { clearInterval(timer); return; }
          const c = countdown(chip.dataset.countdown);
          if (c.state !== chip.dataset.state) { clearInterval(timer); ctx.refresh(); return; }
          chip.innerHTML = `${c.state === 'live' ? '<i class="live-dot"></i>' : ''}${esc(c.text)}`;
        }, 15000);
      }
      // Nieuws op de achtergrond verversen (hooguit eens per kwartier).
      if (this._teams && root.querySelector('[data-news]')) {
        refreshNews(this._teams, { focus: this._focus }).then((r) => {
          if (r.error && r.error.status === 404) { if (!newsUnavailable) { newsUnavailable = true; ctx.refresh(); } return; }
          if (r.fetched && r.found) ctx.refresh();
        });
      }
    },
  },
};

const NEWS_FILTERS = [['club', MAIN_CLUB.name], ['all', 'Alle clubs']];

magazineViews.nieuws = {
  title: 'Nieuws',
  navKey: 'home',
  async render() {
    const { list } = await correctedList();
    const teams = knownTeams(list);
    const all = await newsFor(teams.map((t) => t.id), 200).catch(() => []);
    const mine = all.filter((n) => n.clubs.includes(TEAM));
    const head = `<header class="page-head"><div class="page-head__titles">
      <a class="back-btn" href="#/home" aria-label="Terug">${icons.back}</a>
      <span class="page-head__kicker">Home / Nieuws · via VI</span><h1 class="page-head__title">Nieuws</h1></div>
      <button class="btn" type="button" data-action="news-refresh">${icons.refresh}<span>Ververs</span></button></header>`;
    return `${head}
      <section class="section">
        <div class="chips" role="radiogroup">${NEWS_FILTERS.map(([v, l], i) => `<label class="chip"><input type="radio" name="news-f" value="${v}" ${i === 0 ? 'checked' : ''}><span>${esc(l)} <span class="mono">${v === 'club' ? mine.length : all.length}</span></span></label>`).join('')}</div>
        <p class="muted" style="font-size:12px">Alleen kop en teaser; het artikel lees je op vi.nl. Bewaard wordt alleen nieuws over clubs uit je programma.</p>
      </section>
      <section class="section">
        <div class="news-list" data-news-list="club">${mine.length ? mine.map((n) => newsItem(n, teams)).join('') : '<p class="muted">Nog niets bewaard.</p>'}</div>
        <div class="news-list" data-news-list="all" hidden>${all.length ? all.map((n) => newsItem(n, teams)).join('') : '<p class="muted">Nog niets bewaard.</p>'}</div>
      </section>`;
  },
  mount(root, ctx) {
    root.querySelectorAll('input[name="news-f"]').forEach((i) => i.addEventListener('change', () => {
      root.querySelectorAll('[data-news-list]').forEach((el) => { el.hidden = el.dataset.newsList !== i.value; });
    }));
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action="news-refresh"]');
      if (!btn) return;
      btn.disabled = true;
      const { list } = await correctedList();
      const next = nextMatch(list);
      const opp = next ? opponentOf(next, TEAM) : null;
      const r = await refreshNews(knownTeams(list), { force: true, focus: [TEAM, ...(opp ? [opp.id] : [])] });
      btn.disabled = false;
      if (r.error) toast(r.error.status === 404 ? 'De Worker kent /news/vi nog niet. Plak eerst de nieuwe Worker-code.' : `Nieuws ophalen lukte niet: ${r.error.message}`);
      else toast(r.found ? `${r.found} berichten gevonden, waarvan ${r.mine} over ${MAIN_CLUB.name}` : 'Niets nieuws over je clubs');
      ctx.refresh();
    });
  },
};
