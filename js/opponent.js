// De tegenstander in de voorbeschouwing (Home onder de cover, en de pagina van het komende Cambuur-duel):
// hun vorm, topscorer, assistkoning, en wie er geschorst is of één kaart van een schorsing af zit.
// De verwachte opstellingen (beide clubs) staan in predict.js. Alles uit data die er al is: de competitie- en bekerlijsten
// (met events) en het volledige verloop van hun laatste duel (leagueDetails, of je eigen details als dat tegen
// Cambuur was). Geen calls.

import { esc } from './ui.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import { getLeagueMatches, getAllMatches, attachDetails } from './store.js';
import { discipline, statusFor, disciplineFor } from './discipline.js';

const TEAM = MAIN_CLUB.id;
const LEAGUES = [75672, 76523, 77374];
const GOAL = /^(goal|penalty)$/i;
const by = (a, b) => Date.parse(a.date) - Date.parse(b.date);
const opponentOf = (m) => (m.homeTeam && m.homeTeam.id === TEAM ? m.awayTeam : m.homeTeam);

function resultFor(m, teamId) {
  if (m.status !== 'finished' || !m.score) return null;
  const mine = m.homeTeam.id === teamId ? m.score.home : m.score.away;
  const theirs = m.homeTeam.id === teamId ? m.score.away : m.score.home;
  if (mine !== theirs) return mine > theirs ? 'W' : 'V';
  const p = m.penalties;
  if (p && p.home != null && p.home !== p.away) return (m.homeTeam.id === teamId ? p.home > p.away : p.away > p.home) ? 'W' : 'V';
  return 'G';
}

/** Alle duels van een club dit seizoen (ED, KKD, beker), met events; duels tegen Cambuur uit je eigen details. */
async function matchesOf(teamId, season) {
  const [lists, own] = await Promise.all([
    Promise.all(LEAGUES.map((l) => getLeagueMatches(l, season).catch(() => []))),
    getAllMatches().then((l) => attachDetails(l.filter((m) => m.league && Number(m.league.season) === season && [m.homeTeam, m.awayTeam].some((t) => t && t.id === teamId)))).catch(() => []),
  ]);
  const map = new Map();
  lists.flat().filter((m) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === teamId)).forEach((m) => map.set(String(m.id), { ...m, detail: m.events ? { events: m.events } : null }));
  own.forEach((m) => map.set(String(m.id), { ...(map.get(String(m.id)) || {}), ...m, own: true }));
  return [...map.values()].sort(by);
}

/** HTML-blok, of '' als er niets zinnigs te zeggen valt. */
export async function opponentHtml(next) {
  if (!next || !next.league || /friendl/i.test(next.league.name || '')) return '';
  const opp = opponentOf(next);
  if (!opp || opp.id == null) return '';
  const season = Number(next.league.season ?? CURRENT_SEASON);
  const all = await matchesOf(opp.id, season);
  const played = all.filter((m) => m.status === 'finished' && m.score && Date.parse(m.date) < Date.parse(next.date));
  if (!played.length) return '';

  // Vorm: laatste 5 (alle competities), van hun kant bekeken.
  const form = played.slice(-5).map((m) => ({ r: resultFor(m, opp.id), m }));

  // Topscorer en assists in hun competitie (of alles bij een bekerduel).
  const lid = Number(next.league.id);
  const pool = played.filter((m) => lid === 77374 || Number(m.league.id) === lid);
  const goals = new Map(); const assists = new Map(); const names = new Map();
  pool.forEach((m) => ((m.detail && m.detail.events) || []).forEach((e) => {
    if (e.teamId !== opp.id || e.shootout || !GOAL.test(e.type || '')) return;
    if (e.playerId != null) { goals.set(e.playerId, (goals.get(e.playerId) || 0) + 1); if (e.player && (names.get(e.playerId) || '').length < e.player.length) names.set(e.playerId, e.player); }
    if (e.assistId != null) { assists.set(e.assistId, (assists.get(e.assistId) || 0) + 1); if (e.assist && !names.has(e.assistId)) names.set(e.assistId, e.assist); }
  }));
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const ts = top(goals); const ta = top(assists);

  // Schorsingen: dezelfde KNVB-regels als bij Cambuur, uit hun kaarten.
  const pills = [];
  if (ts) pills.push(`⚽ ${esc(names.get(ts[0]) || '?')} · ${ts[1]} ${ts[1] === 1 ? 'goal' : 'goals'}`);
  if (ta && ta[1] >= 2) pills.push(`🅰️ ${esc(names.get(ta[0]) || '?')} · ${ta[1]} assists`);
  if (disciplineFor(lid, season)) {
    const st = discipline(all.filter((m) => Date.parse(m.date) < Date.parse(next.date)), {}, opp.id);
    st.players.forEach((info) => {
      const s = statusFor(info, next);
      if (s.banned) pills.push(`🟥 geschorst: ${esc(info.name || '?')}`);
      else if (s.edge.length) pills.push(`🟨 één kaart van schorsing: ${esc(info.name || '?')}`);
    });
  }

  return `<section class="section opp-block">
    <div class="section__label"><span>${esc(opp.name)} · laatste ${form.length}</span><span class="opp-form">${form.map(({ r, m }) => `<span class="opp-r opp-r--${r}" title="${esc(m.homeTeam.name)} ${m.score.home}–${m.score.away} ${esc(m.awayTeam.name)}">${r}</span>`).join('')}</span></div>
    ${pills.length ? `<div class="opp-pills">${pills.map((p) => `<span class="opp-pill">${p}</span>`).join('')}</div>` : ''}
  </section>`;
}
