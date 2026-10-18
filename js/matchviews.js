// Schermen met wedstrijddata: Home, Wedstrijden en de wedstrijdpagina.

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB, SYNC_SUGGEST_DAYS } from './config.js';
import { getSeason, seasonLabel, inSeason, isCurrentSeason } from './seasonstate.js';
import { getAllMatches, getMatch, getMeta, getCallsToday, getStandings, getNotes, getAllNotes, getPlayers, getLeagueMatches } from './store.js';
import { applyNames } from './names.js';
import { bestStandings, standingsAndMatches } from './livetable.js';
import { rulesFor, zonesFor, playoffBracket, SPECIAL_SEASONS, cupWinner, cupWinnerRsssf, rsssfAsMatches } from './rules.js';
import { tokens } from './rsssf.js';
import { coachOn, coachName } from './coaches.js';
import { getCoaches, getClubMarks } from './store.js';
import { getRsssf, rsssfStandings, mainDivision } from './rsssfimport.js';
import { applyCorrections, correctionSummary, goalCheck } from './corrections.js';
import { editEvent, editScore, editNotes } from './editor.js';
import { syncSeason, fetchMatch, syncStandings, syncLeague, COST } from './sync.js';
import { rowsFor, standTable, zoneLegend, miniStand, periodRows } from './standview.js';
import {
  sortByDate, resultFor, opponentOf, isHome, mainLeague, leagueSummary, nextMatch, lastMatch,
  dayShort, dayLong, timeOf, monthOf, relativeDay, shortRound, crowdSummary, penOutcome,
} from './season.js';

const TEAM = MAIN_CLUB.id;
const nl = (v) => Number(v).toLocaleString('nl-NL');

// ---------- Bouwstenen ----------

export function crest(t, size = 28) {
  if (!t) return '';
  const fallback = esc((t.name || '?').slice(0, 3).toUpperCase());
  return t.logo
    ? `<img class="crest" src="${esc(t.logo)}" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'crest crest--txt',textContent:'${fallback}'}))">`
    : `<span class="crest crest--txt" style="width:${size}px;height:${size}px">${fallback}</span>`;
}

export function head({ kicker, title, back, action }) {
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

export function compName(m) {
  if (!m.league) return '';
  return /friendl/i.test(m.league.name) ? 'Oefenwedstrijd' : m.league.name;
}

export function matchTitle(m) {
  return `${esc(m.homeTeam ? m.homeTeam.name : '?')} – ${esc(m.awayTeam ? m.awayTeam.name : '?')}`;
}

export function scoreText(m) {
  if (!m.score) return '';
  const pen = m.penalties ? ` <span class="muted">(${m.penalties.home}–${m.penalties.away} pen.)</span>` : '';
  return `${m.score.home}–${m.score.away}${pen}`;
}

const syncButton = (label = 'Synchroniseren') =>
  `<button class="btn" type="button" data-action="sync-season">${icons.refresh}<span>${esc(label)}</span></button>`;

export async function runWithButton(btn, busyText, work) {
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

export function explain(err) {
  if (err && err.status === 429) return 'Je API-quotum voor vandaag is op. Morgen weer.';
  if (err && err.status === 0) return 'Geen verbinding met de Worker. Ben je online?';
  return (err && err.message) || 'Onbekende fout';
}

export async function handleSync(btn, ctx) {
  try {
    const n = await runWithButton(btn, 'Bezig…', () => syncSeason());
    toast(`${n} wedstrijden bijgewerkt · ${COST.season} calls`);
    ctx.refresh();
  } catch (err) {
    toast(explain(err));
  }
}

export async function handleFetch(btn, ctx, id) {
  try {
    await runWithButton(btn, 'Ophalen…', () => fetchMatch(id));
    toast(`Wedstrijd opgehaald · ${COST.match} calls`);
    ctx.refresh();
  } catch (err) {
    toast(explain(err));
  }
}

/** Alle wedstrijden met jouw correcties erover, plus het aantal afwijkingen. */
/** Uitslagchip: G blijft G, met "W na pen." / "V na pen." erachter als het op strafschoppen aankwam. */
export function resultChip(m) {
  const r = resultFor(m, TEAM);
  if (!r) return '';
  const p = penOutcome(m, TEAM);
  return `<span class="result result--${r}">${r}</span>${p ? ` <span class="result result--${p} result--pen">${p} na pen.</span>` : ''}`;
}

export async function correctedList() {
  const [all, notes, profiles] = await Promise.all([getAllMatches(), getAllNotes(), getPlayers()]);
  const list = all.filter(inSeason(getSeason()));
  let total = 0; let conflicts = 0;
  const out = list.map((m) => {
    const n = notes[m.id];
    if (!n) return applyNames(JSON.parse(JSON.stringify(m)), profiles);
    const { match, statuses } = applyCorrections(m, n);
    const c = correctionSummary(statuses);
    total += c.total; conflicts += c.conflicts;
    return applyNames({ ...match, notes: n }, profiles);
  });
  return { list: out, total, conflicts, profiles };
}

function fillCard(m) {
  if (!m || m.status !== 'finished') return '';
  const n = m.notes || {};
  if (n.attendance != null || n.awayFans != null || n.note) return '';
  const age = (Date.now() - Date.parse(m.date)) / 864e5;
  if (age > 10) return '';
  return `
    <section class="section">
      <a class="action-card" href="#/wedstrijd/${m.id}">
        <span class="action-card__kicker">Te doen</span>
        <span class="action-card__title">${esc(opponentOf(m, TEAM) ? opponentOf(m, TEAM).name : 'Laatste wedstrijd')} aanvullen</span>
        <span class="muted">Toeschouwers en een notitie bij ${matchTitle(m)} · ${esc(scoreText(m))}</span>
      </a>
    </section>`;
}

export function devBar(total, conflicts, href) {
  if (!total) return '';
  return `<a class="dev-flag ${conflicts ? 'dev-flag--conflict' : ''}" href="${href}">
    <span class="fix-dot"></span>
    <span>${conflicts ? `${conflicts} ${conflicts === 1 ? 'veld' : 'velden'} met conflict` : `${total} ${total === 1 ? 'veld wijkt' : 'velden wijken'} af van Highlightly`}</span>
    <span class="dev-flag__go">Bekijken</span>
  </a>`;
}

// ---------- Periodes en nacompetitie (regelmotor) ----------

function periodLine(p, zones) {
  const upNow = p.holder && (zones.map.get(String(p.holder.id)) || {}).kind === 'up';
  const upNote = upNow ? (isCurrentSeason() ? ` Staat nu op een directe promotieplek: promoveert ${esc(p.holder.name)} direct, dan gaat de plek naar de stand.` : ` ${esc(p.holder.name)} promoveerde direct, dus de plek ging naar de stand.`) : '';
  const [a, b] = p.rounds;
  if (p.state === 'done') {
    const w = esc(p.winner.name);
    if (p.via === 'winst') return `<strong>${w}</strong> is periodekampioen en plaatst zich voor de nacompetitie.${upNote}`;
    if (p.via === 'nr2') return `${w} wint de periode, maar ${/^jong\s/i.test(p.winner.name) ? 'is een beloftenteam' : 'was al geplaatst'}. De plek gaat naar nummer 2: <strong>${esc(p.holder.name)}</strong>.${upNote}`;
    return `${w} wint de periode. De plek gaat naar de hoogst geklasseerde club zonder periodetitel in de eindstand.`;
  }
  if (p.state === 'running') return `Loopt: ronde ${a}–${b}, ${p.finished} van ${p.total} duels gespeeld. Leider: <strong>${esc(p.leader.team.name)}</strong> (${p.leader.points} pt)${/^jong\s/i.test(p.leader.team.name) ? ', een beloftenteam: wint die, dan gaat de plek naar nummer 2' : ''}.`;
  return `Begint in ronde ${a} (t/m ${b}).`;
}

function periodsBlock(zones, rules, lm, marks) {
  if (!lm.length) {
    return `<section class="section"><div class="section__label"><span>Periodes</span></div>
      <p class="muted" style="font-size:13px">Voor de periodestanden zijn alle competitiewedstrijden nodig. Haal ze op met “Alle wedstrijden” hieronder.</p></section>`;
  }
  const ps = zones.periods;
  const cur = ps.find((p) => p.state === 'running') || [...ps].reverse().find((p) => p.state === 'done') || ps[0];
  return `
    <section class="section">
      <div class="section__label"><span>Periodes</span><span>${ps.filter((p) => p.state === 'done').length} van ${ps.length} klaar</span></div>
      <fieldset class="segmented segmented--4" style="margin:0;padding:0">
        <legend class="visually-hidden">Periode</legend>
        ${ps.map((p) => `<input type="radio" name="period-tab" id="pt-${p.key}" value="${p.key}" ${p === cur ? 'checked' : ''}><label for="pt-${p.key}">${p.key}${p.state === 'done' ? ' ✓' : p.state === 'running' ? ' •' : ''}</label>`).join('')}
      </fieldset>
      ${ps.map((p) => {
        const hl = new Map();
        if (p.state === 'done') { hl.set(String(p.winner.id), 'winnaar'); if (p.holder && p.via === 'nr2') hl.set(String(p.holder.id), 'plek'); }
        if (p.state === 'running' && p.leader) hl.set(String(p.leader.team.id), 'leider');
        return `<div data-period="${p.key}" ${p === cur ? '' : 'hidden'}>
          <p class="period-sum">${periodLine(p, zones)}</p>
          ${p.state === 'open' ? '' : standTable(periodRows(p), { marks, highlight: hl })}
        </div>`;
      }).join('')}
      <p class="muted" style="font-size:12px">Bij gelijke stand in een periode telt geen onderling resultaat; daarna beslissen strafpunten (kaarten), die rekent de app niet mee.</p>
    </section>`;
}

const nmMe = (t) => `<span class="${t.id === TEAM || /cambuur/i.test(t.name || '') ? 'is-me' : ''}">${esc(t.name)}</span>`;
const roundNl = (l) => String(l || '').replace(/Round (\d+)/, 'Ronde $1').replace(/Semifinals?/, 'Halve finale').replace(/Quarterfinals?/, 'Kwartfinale').replace(/\bFinals?\b/, 'Finale')
  .replace(/First Legs?/, 'heen').replace(/Second Legs?/, 'terug').replace(/Replay/, 'replay');

/** Oud seizoen: de echte play-offs en nacompetitie van RSSSF (staan bij de Eredivisie op de pagina). */
function pastPlayoffsBlock(rs, leagueId) {
  if (!rs || !rs.divisions || isCurrentSeason()) return '';
  const all = rs.divisions.flatMap((d) => d.matches || []);
  const groups = [
    ...(leagueId === 75672 ? [['Play-offs Europa', all.filter((m) => m.stage === 'europe-playoff')]] : []),
    ['Nacompetitie promotie/degradatie', all.filter((m) => m.stage === 'nacompetitie')],
  ].filter(([, ms]) => ms.length);
  if (!groups.length) return '';
  return groups.map(([title, ms]) => `
    <section class="section">
      <div class="section__label"><span>${esc(title)}</span><span>${ms.length} duels</span></div>
      <div class="bracket">${ms.map((m) => `<div class="bracket__row bracket__row--res"><span class="bracket__key">${esc(roundNl(m.label))}</span><span>${nmMe({ name: String(m.homeFull || m.home) })} – ${nmMe({ name: String(m.awayFull || m.away) })} <span class="mono">${m.hs ?? ''}–${m.as ?? ''}</span>${m.note ? ` <span class="muted">(${esc(m.note)})</span>` : ''}</span></div>`).join('')}</div>
      <p class="muted" style="font-size:12px">${esc(rs.credit || 'Bron: RSSSF')}</p>
    </section>`).join('');
}

function bracketBlock(rules, rows, zones, rs) {
  const nm = nmMe;
  if (!isCurrentSeason() && rs && rs.divisions && rs.divisions.some((d) => (d.matches || []).some((m) => m.stage === 'nacompetitie'))) return ''; // echte uitslagen staan in pastPlayoffsBlock
  const b = playoffBracket(rules, rows, zones);
  if (!b) return '';
  return `
    <section class="section">
      <div class="section__label"><span>${isCurrentSeason() ? 'Nacompetitie als het nu eindigt' : 'Nacompetitie volgens de regels'}</span><span>${isCurrentSeason() ? 'voorlopig' : ''}</span></div>
      <div class="bracket">
        ${b.first.map((m) => `<div class="bracket__row"><span class="bracket__key">${m.key}</span><span>${nm(m.home)} – ${nm(m.away)}</span></div>`).join('')}
        ${b.later.map(([k, t]) => `<div class="bracket__row"><span class="bracket__key">${k}</span><span class="muted">${esc(t)}</span></div>`).join('')}
      </div>
      <p class="muted" style="font-size:12px">Alles over twee duels. De hoogst geplaatste club speelt de return thuis, de Eredivisie-club altijd. Plaatsing op de reguliere stand, beloftenteams tellen niet mee.</p>
    </section>`;
}

function crowdBlock(list, league) {
  const c = crowdSummary(list, TEAM, league.id);
  const vs = (m) => esc((opponentOf(m, TEAM) || {}).name || '?');
  const rows = [];
  if (c.homeAvg !== null) rows.push(['Gemiddeld thuis', nl(c.homeAvg), `${c.homeCount} ${c.homeCount === 1 ? 'duel' : 'duels'} ingevuld`]);
  if (c.homeTop) rows.push(['Drukste thuis', nl(c.homeTop.notes.attendance), `tegen ${vs(c.homeTop)}`]);
  if (c.fansTotal !== null) rows.push([`Meegereisde ${esc(MAIN_CLUB.name)}-fans`, nl(c.fansTotal), `gem. ${nl(c.fansAvg)} over ${c.fansCount} ${c.fansCount === 1 ? 'uitduel' : 'uitduels'}`]);
  if (c.fansTop) rows.push(['Grootste uitvak', nl(c.fansTop.notes.awayFans), `bij ${vs(c.fansTop)}`]);
  if (c.awayTop) rows.push(['Drukste uitstadion', nl(c.awayTop.notes.attendance), `bij ${vs(c.awayTop)}`]);
  return `
    <section class="section">
      <div class="section__label"><span>Publiek</span><span>${esc(league.name)}</span></div>
      ${rows.length ? `<div class="crowd">${rows.map(([l, v, sub]) => `<div class="crowd__row"><span>${l}<br><span class="muted">${sub}</span></span><span class="mono crowd__num">${v}</span></div>`).join('')}</div>
      <p class="muted" style="font-size:12px">Alleen competitieduels met een ingevuld aantal. Leeg telt niet mee als 0.</p>`
      : '<p class="muted" style="font-size:13px">Nog geen toeschouwers ingevuld. Dat doe je per wedstrijd onder “Aanvullen”.</p>'}
    </section>`;
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
    <li><span class="mono muted">${g.minute ?? ''}${g.extra ? '+' + g.extra : ''}'</span> ${esc(g.player || '?')}${/own/i.test(g.type) ? ' <span class="muted">(e.d.)</span>' : ''}${/penalty/i.test(g.type) ? ' <span class="muted">(pen.)</span>' : ''} <span class="muted">· ${esc(g.teamId === (m.homeTeam && m.homeTeam.id) ? m.homeTeam.name : m.awayTeam.name)}</span></li>`).join('')}</ul>`;
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

function seasonBlock(list, league, standings) {
  if (!league) return '';
  const s = leagueSummary(list, TEAM, league.id);
  if (!s.played) return '';
  const crowd = crowdSummary(list, TEAM, league.id);
  const streak = s.unbeaten >= 2 ? `${s.unbeaten} duels ongeslagen` : s.winless >= 3 ? `${s.winless} duels zonder zege` : null;
  const g = standings && standings.groups && standings.groups[0];
  const me = g ? rowsFor(g, 'total').find((r) => r.team.id === TEAM) : null;
  const points = me ? me.pts : s.points; // stand van de API telt puntenaftrek mee
  return `
    <section class="section">
      <div class="section__label"><span>03 — Seizoen</span><span>${esc(league.name)} · ${s.played} duels</span></div>
      <div class="stat-row">
        <div>${me ? `<span class="big-num">${me.pos}<span class="ordinal">e</span></span> ` : ''}<span class="big-num ${me ? 'big-num--sub' : ''}">${points}</span><span class="muted"> pt</span></div>
        <div class="mono">${s.w}–${s.d}–${s.l}<br><span class="muted">${s.gf}:${s.ga}</span></div>
        <div class="form">${s.form.map((r) => `<span class="form__tile form__tile--${r}">${r}</span>`).join('')}</div>
      </div>
      <div class="facts">
        ${streak ? `<div class="fact"><span class="fact__num">${s.unbeaten >= 2 ? s.unbeaten : s.winless}</span><span>${esc(streak)}</span></div>` : ''}
        <div class="fact"><span class="fact__num">${s.awayPts}</span><span>punten uit, tegen ${s.homePts} thuis</span></div>
        ${crowd.homeAvg !== null ? `<div class="fact"><span class="fact__num">${nl(crowd.homeAvg)}</span><span>gemiddeld thuis, over ${crowd.homeCount} ${crowd.homeCount === 1 ? 'duel' : 'duels'}</span></div>` : ''}
      </div>
      ${g ? `${miniStand(standings, null)}<div><a class="link-btn" href="#/stats">Hele stand</a></div>` : ''}
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

export function syncFooter(meta, calls) {
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
      const [{ list, total, conflicts }, meta, calls] = await Promise.all([correctedList(), getMeta(`sync_${getSeason()}`).then((m) => m || (isCurrentSeason() ? getMeta('sync') : null)), getCallsToday()]);
      const league = mainLeague(list);
      const standings = league ? await bestStandings(league.id, getSeason()) : null;
      const kicker = `MySeasons / ${league ? league.name + ' ' : ''}${seasonLabel()}`;
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
        ${conflicts ? `<section class="section">${devBar(total, conflicts, '#/afwijkingen')}</section>` : ''}
        ${fillCard(lastMatch(list))}
        <section class="section">
          <div class="section__label"><span>01 — Volgende</span><span>${(() => { const n = nextMatch(list); return n ? esc(compName(n)) : ''; })()}</span></div>
          ${nextBlock(nextMatch(list))}
        </section>
        <section class="section">
          <div class="section__label"><span>02 — Laatste</span></div>
          ${lastBlock(lastMatch(list))}
        </section>
        ${seasonBlock(list, league, standings)}
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

  // ---------- Stats: stand ----------

  stats: {
    title: 'Stand',
    async render() {
      const { list } = await correctedList();
      const rs = await getRsssf(getSeason()).catch(() => null);
      const rsDiv = mainDivision(rs);
      const league = mainLeague(list) || (rsDiv && rsDiv.leagueId ? { id: rsDiv.leagueId, name: rsDiv.name } : null);
      const kicker = `MySeasons / ${league ? league.name + ' ' : ''}${seasonLabel()}`;
      if (!league) {
        return `${head({ kicker, title: 'Stand' })}
          <section class="section"><div class="empty"><span class="empty__title">Nog geen competitie</span>
          <p class="muted">Synchroniseer eerst het seizoen op Home.</p><div><a class="btn" href="#/home">Naar Home</a></div></div></section>`;
      }
      const both = await standingsAndMatches(league.id, getSeason());
      const st = both.standings || rsssfStandings(rs, league.id);
      const lm = both.matches;
      const special = SPECIAL_SEASONS[getSeason()];
      const flag = special ? `<section class="section"><p class="season-flag"><strong>${esc(special.status[0].toUpperCase() + special.status.slice(1))}.</strong> ${esc(special.note)}</p></section>` : '';
      const g = st && st.groups && st.groups[0];
      const fromRsssf = st && st.source === 'rsssf';
      const marks = await getClubMarks().catch(() => ({}));
      const refresh = `<button class="btn" type="button" data-action="sync-standings" data-league="${league.id}">${icons.refresh}<span>Stand bijwerken · ${COST.standings} call</span></button>`;
      if (!g) {
        return `${head({ kicker, title: 'Stand' })}
          <section class="section"><div class="empty"><span class="empty__title">Stand nog niet opgehaald</span>
          <p class="muted">Haal de actuele ${esc(league.name)}-stand op.</p><div>${refresh}</div></div></section>`;
      }
      const modes = fromRsssf ? [['total', 'Totaal']] : [['total', 'Totaal'], ['home', 'Thuis'], ['away', 'Uit']];
      const rules = rulesFor(league.id, getSeason());
      const cupList = rules && rules.cup ? [...(await getLeagueMatches(rules.cup.leagueId, getSeason()).catch(() => [])), ...list.filter((m) => m.league && m.league.id === rules.cup.leagueId)] : [];
      const cup = cupWinner(cupList) || (rs ? cupWinnerRsssf(rs, g.rows) : null);
      // Periodes van oude seizoenen: Highlightly-wedstrijden als die er zijn, anders de RSSSF-uitslagen.
      const rsDivL = rs && rs.divisions ? rs.divisions.find((d) => d.leagueId === league.id) : null;
      const idOf = (name) => { const r = g.rows.find((x) => tokens(x.team.name).join(' ') === tokens(name).join(' ')); return r ? r.team.id : `rs:${name}`; };
      const lmUse = lm.length ? lm : rsDivL ? rsssfAsMatches(rsDivL, idOf) : [];
      const zones = rules && !special ? zonesFor(rules, g.rows, { matches: lmUse, cup, final: !isCurrentSeason() }) : null;
      return `
        ${head({ kicker, title: 'Stand' })}
        ${flag}
        <section class="section">
          ${fromRsssf ? `<p class="muted" style="font-size:12px;margin:0">Eindstand ${esc(seasonLabel())} · ${esc(st.credit)}</p>` : ''}
          <fieldset class="segmented segmented--3" style="margin:0;padding:0" ${fromRsssf ? 'hidden' : ''}>
            <legend class="visually-hidden">Weergave</legend>
            ${modes.map(([v, l], i) => `<input type="radio" name="stand-mode" id="sm-${v}" value="${v}" ${i === 0 ? 'checked' : ''}><label for="sm-${v}">${l}</label>`).join('')}
          </fieldset>
          ${modes.map(([v], i) => `<div data-stand-mode="${v}" ${i === 0 ? '' : 'hidden'}>${standTable(rowsFor(g, v), { zones: v === 'total' ? zones : null, marks })}</div>`).join('')}
          ${zones ? zoneLegend(zones, rules) : ''}
        </section>
        ${zones && rules.periods ? periodsBlock(zones, rules, lmUse, marks) : ''}
        ${zones && rules.playoff ? bracketBlock(rules, rowsFor(g, 'total'), zones, rs) : ''}
        ${pastPlayoffsBlock(rs, league.id)}
        ${crowdBlock(list, league)}
        <section class="section">
          <div class="section__label"><span>Bijgewerkt</span><span>${esc(dayShort(st.fetchedAt))} ${esc(timeOf(st.fetchedAt))}</span></div>
          ${st.source === 'live' ? '<p class="muted" style="font-size:12px">Zelf berekend uit alle uitslagen: de stand van Highlightly loopt achter tot een speelronde klaar is. Puntenaftrek is meegenomen.</p>' : ''}
          ${fromRsssf ? '<p class="muted" style="font-size:12px">Van RSSSF. De Highlightly-stand van dat seizoen kun je ook ophalen.</p>' : '<p class="muted" style="font-size:12px">De stand wordt ook bijgewerkt als je het seizoen synchroniseert.</p>'}
          <div style="display:flex;gap:8px;flex-wrap:wrap">${refresh}${isCurrentSeason() || !fromRsssf ? `<button class="btn" type="button" data-action="sync-league" data-league="${league.id}">${icons.refresh}<span>Alle wedstrijden · ~${COST.league} calls</span></button>` : ''}</div>
          <p class="muted" style="font-size:12px">Tik op een club voor al zijn wedstrijden dit seizoen.</p>
        </section>`;
    },
    mount(root, ctx) {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-action="sync-league"]');
        if (!b) return;
        try {
          const r = await runWithButton(b, 'Ophalen…', () => syncLeague(Number(b.dataset.league)));
          toast(`${r.count} wedstrijden opgehaald · ${r.calls} calls`);
        } catch (err) { toast(explain(err)); }
      });
      root.querySelectorAll('input[name="period-tab"]').forEach((input) => input.addEventListener('change', () => {
        root.querySelectorAll('[data-period]').forEach((el) => { el.hidden = el.dataset.period !== input.value; });
      }));
      root.querySelectorAll('input[name="stand-mode"]').forEach((input) => input.addEventListener('change', () => {
        root.querySelectorAll('[data-stand-mode]').forEach((el) => { el.hidden = el.dataset.standMode !== input.value; });
      }));
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action="sync-standings"]');
        if (!btn) return;
        try {
          await runWithButton(btn, 'Ophalen…', () => syncStandings(Number(btn.dataset.league)));
          toast(`Stand bijgewerkt · ${COST.standings} call`);
          ctx.refresh();
        } catch (err) {
          toast(explain(err));
        }
      });
    },
  },

  // ---------- Wedstrijden ----------

  wedstrijden: {
    title: 'Wedstrijden',
    async render() {
      const list = sortByDate((await correctedList()).list);
      if (!list.length) {
        return `${head({ kicker: `MySeasons / ${seasonLabel()}`, title: 'Wedstrijden' })}
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
        ${head({ kicker: `MySeasons / ${seasonLabel()}`, title: 'Wedstrijden' })}
        ${[...groups].map(([month, games]) => `
          <section class="section">
            <div class="section__label"><span>${esc(month)}</span><span>${games.length}</span></div>
            <div class="list">${games.map((m) => {
              const r = resultFor(m, TEAM);
              return `<a class="list-row match-row" href="#/wedstrijd/${m.id}">
                <span class="match-row__date mono">${esc(dayShort(m.date))}</span>
                <span class="list-row__main"><span class="list-row__title">${matchTitle(m)}</span>
                  <span class="list-row__sub">${esc(compName(m))}${m.round && !/friendl/i.test(m.round) ? ' · ' + esc(shortRound(m.round)) : ''}${m.detail ? ' · details ✓' : ''}</span></span>
                <span class="match-row__end mono">${m.status === 'finished' ? `${scoreText(m)} ${resultChip(m)}` : m.status === 'postponed' ? '<span class="muted">uitgesteld</span>' : esc(timeOf(m.date))}</span>
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
      const [apiM, notes, profiles, coaches] = await Promise.all([getMatch(args[0]), getNotes(args[0]), getPlayers(), getCoaches().catch(() => [])]);
      if (!apiM) {
        return `${head({ kicker: 'Wedstrijden', title: 'Niet gevonden', back: 'wedstrijden' })}
          <section class="section"><p class="muted">Deze wedstrijd staat niet (meer) in je data.</p></section>`;
      }
      const { match: corrected, statuses } = applyCorrections(apiM, notes);
      const m = applyNames(corrected, profiles);
      const sum = correctionSummary(statuses);
      const n = notes || {};
      const r = resultFor(m, TEAM);
      const d = m.detail;
      const goalsOff = m.status === 'finished' ? goalCheck(m) : null;
      const coach = coachOn(coaches, m.date, n.coachId);
      const motmName = n.motm ? ((n.motm.playerId && profiles[n.motm.playerId] && profiles[n.motm.playerId].fullName) || n.motm.name) : null;
      const kicker = `${compName(m)}${m.round && !/friendl/i.test(m.round) ? ' · ' + shortRound(m.round) : ''} · ${dayShort(m.date)}`;
      return `
        ${head({ kicker, title: m.status === 'finished' ? (penOutcome(m, TEAM) ? (penOutcome(m, TEAM) === 'W' ? 'Door na pen.' : 'Eruit na pen.') : r === 'W' ? 'Winst' : r === 'V' ? 'Verlies' : 'Gelijk') : timeOf(m.date), back: 'wedstrijden' })}
        <section class="section">
          <div class="score-big">
            <div class="score-big__team">${crest(m.homeTeam, 48)}<span>${esc(m.homeTeam.name)}</span></div>
            ${m.score && m.status === 'finished'
              ? `<button class="score-big__score score-big__score--edit" type="button" data-action="edit-score" aria-label="Uitslag corrigeren">${m.score.home}<span class="muted">–</span>${m.score.away}${m.scoreCorrected ? '<span class="fix-dot" title="Door jou aangepast"></span>' : ''}</button>`
              : `<div class="score-big__score">${m.score ? `${m.score.home}<span class="muted">–</span>${m.score.away}` : '<span class="muted">vs</span>'}</div>`}
            <div class="score-big__team">${crest(m.awayTeam, 48)}<span>${esc(m.awayTeam.name)}</span></div>
          </div>
          ${m.penalties ? `<p class="muted" style="text-align:center">Strafschoppen ${m.penalties.home}–${m.penalties.away}</p>` : ''}
          ${devBar(sum.total, sum.conflicts, `#/afwijkingen/${m.id}`)}
          ${goalsOff ? `<p class="warn-line">De uitslag is ${m.score.home}–${m.score.away}, maar de goals in de tijdlijn tellen op tot ${goalsOff.home}–${goalsOff.away}. Klopt er iets niet?</p>` : ''}
          ${coach || motmName ? `<dl class="kv">
            ${coach ? `<dt>Trainer</dt><dd>${esc(coachName(coach))}</dd>` : ''}
            ${motmName ? `<dt>Man van de wedstrijd</dt><dd>${n.motm.playerId ? `<a class="plain-link" href="#/speler/${n.motm.playerId}">${esc(motmName)}</a>` : esc(motmName)} <span class="muted">· jouw keuze</span></dd>` : ''}
          </dl>` : ''}
          ${d ? `<dl class="kv">
            ${d.venue && d.venue.name ? `<dt>Stadion</dt><dd>${esc(d.venue.name)}${d.venue.city ? ', ' + esc(d.venue.city) : ''}</dd>` : ''}
            ${d.referee ? `<dt>Scheidsrechter</dt><dd>${esc(d.referee)}</dd>` : ''}
            <dt>Aftrap</dt><dd>${esc(dayLong(m.date))}, ${esc(timeOf(m.date))}</dd>
            ${n.attendance != null ? `<dt>Toeschouwers</dt><dd class="mono">${nl(n.attendance)}</dd>` : ''}
            ${n.awayFans != null ? `<dt>Uitvak</dt><dd><span class="mono">${nl(n.awayFans)}</span> <span class="muted">${esc(m.awayTeam.name)}</span></dd>` : ''}
          </dl>` : `<p class="muted">${esc(dayLong(m.date))}, ${esc(timeOf(m.date))}</p>`}
          ${m.status === 'finished'
            ? `<div><button class="btn ${d ? '' : 'btn--primary'}" type="button" data-action="fetch-match" data-id="${m.id}">${d ? 'Opnieuw ophalen' : 'Details ophalen'} · ${COST.match} calls</button></div>`
            : '<p class="muted" style="font-size:12px">Details zijn op te halen zodra de wedstrijd gespeeld is.</p>'}
        </section>
        ${m.status === 'finished' ? notesBlock(n) : ''}
        ${d ? timeline(m) + statsBlock(m) + lineupsBlock(m) + playersBlock(m) : ''}`;
    },
    mount(root, ctx, args) {
      const id = args[0];
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const a = btn.dataset.action;
        if (a === 'fetch-match') return handleFetch(btn, ctx, btn.dataset.id);
        // Altijd vers lezen: zo werk je op de laatste API-data en correcties.
        const [apiM, notes] = await Promise.all([getMatch(id), getNotes(id)]);
        if (!apiM) return;
        let changed = false;
        try {
          if (a === 'edit-score') changed = await editScore(apiM, notes, ctx.refresh);
          if (a === 'edit-event') changed = await editEvent(apiM, notes, btn.dataset.sig, ctx.refresh);
          if (a === 'edit-notes') changed = await editNotes(apiM, notes);
        } catch (err) {
          toast(`Opslaan lukte niet: ${err.message || err}`);
        }
        if (changed) ctx.refresh();
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

function notesBlock(n) {
  const has = n.attendance != null || n.awayFans != null || n.note;
  return `
    <section class="section">
      <div class="section__label"><span>Jouw aanvulling</span><span>${has ? '' : 'nog leeg'}</span></div>
      ${n.note ? `<p class="note-text">${esc(n.note)}</p>` : ''}
      ${!has ? '<p class="muted" style="font-size:13px">Toeschouwers en een notitie komen niet uit de API. Die vul je zelf in.</p>' : ''}
      <div><button class="btn ${has ? '' : 'btn--primary'}" type="button" data-action="edit-notes">${has ? 'Aanvulling bewerken' : 'Aanvullen'}</button></div>
    </section>`;
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
      <div class="section__label"><span>Tijdlijn</span><span>tik op een moment om te corrigeren</span></div>
      <ol class="timeline">${ev.map((e) => {
        const k = kind(e.type);
        const side = e.teamId === homeId ? 'home' : 'away';
        const editable = k !== 'other' && e._sig;
        const dot = e._fix && e._fix.length ? '<span class="fix-dot" title="Door jou aangepast"></span>' : '';
        const inner = `<span class="tl__min mono">${e.minute ?? ''}${e.extra ? '+' + e.extra : ''}'</span>
          <span class="tl__body"><span class="tl__badge tl__badge--${k}">${word[k] || esc(e.type)}</span> ${label(e)}${dot}</span>`;
        return `<li class="tl tl--${side} tl--${k}">${editable
          ? `<button type="button" class="tl__btn" data-action="edit-event" data-sig="${esc(e._sig)}">${inner}</button>`
          : inner}</li>`;
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

function playerTable(list, link) {
  const played = list.filter((p) => p.minutes > 0).sort((a, b) => (a.sub - b.sub) || (b.minutes - a.minutes));
  return `
    <table class="table">
      <thead><tr><th>Speler</th><th>Min</th><th>G</th><th>A</th><th>Kaart</th><th>Cijfer</th></tr></thead>
      <tbody>${played.map((p) => `<tr>
        <td>${link ? `<a class="plain-link" href="#/speler/${p.id}">${esc(p.name)}</a>` : esc(p.name)}${p.captain ? ' <span class="muted">(c)</span>' : ''}${p.sub ? ' <span class="muted">· in</span>' : ''}</td>
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
        <div class="swipe__panel" role="tabpanel" aria-label="${esc(t.name)}">${playerTable(all[t.id], t.id === TEAM)}</div>`).join('')}
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
