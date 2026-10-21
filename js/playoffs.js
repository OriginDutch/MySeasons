// Na de competitie: Nacompetitie (promotie/degradatie) en Play-offs Europa als eigen "competitie" in de lijst.
// Bronnen: Highlightly (play-offduels staan onder de Eredivisie- of KKD-lijst, buiten "Regular Season")
// of RSSSF voor oude seizoenen. Per ronde heen/terug als duel met totaalstand en wie doorgaat.

import { esc } from './ui.js';
import { getLeagueMatches } from './store.js';
import { MAIN_CLUB } from './config.js';
import { tokens } from './rsssf.js';
import { regularOnly } from './livetable.js';
import { dayShort } from './season.js';

export const PLAYOFFS = [
  { key: 'nacompetitie', name: 'Nacompetitie', sub: 'promotie/degradatie' },
  { key: 'europa', name: 'Play-offs Europa', sub: 'Conference League' },
];
export const playoffInfo = (key) => PLAYOFFS.find((p) => p.key === key) || null;

const ED = 75672; const KKD = 76523;
const TEAM = MAIN_CLUB.id;

const roundNl = (l) => String(l || '').replace(/^.*? - /, '')
  .replace(/Round (\d+)|(\d+)(st|nd|rd|th) Round/i, (_, a, b) => `Ronde ${a || b}`)
  .replace(/Semi-?finals?/i, 'Halve finale').replace(/Quarter-?finals?/i, 'Kwartfinale').replace(/\bFinals?\b/i, 'Finale')
  .replace(/\s*·\s*(First|Second) Legs?/i, '').trim();
const legOf = (l) => (/First Leg/i.test(l || '') ? 'heen' : /Second Leg/i.test(l || '') ? 'terug' : null);
const kindOfRound = (r, fromLeague) => {
  if (/europ|conference/i.test(r || '')) return 'europa';
  if (/promotion|relegation|promotie|degradatie|nacompetitie/i.test(r || '')) return 'nacompetitie';
  return fromLeague === KKD ? 'nacompetitie' : 'europa';
};
const ROUND_ORDER = (r) => { const m = r.match(/Ronde (\d+)/); return m ? Number(m[1]) : /Kwart/.test(r) ? 50 : /Halve/.test(r) ? 60 : /Finale/.test(r) ? 70 : 40; };

const cache = new Map(); // seizoen → { nacompetitie: [...], europa: [...] }

/** Alle play-offduels van een seizoen, genormaliseerd. own: jouw Cambuur-wedstrijden (voor de link naar de wedstrijdpagina). */
export async function playoffMatches(season, { rs = null, own = [] } = {}) {
  const hit = cache.get(season);
  if (hit && Date.now() - hit.t < 5 * 60e3) return hit.v;
  const out = { nacompetitie: [], europa: [] };
  const ownById = new Map(own.map((m) => [String(m.id), m]));
  // 1. Highlightly
  const seen = new Set();
  for (const lid of [KKD, ED]) {
    const all = await getLeagueMatches(lid, season).catch(() => []);
    const reg = new Set(regularOnly(all).map((m) => m.id));
    all.filter((m) => !reg.has(m.id) && !seen.has(m.id)).forEach((m) => {
      seen.add(m.id);
      out[kindOfRound(m.round, lid)].push({
        round: roundNl(m.round) || 'Play-offs', leg: null, date: m.date, home: m.homeTeam, away: m.awayTeam,
        hs: m.score ? m.score.home : null, as: m.score ? m.score.away : null, pen: m.penalties || null, note: null,
        status: m.status, matchId: ownById.has(String(m.id)) ? m.id : null,
      });
    });
  }
  // 2. RSSSF (oude seizoenen), alleen als Highlightly die soort niet heeft
  if (rs && rs.divisions) {
    const all = rs.divisions.flatMap((d) => d.matches || []);
    [['nacompetitie', 'nacompetitie'], ['europa', 'europe-playoff']].forEach(([k, stage]) => {
      if (out[k].length) return;
      out[k] = all.filter((m) => m.stage === stage).map((m) => {
        const home = { id: null, name: String(m.homeFull || m.home) }; const away = { id: null, name: String(m.awayFull || m.away) };
        const mine = own.find((o) => o.date && m.date && Math.abs(Date.parse(o.date) - Date.parse(m.date)) < 2 * 864e5
          && [o.homeTeam, o.awayTeam].some((t) => t && t.id !== TEAM && tokens(t.name).some((w) => w.length > 3 && tokens(home.name + ' ' + away.name).includes(w))));
        return { round: roundNl(m.label) || 'Play-offs', leg: legOf(m.label), date: m.date, home, away, hs: m.hs, as: m.as, pen: m.penalties || null, note: m.note || null, status: m.status === 'played' ? 'finished' : m.status, matchId: mine ? mine.id : null };
      });
    });
  }
  cache.set(season, { t: Date.now(), v: out });
  return out;
}
export const dropPlayoffCache = () => cache.clear();

const isMe = (t) => t && (t.id === TEAM || /cambuur/i.test(t.name || ''));
const key = (t) => (t.id != null ? `id:${t.id}` : `n:${tokens(t.name).join(' ')}`);

/** Duels per ronde: heen/terug samen, met totaal en winnaar. */
export function ties(matches) {
  const byRound = new Map();
  matches.forEach((m) => { if (!byRound.has(m.round)) byRound.set(m.round, []); byRound.get(m.round).push(m); });
  return [...byRound.entries()].sort((a, b) => ROUND_ORDER(a[0]) - ROUND_ORDER(b[0])).map(([round, ms]) => {
    const pairs = new Map();
    ms.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((m) => {
      const k = [key(m.home), key(m.away)].sort().join('|');
      if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(m);
    });
    return { round, ties: [...pairs.values()].map((legs) => {
      const a = legs[0].home; const b = legs[0].away;
      let ga = 0; let gb = 0; let played = true;
      legs.forEach((m) => {
        if (m.hs == null) { played = false; return; }
        const aHome = key(m.home) === key(a);
        ga += aHome ? m.hs : m.as; gb += aHome ? m.as : m.hs;
      });
      let winner = null;
      if (played) {
        if (ga !== gb) winner = ga > gb ? a : b;
        else {
          const last = legs[legs.length - 1];
          if (last.pen) { const aHome = key(last.home) === key(a); const pa = aHome ? last.pen.home : last.pen.away; const pb = aHome ? last.pen.away : last.pen.home; winner = pa > pb ? a : pb > pa ? b : null; }
        }
      }
      return { a, b, legs, ga, gb, played, winner };
    }) };
  });
}

const nm = (t) => `<span class="${isMe(t) ? 'is-me' : ''}">${esc(t.name)}</span>`;

/** De pagina-inhoud. projected: verwachte bracket (huidig seizoen, nog niets gespeeld). */
export function playoffsHtml(info, matches, { projected = null } = {}) {
  if (!matches.length) {
    return projected || `<section class="section"><p class="muted">Geen ${esc(info.name.toLowerCase())} gevonden voor dit seizoen.</p></section>`;
  }
  return ties(matches).map((r) => `
    <section class="section po-round">
      <div class="section__label"><span>${esc(r.round)}</span><span>${r.ties.length} ${r.ties.length === 1 ? 'duel' : 'duels'}</span></div>
      <div class="list">${r.ties.map((t) => `<div class="po-tie ${isMe(t.a) || isMe(t.b) ? 'is-me' : ''}">
        ${t.legs.map((m, i) => {
          const body = `<span class="po-leg__k mono">${esc(m.leg || (t.legs.length > 1 ? (i === 0 ? 'heen' : 'terug') : ''))}</span>
            <span class="po-leg__m">${nm(m.home)} – ${nm(m.away)}</span>
            <span class="po-leg__s mono">${m.hs != null ? `${m.hs}–${m.as}` : esc(m.date ? dayShort(m.date) : '')}${m.pen ? ` <span class="muted">(${m.pen.home}–${m.pen.away} pen)</span>` : m.note ? ` <span class="muted">(${esc(m.note)})</span>` : ''}</span>`;
          return m.matchId ? `<a class="po-leg" href="#/wedstrijd/${encodeURIComponent(m.matchId)}">${body}</a>` : `<div class="po-leg">${body}</div>`;
        }).join('')}
        ${t.played && t.legs.length > 1 ? `<div class="po-sum muted">Totaal ${t.ga}–${t.gb}${t.winner ? ` · <strong>${esc(t.winner.name)}</strong> door` : ''}</div>` : t.played && t.winner ? `<div class="po-sum muted"><strong>${esc(t.winner.name)}</strong> wint</div>` : ''}
      </div>`).join('')}</div>
    </section>`).join('');
}
