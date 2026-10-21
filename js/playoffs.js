// Na de competitie: Nacompetitie (promotie/degradatie) en Play-offs Europa als eigen "competitie" in de lijst.
// Bronnen: Highlightly (play-offduels staan onder de Eredivisie- of KKD-lijst, buiten "Regular Season")
// of RSSSF voor oude seizoenen. Per ronde heen/terug als duel met totaalstand en wie doorgaat.

import { esc } from './ui.js';
import { getLeagueMatches } from './store.js';
import { MAIN_CLUB } from './config.js';
import { tokens } from './rsssf.js';
import { regularOnly } from './livetable.js';
import { dayShort, timeOf } from './season.js';
import { knownTeams, matchTeam, clubCrest } from './clubpick.js';
import { clubName } from './clubnames.js';

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
    const teams = await knownTeams().catch(() => []);
    const resolve = (name) => { const clean = String(name).replace(/\s*\(.*?\)\s*/g, ' ').trim(); const t = matchTeam(teams, clean); return t ? { id: t.id, name: t.name, logo: t.logo || null } : { id: null, name: clean, logo: null }; };
    [['nacompetitie', 'nacompetitie'], ['europa', 'europe-playoff']].forEach(([k, stage]) => {
      if (out[k].length) return;
      out[k] = all.filter((m) => m.stage === stage).map((m) => {
        const home = resolve(m.homeFull || m.home); const away = resolve(m.awayFull || m.away);
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

/**
 * Rondes in gespeelde volgorde. Een ronde wordt gesplitst zodra een club binnen dezelfde ronde
 * een tweede tegenstander krijgt (RSSSF noemt de halve finale soms ook "Ronde 2").
 * Per ronde: wedstrijden op datum, duels (heen/terug) met totaal en winnaar.
 */
export function rounds(matches) {
  const byRound = new Map();
  matches.forEach((m) => { if (!byRound.has(m.round)) byRound.set(m.round, []); byRound.get(m.round).push(m); });
  const out = [];
  [...byRound.entries()].sort((a, b) => ROUND_ORDER(a[0]) - ROUND_ORDER(b[0]) || String(a[1][0].date).localeCompare(String(b[1][0].date))).forEach(([round, ms]) => {
    const sorted = ms.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let cur = null;
    sorted.forEach((m) => {
      const pk = [key(m.home), key(m.away)].sort().join('|');
      const clash = cur && !cur.pairs.has(pk) && (cur.teams.has(key(m.home)) || cur.teams.has(key(m.away)));
      if (!cur || clash) { cur = { round, matches: [], pairs: new Map(), teams: new Set(), part: cur ? cur.part + 1 : 1 }; out.push(cur); }
      cur.matches.push(m);
      if (!cur.pairs.has(pk)) cur.pairs.set(pk, []);
      cur.pairs.get(pk).push(m);
      cur.teams.add(key(m.home)); cur.teams.add(key(m.away));
    });
  });
  // Namen: een vervolgdeel vlak voor de finale met één duel is de halve finale.
  out.forEach((r, i) => {
    const next = out[i + 1];
    if (r.part > 1) r.title = r.pairs.size === 1 && next && /Finale/.test(next.round) ? 'Halve finale' : `${r.round} · deel ${r.part}`;
    else r.title = r.round;
    r.ties = [...r.pairs.values()].map(tieOf);
  });
  return out;
}

function tieOf(legs) {
  const a = legs[0].home; const b = legs[0].away;
  let ga = 0; let gb = 0; let played = true;
  legs.forEach((m) => {
    if (m.hs == null) { played = false; return; }
    const aHome = key(m.home) === key(a);
    ga += aHome ? m.hs : m.as; gb += aHome ? m.as : m.hs;
  });
  let winner = null; let pen = null;
  if (played) {
    if (ga !== gb) winner = ga > gb ? a : b;
    else {
      const last = legs[legs.length - 1];
      if (last.pen) {
        const aHome = key(last.home) === key(a); const pa = aHome ? last.pen.home : last.pen.away; const pb = aHome ? last.pen.away : last.pen.home;
        winner = pa > pb ? a : pb > pa ? b : null; pen = winner === a ? `${pa}–${pb}` : `${pb}–${pa}`;
      }
    }
  }
  const wg = winner === a ? `${ga}–${gb}` : `${gb}–${ga}`;
  return { a, b, legs, played, winner, agg: legs.length > 1 ? wg : null, pen };
}

/** Oude naam, nog gebruikt in tests/elders. */
export const ties = (matches) => rounds(matches).map((r) => ({ round: r.title, ties: r.ties }));

/**
 * De pagina-inhoud.
 * ctx.seed(team) → { pos, short, leagueId } of null (eindpositie in de competitie)
 * ctx.kind: 'nacompetitie' | 'europa'
 */
export function playoffsHtml(info, matches, { projected = null, seed = () => null } = {}) {
  if (!matches.length) {
    return projected || `<section class="section"><p class="muted">Geen ${esc(info.name.toLowerCase())} gevonden voor dit seizoen.</p></section>`;
  }
  const rs = rounds(matches);
  const seen = new Set();
  const team = (t, { link = true } = {}) => {
    const s = seed(t);
    const nameHtml = `<span class="${isMe(t) ? 'po-me' : ''}">${esc(clubName(t))}</span>`;
    const inner = `${clubCrest(t, 18)}${nameHtml}${s ? `<small class="po-seed mono">${s.pos}e ${esc(s.short)}</small>` : ''}`;
    return link && t.id != null && s ? `<a class="po-team" href="#/club/${encodeURIComponent(t.id)}/${s.leagueId}">${inner}</a>` : `<span class="po-team">${inner}</span>`;
  };
  return rs.map((r, ri) => {
    // Wie stroomt deze ronde in?
    const entrants = [];
    r.ties.forEach((t) => [t.a, t.b].forEach((x) => { if (!seen.has(key(x))) entrants.push(x); }));
    r.ties.forEach((t) => [t.a, t.b].forEach((x) => seen.add(key(x))));
    const ent = entrants.map(seed).filter(Boolean);
    const byLeague = new Map(); ent.forEach((e) => { if (!byLeague.has(e.short)) byLeague.set(e.short, []); byLeague.get(e.short).push(e.pos); });
    const sub = ri === 0 || ent.length ? (ent.length ? `${ri === 0 ? '' : 'Nieuw: '}${[...byLeague.entries()].map(([lg, ps]) => `nr. ${ps.sort((x, y) => x - y).join(', ').replace(/, (\d+)$/, ' en $1')} van de ${lg}`).join(' · ')}` : '') : 'Winnaars van de vorige ronde';
    const last = ri === rs.length - 1;
    const final = last && /Finale/.test(r.title);
    return `<section class="po-rd">
      <h2 class="po-rd__t">${esc(r.title)}</h2>${sub ? `<p class="po-rd__sub">${esc(sub)}</p>` : ''}
      ${r.matches.map((m) => {
        const t = r.ties.find((x) => x.legs.includes(m));
        const leg = t && t.legs.length > 1 ? (m.leg || (t.legs[0] === m ? 'heen' : 'terug')) : '';
        const mine = isMe(m.home) || isMe(m.away);
        const score = m.hs != null ? `${m.hs}–${m.as}${m.pen ? ` <span class="muted">(${m.pen.home}–${m.pen.away} pen)</span>` : m.note && !/pen/.test(m.note) ? ` <span class="muted">(${esc(m.note)})</span>` : ''}` : `<span class="muted">${esc(m.date ? timeOf(m.date) : '')}</span>`;
        const cells = `<span class="po-m__d mono">${esc(m.date ? dayShort(m.date) : '')}</span>
          <span class="po-m__teams">${team(m.home, { link: !m.matchId })}<span class="po-m__dash">–</span>${team(m.away, { link: !m.matchId })}</span>
          <span class="po-m__s mono">${score}</span><span class="po-m__l mono">${esc(leg)}</span>`;
        return m.matchId ? `<a class="po-m ${mine ? 'is-me' : ''}" href="#/wedstrijd/${encodeURIComponent(m.matchId)}">${cells}</a>` : `<div class="po-m ${mine ? 'is-me' : ''}">${cells}</div>`;
      }).join('')}
      ${r.ties.some((t) => t.winner) ? `<div class="po-door"><span class="po-door__k mono">${final ? 'Winnaar' : 'Door'}</span>${r.ties.filter((t) => t.winner).map((t) => {
        const extra = [t.agg, t.pen ? `${t.pen} pen` : null].filter(Boolean).join(', ');
        let fate = '';
        if (final && info.key === 'nacompetitie') { const s = seed(t.winner); fate = s ? (s.leagueId === 75672 ? 'blijft in de Eredivisie' : 'promoveert') : ''; }
        return `<span class="po-door__w">${clubCrest(t.winner, 16)}<b class="${isMe(t.winner) ? 'po-me' : ''}">${esc(clubName(t.winner))}</b>${extra || fate ? ` <span class="muted">(${esc([extra, fate].filter(Boolean).join(' · '))})</span>` : ''}</span>`;
      }).join('')}</div>` : ''}
    </section>`;
  }).join('');
}
