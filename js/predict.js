// Verwachte opstelling voor een duel, voor Cambuur en de tegenstander. Echt voorspellen kan niet; dit is een
// inschatting uit wat er in de data zit:
//   - score per speler uit de laatste 5 competitieduels: basisplaats 1, invaller 0,3; recent telt zwaarder
//   - formatie: de meest gespeelde van die 5; per linie (K/V/M/A) de hoogst scorende spelers
//   - eruit: geschorst (kaarten, KNVB-regels) en, bij Cambuur, geblesseerd (jouw invoer bij de speler)
//   - beker met binnen 4 dagen een competitieduel: kans op rotatie, de vorige bekeropstelling telt mee
// Zekerheid: zeker (de laatste 3 competitieduels in de basis), waarschijnlijk, twijfel (met een alternatief).
// Voorspeld tegen werkelijk: de voorspelling wordt bewaard (predictions/{matchId}) zodra je hem ziet; anders
// achteraf berekend met alleen de data van vóór de aftrap.

import { esc } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getLeagueMatches, getLeagueDetail, getAllMatches, attachDetails, getPlayers, getPrediction, savePrediction, getAllPredictions } from './store.js';
import { discipline, statusFor, disciplineFor } from './discipline.js';

const TEAM = MAIN_CLUB.id;
const CUP = 77374;
const W = [1, 0.85, 0.7, 0.55, 0.4];
const GROUP = (pos) => (/goal/i.test(pos || '') ? 'K' : /def/i.test(pos || '') ? 'V' : /mid/i.test(pos || '') ? 'M' : /forw|att/i.test(pos || '') ? 'A' : null);
const isCup = (m) => m && m.league && Number(m.league.id) === CUP;
const has = (m, teamId) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === teamId);

/** "4-2-3-1" → { K: 1, V: 4, M: 5, A: 1 } */
export function formationCounts(f) {
  const n = String(f || '').split('-').map(Number).filter((x) => x > 0);
  if (n.length < 2 || n.reduce((a, b) => a + b, 0) !== 10) return { K: 1, V: 4, M: 3, A: 3 };
  return { K: 1, V: n[0], M: n.slice(1, -1).reduce((a, b) => a + b, 0), A: n[n.length - 1] };
}

/** Alle duels van een club dit seizoen (ED, KKD, beker), met de opstelling van die club waar bekend. */
async function teamMatches(teamId, season) {
  const [lists, own] = await Promise.all([
    Promise.all([75672, 76523, CUP].map((l) => getLeagueMatches(l, season).catch(() => []))),
    getAllMatches().then((l) => attachDetails(l.filter((m) => m.league && Number(m.league.season) === season && has(m, teamId)))).catch(() => []),
  ]);
  const map = new Map();
  lists.flat().filter((m) => has(m, teamId)).forEach((m) => map.set(String(m.id), { ...m }));
  own.forEach((m) => map.set(String(m.id), { ...(map.get(String(m.id)) || {}), ...m, own: true }));
  return [...map.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

async function lineupOf(m, teamId) {
  const d = m.own ? m.detail : (m.hasDetail || m.mins) ? await getLeagueDetail(m.id).catch(() => null) : null;
  if (!d || !d.lineups) return null;
  const side = ['home', 'away'].map((k) => d.lineups[k]).find((l) => l && l.teamId === teamId);
  if (!side || !(side.starters || []).length) return null;
  const mins = new Map(((d.players && d.players[teamId]) || []).map((p) => [p.id, p.minutes || 0]));
  const subsIn = new Set((d.events || []).filter((e) => /subst/i.test(e.type || '') && e.teamId === teamId && e.inId != null).map((e) => e.inId));
  return { formation: side.formation, starters: side.starters, subs: side.subs || [], mins, subsIn };
}

/** De voorspelling (zonder opslaan). next = het duel; teamId = Cambuur of de tegenstander. */
export async function predictLineup(teamId, next, { before = Date.parse(next.date) } = {}) {
  const season = Number(next.league.season);
  const all = (await teamMatches(teamId, season)).filter((m) => m.status === 'finished' && Date.parse(m.date) < before);
  const league = all.filter((m) => !isCup(m));
  const recent = league.slice(-8).reverse(); // nieuwste eerst; tot 5 met opstelling
  const used = [];
  for (const m of recent) { if (used.length >= 5) break; const l = await lineupOf(m, teamId); if (l) used.push({ m, l }); }
  if (used.length < 2) return null;

  const players = new Map();
  const get = (p) => { if (!players.has(p.id)) players.set(p.id, { id: p.id, name: p.name, score: 0, starts: [], pos: {} }); const x = players.get(p.id); if ((p.name || '').length > (x.name || '').length) x.name = p.name; return x; };
  used.forEach(({ l }, i) => {
    l.starters.forEach((p) => { const x = get(p); x.score += W[i]; x.starts[i] = true; const g = GROUP(p.position); if (g) x.pos[g] = (x.pos[g] || 0) + 1; });
    l.subs.filter((p) => l.subsIn.has(p.id) || (l.mins.get(p.id) || 0) > 0).forEach((p) => { const x = get(p); x.score += 0.3 * W[i]; const g = GROUP(p.position); if (g) x.pos[g] = (x.pos[g] || 0) + 0.5; });
  });

  // Formatie: de meest gespeelde.
  const fc = new Map(); used.forEach(({ l }) => fc.set(l.formation, (fc.get(l.formation) || 0) + 1));
  const formation = [...fc.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Context: beker met snel daarna een competitieduel → kans op rotatie; vorige bekeropstelling telt mee.
  const notes = [];
  if (isCup(next)) {
    const all2 = await teamMatches(teamId, season);
    const after = all2.find((m) => !isCup(m) && Date.parse(m.date) > Date.parse(next.date) && Date.parse(m.date) - Date.parse(next.date) <= 4 * 864e5);
    const prevCup = all.filter(isCup).reverse()[0];
    const pl = prevCup ? await lineupOf(prevCup, teamId) : null;
    if (after) {
      const opp = after.homeTeam.id === teamId ? after.awayTeam : after.homeTeam;
      notes.push(`kans op rotatie (bekerduel, ${new Intl.DateTimeFormat('nl-NL', { weekday: 'long' }).format(new Date(after.date))} ${opp.name})`);
      players.forEach((x) => { x.score *= 0.6; });
      if (pl) pl.starters.forEach((p) => { get(p).score += 1; });
    } else if (pl) pl.starters.forEach((p) => { get(p).score += 0.3; });
  }

  // Eruit: geschorst, en bij Cambuur geblesseerd.
  const out = new Map();
  if (disciplineFor(Number(next.league.id), season)) {
    const st = discipline(all.map((m) => (m.own ? m : { ...m, detail: m.events ? { events: m.events } : null })), {}, teamId);
    st.players.forEach((info, id) => { if (statusFor(info, next).banned) out.set(id, 'geschorst'); });
  }
  if (teamId === TEAM) {
    const { injuredOn } = await import('./playerextra.js');
    const profiles = await getPlayers().catch(() => ({}));
    const ref = String(next.date).slice(0, 10);
    Object.entries(profiles).forEach(([id, pr]) => { if (injuredOn(pr, ref)) out.set(Number(id), 'geblesseerd'); });
  }

  const pool = [...players.values()].filter((x) => !out.has(x.id)).sort((a, b) => b.score - a.score);
  const groupOf = (x) => Object.entries(x.pos).sort((a, b) => b[1] - a[1])[0]?.[0] || 'M';
  const need = formationCounts(formation);
  const picked = []; const taken = new Set();
  ['K', 'V', 'M', 'A'].forEach((g) => {
    pool.filter((x) => groupOf(x) === g && !taken.has(x.id)).slice(0, need[g]).forEach((x) => { picked.push({ ...x, g }); taken.add(x.id); });
  });
  pool.filter((x) => !taken.has(x.id)).slice(0, 11 - picked.length).forEach((x) => { picked.push({ ...x, g: groupOf(x) }); taken.add(x.id); });
  const max = pool[0] ? pool[0].score : 1;
  const lines = ['K', 'V', 'M', 'A'].map((g) => picked.filter((x) => x.g === g).map((x) => {
    const sure = x.starts[0] && x.starts[1] && x.starts[2];
    const conf = sure ? 'zeker' : x.score >= 0.5 * max ? 'waarschijnlijk' : 'twijfel';
    const alt = conf === 'twijfel' ? pool.find((y) => !taken.has(y.id) && groupOf(y) === g) : null;
    return { id: x.id, name: x.name, conf, alt: alt ? alt.name : null };
  }));
  const missing = [...out.entries()].filter(([id]) => players.has(id) && players.get(id).score >= 0.5 * max).map(([id, why]) => `${players.get(id).name} (${why})`);
  return { teamId, formation, lines, notes, missing, basedOn: used.length };
}

// ---------- Opslaan en vergelijken ----------
const sigOf = (p) => JSON.stringify([p.formation, p.lines.flat().map((x) => x.id)]);

/** Bewaar (of werk bij, tot de aftrap) wat je te zien kreeg. */
export async function rememberPrediction(matchId, p) {
  if (!p) return;
  try {
    const cur = (await getPrediction(matchId)) || {};
    const old = cur[p.teamId];
    if (old && old.sig === sigOf(p)) return;
    await savePrediction(matchId, p.teamId, { sig: sigOf(p), formation: p.formation, ids: p.lines.flat().map((x) => x.id), names: p.lines.flat().map((x) => x.name), at: new Date().toISOString() });
  } catch { /* niet erg */ }
}

/** Voorspelling bij een gespeeld duel: bewaard, of achteraf berekend. */
async function predictionFor(m, teamId) {
  try {
    const cur = (await getPrediction(m.id)) || {};
    if (cur[teamId]) return { ...cur[teamId], retro: false };
  } catch { /* offline */ }
  const p = await predictLineup(teamId, m).catch(() => null);
  return p ? { formation: p.formation, ids: p.lines.flat().map((x) => x.id), names: p.lines.flat().map((x) => x.name), retro: true } : null;
}

// ---------- Weergave ----------
const DOT = { zeker: '🟢', waarschijnlijk: '🟡', twijfel: '⚪' };

export function predictionHtml(p, teamName) {
  if (!p) return '';
  return `<div class="pred">
    <div class="section__label" style="border:0;padding-top:6px"><span>Verwacht · ${esc(teamName)}</span><span class="mono">${esc(p.formation || '')}</span></div>
    ${p.notes.length ? `<p class="warn-line" style="margin:0 0 6px">${esc(p.notes.join(' · '))}</p>` : ''}
    <ol class="pred-lines">${p.lines.filter((l) => l.length).map((l) => `<li>${l.map((x) => `<span class="pred-p pred-p--${x.conf}" title="${esc(x.conf)}">${DOT[x.conf]} ${esc(x.name)}${x.alt ? ` <small class="muted">of ${esc(x.alt)}</small>` : ''}</span>`).join('')}</li>`).join('')}</ol>
    ${p.missing.length ? `<p class="muted pred-note">Ontbreekt: ${esc(p.missing.join(', '))}.</p>` : ''}
    <p class="muted pred-note">Inschatting uit de laatste ${p.basedOn} competitieduels. 🟢 zeker · 🟡 waarschijnlijk · ⚪ twijfel.</p>
  </div>`;
}

/** Verwachte opstellingen van beide clubs voor een komend Cambuur-duel (en bewaren). */
export async function previewPredictionsHtml(next) {
  if (!next || !next.league || /friendl/i.test(next.league.name || '')) return '';
  const opp = next.homeTeam.id === TEAM ? next.awayTeam : next.homeTeam;
  const [us, them] = await Promise.all([predictLineup(TEAM, next).catch(() => null), opp ? predictLineup(opp.id, next).catch(() => null) : null]);
  if (Date.now() < Date.parse(next.date)) { rememberPrediction(next.id, us); rememberPrediction(next.id, them); }
  if (!us && !them) return '';
  return `<section class="section"><div class="section__label"><span>Verwachte opstellingen</span><span>inschatting</span></div>
    ${predictionHtml(us, MAIN_CLUB.name)}${predictionHtml(them, opp ? opp.name : '')}</section>`;
}

/** Na de wedstrijd: voorspeld tegen werkelijk, voor beide clubs (Cambuur-wedstrijdpagina). */
export async function predictionCheckHtml(m) {
  const d = m.detail;
  if (!d || !d.lineups || m.status !== 'finished') return '';
  const blocks = [];
  for (const side of ['home', 'away']) {
    const real = d.lineups[side];
    const team = side === 'home' ? m.homeTeam : m.awayTeam;
    if (!real || !(real.starters || []).length) continue;
    const p = await predictionFor(m, team.id);
    if (!p) continue;
    const realIds = new Set(real.starters.map((x) => x.id));
    const hit = p.ids.filter((id) => realIds.has(id)).length;
    const wrong = p.ids.map((id, i) => ({ id, name: p.names[i] })).filter((x) => !realIds.has(x.id));
    const surprise = real.starters.filter((x) => !p.ids.includes(x.id));
    blocks.push(`<div class="pred-check"><div class="pred-check__head"><b>${esc(team.name)}</b><span class="mono">${hit} van 11 goed${p.formation === real.formation ? ' · formatie ✓' : ` · formatie ${esc(real.formation || '?')} (voorspeld ${esc(p.formation || '?')})`}</span></div>
      ${wrong.length ? `<p class="pred-swap">${wrong.map((w, i) => `<span>${esc(w.name)} <span class="muted">↔</span> <b>${esc(surprise[i] ? surprise[i].name : '?')}</b></span>`).join('')}</p>` : '<p class="pred-swap">Alles goed 🎯</p>'}
      ${p.retro ? '<p class="muted pred-note">Achteraf berekend, met alleen de data van vóór de aftrap.</p>' : ''}</div>`);
  }
  if (!blocks.length) return '';
  const season = await seasonScore().catch(() => null);
  return `<section class="section"><div class="section__label"><span>Voorspeld vs werkelijk</span><span>basis</span></div>${blocks.join('')}
    ${season ? `<p class="muted pred-note">Dit seizoen: gemiddeld ${season.avg.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} van 11 goed over ${season.n} ${season.n === 1 ? 'voorspelling' : 'voorspellingen'}.</p>` : ''}</section>`;
}

/** Gemiddelde van alle bewaarde voorspellingen waarvan de echte opstelling bekend is. */
async function seasonScore() {
  const preds = await getAllPredictions();
  const byId = new Map((await attachDetails((await getAllMatches()).filter((m) => m.status === 'finished' && preds[String(m.id)]))).map((m) => [String(m.id), m]));
  let total = 0; let n = 0;
  Object.entries(preds).forEach(([mid, doc0]) => {
    const m = byId.get(mid); if (!m || !m.detail || !m.detail.lineups) return;
    Object.entries(doc0).forEach(([tid, p]) => {
      const side = ['home', 'away'].map((k) => m.detail.lineups[k]).find((l) => l && String(l.teamId) === tid);
      if (!side || !(side.starters || []).length) return;
      const ids = new Set(side.starters.map((x) => x.id));
      total += (p.ids || []).filter((id) => ids.has(id)).length; n++;
    });
  });
  return n ? { avg: total / n, n } : null;
}
