// Schermen met wedstrijddata: Home, Wedstrijden en de wedstrijdpagina.

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB, SYNC_SUGGEST_DAYS } from './config.js';
import { getAllMatches, getMatch, getMeta, getCallsToday } from './store.js';
import { syncSeason, fetchMatch, COST } from './sync.js';
import {
  sortByDate, resultFor, opponentOf, isHome, mainLeague, leagueSummary, nextMatch, lastMatch,
  dayShort, dayLong, timeOf, monthOf, relativeDay, shortRound,
} from './season.js';

const TEAM = MAIN_CLUB.id;

// ---------- Bouwstenen ----------

function crest(t, size = 28) {
  if (!t) return '';
  const fallback = esc((t.name || '?').slice(0, 3).toUpperCase());
  return t.logo
    ? `<img class="crest" src="${esc(t.logo)}" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'crest crest--txt',textContent:'${fallback}'}))">`
    : `<span class="crest crest--txt" style="width:${size}px;height:${size}px">${fallback}</span>`;
}

function head({ kicker, title, back, action }) {
  return `
    <header class="page-head">
      <div class="page-head__titles">
        ${back ? `<a class="back-btn" href="#/${esc(back)}" aria-label="Terug">${icons.back}</a>` : ''}
        <span class="page-head__kicker">${esc(kicker)}</span>
        <h1 class="page-head__title">${esc(title)}</h1>
      </div>
      ${action || ''}
    </header>`;
}

function compName(m) {
  if (!m.league) return '';
  return /friendl/i.test(m.league.name) ? 'Oefenwedstrijd' : m.league.name;
}

function matchTitle(m) {
  return `${esc(m.homeTeam ? m.homeTeam.name : '?')} – ${esc(m.awayTeam ? m.awayTeam.name : '?')}`;
}

function scoreText(m) {
  if (!m.score) return '';
  const pen = m.penalties ? ` <span class="muted">(${m.penalties.home}–${m.penalties.away} pen.)</span>` : '';
  return `${m.score.home}–${m.score.away}${pen}`;
}

const syncButton = (label = 'Synchroniseren') =>
  `<button class="btn" type="button" data-action="sync-season">${icons.refresh}<span>${esc(label)}</span></button>`;

async function runWithButton(btn, busyText, work) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span>${esc(busyText)}</span>`;
  try {
    return await work();
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

function explain(err) {
  if (err && err.status === 429) return 'Je API-quotum voor vandaag is op. Morgen weer.';
  if (err && err.status === 0) return 'Geen verbinding met de Worker. Ben je online?';
  return (err && err.message) || 'Onbekende fout';
}

async function handleSync(btn, ctx) {
  try {
    const n = await runWithButton(btn, 'Bezig…', () => syncSeason());
    toast(`${n} wedstrijden bijgewerkt · ${COST.season} calls`);
    ctx.refresh();
  } catch (err) {
    toast(explain(err));
  }
}

async function handleFetch(btn, ctx, id) {
  try {
    await runWithButton(btn, 'Ophalen…', () => fetchMatch(id));
    toast(`Wedstrijd opgehaald · ${COST.match} calls`);
    ctx.refresh();
  } catch (err) {
    toast(explain(err));
  }
}

// ---------- Home ----------

function nextBlock(m) {
  if (!m) return '<p class="muted">Geen komende wedstrijden in het programma.</p>';
  const opp = opponentOf(m, TEAM);
  const rel = relativeDay(m.date);
  return `
    <a class="match-hero" href="#/wedstrijd/${m.id}">
      <div class="match-hero__teams">
        ${crest(m.homeTeam, 40)}<span class="match-hero__vs mono">${esc(timeOf(m.date))}</span>${crest(m.awayTeam, 40)}
      </div>
      <span class="match-hero__title">${matchTitle(m)}</span>
      <span class="muted">${rel ? `<strong class="accent-text">${esc(rel[0].toUpperCase() + rel.slice(1))}</strong> · ` : ''}${esc(dayLong(m.date))} · ${isHome(m, TEAM) ? 'thuis' : 'uit'} tegen ${esc(opp ? opp.name : '?')}</span>
    </a>`;
}

function scorers(m) {
  if (!m.detail) return '';
  const goals = m.detail.events.filter((e) => /goal/i.test(e.type) && !/missed/i.test(e.type));
  if (!goals.length) return '';
  return `<ul class="scorers">${goals.map((g) => `
    <li><span class="mono muted">${g.minute ?? ''}'</span> ${esc(g.player || '?')}${/own/i.test(g.type) ? ' <span class="muted">(e.d.)</span>' : ''}${/penalty/i.test(g.type) ? ' <span class="muted">(pen.)</span>' : ''} <span class="muted">· ${esc(g.teamId === (m.homeTeam && m.homeTeam.id) ? m.homeTeam.name : m.awayTeam.name)}</span></li>`).join('')}</ul>`;
}

function bestPlayer(m) {
  const list = m.detail && m.detail.players && m.detail.players[TEAM];
  if (!list) return null;
  return list.filter((p) => p.rating !== null).sort((a, b) => b.rating - a.rating)[0] || null;
}

function lastBlock(m) {
  if (!m) return '<p class="muted">Nog geen gespeelde wedstrijden.</p>';
  const r = resultFor(m, TEAM);
  const best = bestPlayer(m);
  return `
    <a class="score-line" href="#/wedstrijd/${m.id}">
      <span class="score-line__team">${crest(m.homeTeam)}<span>${esc(m.homeTeam.name)}</span></span>
      <span class="score-line__score">${scoreText(m)}</span>
      <span class="score-line__team score-line__team--away"><span>${esc(m.awayTeam.name)}</span>${crest(m.awayTeam)}</span>
    </a>
    <div class="section__label"><span>${esc(dayShort(m.date))} · ${esc(compName(m))}</span><span class="result result--${r}">${r === 'W' ? 'Winst' : r === 'V' ? 'Verlies' : 'Gelijk'}</span></div>
    ${scorers(m)}
    ${best ? `<div class="kv-line"><span>Beste speler: ${esc(best.name)}</span><span class="mono">${best.rating.toFixed(2)}</span></div>` : ''}
    ${m.detail ? '' : `<button class="btn btn--primary" type="button" data-action="fetch-match" data-id="${m.id}">Details ophalen · ${COST.match} calls</button>`}`;
}

function seasonBlock(list, league) {
  if (!league) return '';
  const s = leagueSummary(list, TEAM, league.id);
  if (!s.played) return '';
  const streak = s.unbeaten >= 2 ? `${s.unbeaten} duels ongeslagen` : s.winless >= 3 ? `${s.winless} duels zonder zege` : null;
  return `
    <section class="section">
      <div class="section__label"><span>03 — Seizoen</span><span>${esc(league.name)} · ${s.played} duels</span></div>
      <div class="stat-row">
        <div><span class="big-num">${s.points}</span><span class="muted"> pt</span></div>
        <div class="mono">${s.w}–${s.d}–${s.l}<br><span class="muted">${s.gf}:${s.ga}</span></div>
        <div class="form">${s.form.map((r) => `<span class="form__tile form__tile--${r}">${r}</span>`).join('')}</div>
      </div>
      <div class="facts">
        ${streak ? `<div class="fact"><span class="fact__num">${s.unbeaten >= 2 ? s.unbeaten : s.winless}</span><span>${esc(streak)}</span></div>` : ''}
        <div class="fact"><span class="fact__num">${s.awayPts}</span><span>punten uit, tegen ${s.homePts} thuis</span></div>
      </div>
    </section>`;
}

function roundsBlock(list, league) {
  if (!league) return '';
  const games = sortByDate(list.filter((m) => m.league && m.league.id === league.id));
  if (!games.length) return '';
  return `
    <section class="section">
      <div class="section__label"><span>04 — Rondes</span><span>${esc(league.name)}</span></div>
      <div class="rounds">${games.map((m) => {
        const r = resultFor(m, TEAM);
        const opp = opponentOf(m, TEAM);
        return `<a class="round round--${r || 'open'}" href="#/wedstrijd/${m.id}" title="${matchTitle(m)}">
          <span class="mono">${esc(shortRound(m.round))}</span>
          <span class="round__opp">${esc(opp ? opp.name.slice(0, 3).toUpperCase() : '?')}</span>
          <span class="mono">${r ? esc(r) : esc(dayShort(m.date).split(' ').slice(1).join(' '))}</span>
        </a>`;
      }).join('')}</div>
    </section>`;
}

function syncFooter(meta, calls) {
  const last = meta && meta.lastSeasonSync;
  const ageDays = last ? (Date.now() - Date.parse(last)) / 864e5 : Infinity;
  const stale = ageDays >= SYNC_SUGGEST_DAYS;
  return `
    <section class="section">
      <div class="section__label"><span>Programma</span><span>API vandaag: ${calls} calls</span></div>
      <p class="${stale ? '' : 'muted'}" style="font-size: 13px">${last ? `Laatst gesynchroniseerd ${esc(dayShort(last))} ${esc(timeOf(last))}${stale ? ' · tijd voor een update' : ''}` : 'Nog niet gesynchroniseerd'}</p>
      <div>${syncButton(`Seizoen synchroniseren · ${COST.season} calls`)}</div>
    </section>`;
}

export const matchViews = {
  home: {
    title: 'Home',
    async render() {
      const [list, meta, calls] = await Promise.all([getAllMatches(), getMeta('sync'), getCallsToday()]);
      const league = mainLeague(list);
      const kicker = `MySeasons / ${league ? league.name + ' ' : ''}2026–27`;
      if (!list.length) {
        return `
          ${head({ kicker, title: MAIN_CLUB.name })}
          <section class="section">
            <div class="empty">
              <span class="empty__title">Haal je seizoen op</span>
              <p class="muted">Eén keer synchroniseren haalt het hele programma en alle uitslagen van dit seizoen op. Dat kost ${COST.season} van je 100 API-calls van vandaag.</p>
              <div>${syncButton(`Seizoen ophalen · ${COST.season} calls`)}</div>
            </div>
          </section>`;
      }
      return `
        ${head({ kicker, title: MAIN_CLUB.name })}
        <section class="section">
          <div class="section__label"><span>01 — Volgende</span><span>${(() => { const n = nextMatch(list); return n ? esc(compName(n)) : ''; })()}</span></div>
          ${nextBlock(nextMatch(list))}
        </section>
        <section class="section">
          <div class="section__label"><span>02 — Laatste</span></div>
          ${lastBlock(lastMatch(list))}
        </section>
        ${seasonBlock(list, league)}
        ${roundsBlock(list, league)}
        ${syncFooter(meta, calls)}`;
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

  // ---------- Wedstrijden ----------

  wedstrijden: {
    title: 'Wedstrijden',
    async render() {
      const list = sortByDate(await getAllMatches());
      if (!list.length) {
        return `${head({ kicker: 'MySeasons / 2026–27', title: 'Wedstrijden' })}
          <section class="section"><div class="empty"><span class="empty__title">Nog leeg</span>
          <p class="muted">Synchroniseer eerst het seizoen op Home.</p><div><a class="btn" href="#/home">Naar Home</a></div></div></section>`;
      }
      const groups = new Map();
      list.forEach((m) => {
        const k = monthOf(m.date);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(m);
      });
      return `
        ${head({ kicker: 'MySeasons / 2026–27', title: 'Wedstrijden' })}
        ${[...groups].map(([month, games]) => `
          <section class="section">
            <div class="section__label"><span>${esc(month)}</span><span>${games.length}</span></div>
            <div class="list">${games.map((m) => {
              const r = resultFor(m, TEAM);
              return `<a class="list-row match-row" href="#/wedstrijd/${m.id}">
                <span class="match-row__date mono">${esc(dayShort(m.date))}</span>
                <span class="list-row__main"><span class="list-row__title">${matchTitle(m)}</span>
                  <span class="list-row__sub">${esc(compName(m))}${m.round && !/friendl/i.test(m.round) ? ' · ' + esc(shortRound(m.round)) : ''}${m.detail ? ' · details ✓' : ''}</span></span>
                <span class="match-row__end mono">${m.status === 'finished' ? `${scoreText(m)} <span class="result result--${r}">${r}</span>` : m.status === 'postponed' ? '<span class="muted">uitgesteld</span>' : esc(timeOf(m.date))}</span>
              </a>`;
            }).join('')}</div>
          </section>`).join('')}`;
    },
  },

  // ---------- Wedstrijdpagina ----------

  wedstrijd: {
    title: 'Wedstrijd',
    navKey: 'wedstrijden',
    async render(ctx, args) {
      const m = await getMatch(args[0]);
      if (!m) {
        return `${head({ kicker: 'Wedstrijden', title: 'Niet gevonden', back: 'wedstrijden' })}
          <section class="section"><p class="muted">Deze wedstrijd staat niet (meer) in je data.</p></section>`;
      }
      const r = resultFor(m, TEAM);
      const d = m.detail;
      const kicker = `${compName(m)}${m.round && !/friendl/i.test(m.round) ? ' · ' + shortRound(m.round) : ''} · ${dayShort(m.date)}`;
      return `
        ${head({ kicker, title: m.status === 'finished' ? (r === 'W' ? 'Winst' : r === 'V' ? 'Verlies' : 'Gelijk') : timeOf(m.date), back: 'wedstrijden' })}
        <section class="section">
          <div class="score-big">
            <div class="score-big__team">${crest(m.homeTeam, 48)}<span>${esc(m.homeTeam.name)}</span></div>
            <div class="score-big__score">${m.score ? `${m.score.home}<span class="muted">–</span>${m.score.away}` : '<span class="muted">vs</span>'}</div>
            <div class="score-big__team">${crest(m.awayTeam, 48)}<span>${esc(m.awayTeam.name)}</span></div>
          </div>
          ${m.penalties ? `<p class="muted" style="text-align:center">Strafschoppen ${m.penalties.home}–${m.penalties.away}</p>` : ''}
          ${d ? `<dl class="kv">
            ${d.venue && d.venue.name ? `<dt>Stadion</dt><dd>${esc(d.venue.name)}${d.venue.city ? ', ' + esc(d.venue.city) : ''}</dd>` : ''}
            ${d.referee ? `<dt>Scheidsrechter</dt><dd>${esc(d.referee)}</dd>` : ''}
            <dt>Aftrap</dt><dd>${esc(dayLong(m.date))}, ${esc(timeOf(m.date))}</dd>
          </dl>` : `<p class="muted">${esc(dayLong(m.date))}, ${esc(timeOf(m.date))}</p>`}
          ${m.status === 'finished'
            ? `<div><button class="btn ${d ? '' : 'btn--primary'}" type="button" data-action="fetch-match" data-id="${m.id}">${d ? 'Opnieuw ophalen' : 'Details ophalen'} · ${COST.match} calls</button></div>`
            : '<p class="muted" style="font-size:12px">Details zijn op te halen zodra de wedstrijd gespeeld is.</p>'}
        </section>
        ${d ? timeline(m) + statsBlock(m) + lineupsBlock(m) + playersBlock(m) : ''}`;
    },
    mount(root, ctx) {
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="fetch-match"]');
        if (btn) handleFetch(btn, ctx, btn.dataset.id);
      });
      mountSwipe(root);
    },
  },
};

// ---------- Wedstrijdpagina-blokken ----------

function nameIndex(m) {
  const idx = new Map();
  const d = m.detail;
  ['home', 'away'].forEach((side) => {
    const l = d.lineups && d.lineups[side];
    if (l) [...l.starters, ...l.subs].forEach((p) => idx.set(p.id, p.name));
  });
  Object.values(d.players || {}).forEach((list) => list.forEach((p) => { if (!idx.has(p.id)) idx.set(p.id, p.name); }));
  return idx;
}

function timeline(m) {
  const ev = m.detail.events || [];
  if (!ev.length) return '';
  const names = nameIndex(m);
  const homeId = m.homeTeam.id;
  const label = (e) => {
    if (e.type === 'Substitution') return `${esc(e.inName || names.get(e.inId) || '?')} <span class="muted">voor ${esc(e.outName || names.get(e.outId) || '?')}</span>`;
    const assist = e.assist || (e.assistId && names.get(e.assistId));
    return `${esc(e.player || '?')}${assist && /goal/i.test(e.type) ? ` <span class="muted">· assist ${esc(assist)}</span>` : ''}`;
  };
  const kind = (t) => /goal/i.test(t) && !/missed/i.test(t) ? 'goal' : /yellow/i.test(t) ? 'yellow' : /red/i.test(t) ? 'red' : /subst/i.test(t) ? 'sub' : 'other';
  const word = { goal: 'Goal', yellow: 'Geel', red: 'Rood', sub: 'Wissel', other: '' };
  return `
    <section class="section">
      <div class="section__label"><span>Tijdlijn</span><span>${esc(m.homeTeam.name)} links · ${esc(m.awayTeam.name)} rechts</span></div>
      <ol class="timeline">${ev.map((e) => {
        const k = kind(e.type);
        const side = e.teamId === homeId ? 'home' : 'away';
        return `<li class="tl tl--${side} tl--${k}">
          <span class="tl__min mono">${e.minute ?? ''}${e.extra ? '+' + e.extra : ''}'</span>
          <span class="tl__body"><span class="tl__badge tl__badge--${k}">${word[k] || esc(e.type)}</span> ${label(e)}</span>
        </li>`;
      }).join('')}</ol>
    </section>`;
}

const STAT_ROWS = [
  ['Possession', 'Balbezit', (v) => `${Math.round(v * 100)}%`],
  ['Expected Goals', 'xG', (v) => Number(v).toFixed(2)],
  ['Shots on target', 'Op doel', String],
  ['Shots off target', 'Naast', String],
  ['Blocked shots', 'Geblokt', String],
  ['Big Chances Created', 'Grote kansen', String],
  ['Corners', 'Corners', String],
  ['Fouls', 'Overtredingen', String],
  ['Yellow cards', 'Geel', String],
  ['Goalkeeper saves', 'Reddingen', String],
  ['Total passes', 'Passes', String],
];

function statsBlock(m) {
  const s = m.detail.stats;
  if (!s || !s.home || !Object.keys(s.home).length) return '';
  const rows = STAT_ROWS.filter(([k]) => s.home[k] !== undefined && s.away && s.away[k] !== undefined);
  return `
    <section class="section">
      <div class="section__label"><span>Statistieken</span><span>${esc(m.homeTeam.name)} · ${esc(m.awayTeam.name)}</span></div>
      <div class="stats">${rows.map(([k, label, f]) => {
        const a = Number(s.home[k]) || 0;
        const b = Number(s.away[k]) || 0;
        const total = a + b || 1;
        return `<div class="stat">
          <div class="stat__nums mono"><span>${esc(f(s.home[k]))}</span><span class="muted">${esc(label)}</span><span>${esc(f(s.away[k]))}</span></div>
          <div class="stat__bar"><span style="flex:${a / total}"></span><span style="flex:${b / total}"></span></div>
        </div>`;
      }).join('')}</div>
    </section>`;
}

function lineupList(l, title) {
  if (!l) return '';
  const row = (p) => `<li><span class="mono muted">${p.number ?? ''}</span> ${esc(p.name)} <span class="muted">${esc((p.position || '').slice(0, 3))}</span></li>`;
  return `
    <div class="lineup">
      <div class="lineup__head"><span>${esc(title)}</span><span class="mono muted">${esc(l.formation || '')}</span></div>
      <ul>${l.starters.map(row).join('')}</ul>
      <div class="lineup__subs muted">Bank</div>
      <ul class="lineup__bench">${l.subs.map(row).join('')}</ul>
    </div>`;
}

function lineupsBlock(m) {
  const l = m.detail.lineups;
  if (!l || (!l.home && !l.away)) return '';
  return `
    <section class="section">
      <div class="section__label"><span>Opstellingen</span></div>
      <div class="lineups">${lineupList(l.home, m.homeTeam.name)}${lineupList(l.away, m.awayTeam.name)}</div>
    </section>`;
}

function playerTable(list) {
  const played = list.filter((p) => p.minutes > 0).sort((a, b) => (a.sub - b.sub) || (b.minutes - a.minutes));
  return `
    <table class="table">
      <thead><tr><th>Speler</th><th>Min</th><th>G</th><th>A</th><th>Kaart</th><th>Cijfer</th></tr></thead>
      <tbody>${played.map((p) => `<tr>
        <td>${esc(p.name)}${p.captain ? ' <span class="muted">(c)</span>' : ''}${p.sub ? ' <span class="muted">· in</span>' : ''}</td>
        <td class="mono">${p.minutes}</td><td class="mono">${p.goals || ''}</td><td class="mono">${p.assists || ''}</td>
        <td>${p.red ? '<span class="card card--red" aria-label="rood"></span>' : p.yellow ? '<span class="card card--yellow" aria-label="geel"></span>' : ''}</td>
        <td class="mono">${p.rating !== null ? p.rating.toFixed(1) : '–'}</td></tr>`).join('')}</tbody>
    </table>`;
}

function playersBlock(m) {
  const all = m.detail.players || {};
  // Eigen club eerst, daarna de tegenstander.
  const teams = [m.homeTeam, m.awayTeam]
    .filter((t) => t && all[t.id] && all[t.id].length)
    .sort((a, b) => (b.id === TEAM) - (a.id === TEAM));
  if (!teams.length) return '';
  const count = (t) => all[t.id].filter((p) => p.minutes > 0).length;
  return `
    <section class="section">
      <div class="section__label"><span>Spelers</span><span>${teams.length > 1 ? 'veeg voor de tegenstander →' : ''}</span></div>
      ${teams.length > 1 ? `<div class="swipe-tabs" role="tablist">${teams.map((t, i) => `
        <button type="button" role="tab" class="swipe-tab" data-swipe-to="${i}" aria-selected="${i === 0}">${esc(t.name)} <span class="mono muted">${count(t)}</span></button>`).join('')}
      </div>` : ''}
      <div class="swipe" data-swipe>${teams.map((t) => `
        <div class="swipe__panel" role="tabpanel" aria-label="${esc(t.name)}">${playerTable(all[t.id])}</div>`).join('')}
      </div>
    </section>`;
}

// Tabjes en veeg-paneel synchroon houden.
function mountSwipe(root) {
  root.querySelectorAll('[data-swipe]').forEach((track) => {
    const section = track.closest('.section');
    const tabs = [...section.querySelectorAll('[data-swipe-to]')];
    if (!tabs.length) return;
    const setActive = (i) => tabs.forEach((t, j) => t.setAttribute('aria-selected', String(i === j)));
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      const i = Number(tab.dataset.swipeTo);
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      setActive(i);
    }));
    let raf = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setActive(Math.round(track.scrollLeft / track.clientWidth)));
    }, { passive: true });
  });
}
