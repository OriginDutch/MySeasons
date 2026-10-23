// RSSSF-duels van de hoofdclub omzetten naar gewone (zelf toegevoegde) wedstrijden, voor seizoenen waarvan
// Highlightly geen gespeelde wedstrijden heeft (2019/20: alleen de afgelaste rondes; 2018/19 en eerder: niets).
// Daarna staan ze in Wedstrijden, tellen ze mee in je overzichten en kun je per duel details invullen.
//
// Elke wedstrijd krijgt een vast id (manual-rs<jaar>-…), dus opnieuw omzetten maakt geen dubbelen.
// Highlightly en de nachtploeg slaan ze over (manual: true). Weghalen kan per seizoen in één keer.

import { MAIN_CLUB } from './config.js';
import { getAllMatches, saveMatches, deleteMatch } from './store.js';
import { getRsssf, mainDivision } from './rsssfimport.js';
import { tokens } from './rsssf.js';
import { nameRs } from './clubnames.js';
import { twinOf } from './season.js';

const TEAM = MAIN_CLUB.id;
const CUP = { id: 77374, name: 'KNVB Beker' };
const clean = (n) => String(n || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isMain = (name) => tokens(name).includes(tokens(MAIN_CLUB.name)[0]);
export const prefixOf = (year) => `manual-rs${year}-`;

function team(name, own) {
  if (own) return { id: TEAM, name: MAIN_CLUB.name, logo: null };
  const t = nameRs({ id: `rs:${clean(name)}`, name: clean(name), logo: null });
  return { id: t.hlId ?? `rs:${clean(name)}`, name: t.name, logo: t.logo || null };
}

/** De Cambuur-duels uit de RSSSF-basis als wedstrijddocumenten (nog niet opgeslagen). */
export async function rsssfMatches(year) {
  const rs = await getRsssf(year);
  if (!rs) return { list: [], reason: 'Geen RSSSF-basis voor dit seizoen' };
  const div = mainDivision(rs);
  const check = div && (rs.checks || []).find((c) => c.name === div.name);
  if (check && !check.ok) return { list: [], reason: `De RSSSF-controle van de ${div.name} klopt niet (${(check.problems || [])[0] || 'onbekend'}). Doe eerst "RSSSF opnieuw".` };
  // Standregels die als uitslag gelezen zijn (oude lezer, "1.FC Den Bosch   19 12 4 3") nooit omzetten.
  const own = (all) => all.filter((m) => m.status === 'played' && !/^\d+\./.test(m.home) && !/^\d+\./.test(m.away) && (isMain(m.homeFull || m.home) || isMain(m.awayFull || m.away)));
  const ownT = (await getAllMatches().catch(() => [])).map((m) => [m.homeTeam, m.awayTeam]).flat().find((t) => t && t.id === TEAM);
  const build = (m, league, round) => {
    const hn = m.homeFull || m.home; const an = m.awayFull || m.away;
    const home = team(hn, isMain(hn)); const away = team(an, isMain(an));
    [home, away].forEach((t) => { if (t.id === TEAM && ownT) { t.name = ownT.name; t.logo = ownT.logo || null; } });
    return {
      id: `${prefixOf(year)}${slug(league.name)}-${slug(round)}-${slug(clean(hn))}-${slug(clean(an))}`,
      manual: true, source: 'rsssf', dateOnly: true,
      date: m.date ? `${m.date}T12:00:00.000Z` : `${year}-08-01T12:00:00.000Z`,
      round, league: { id: league.id, name: league.name, season: year },
      homeTeam: home, awayTeam: away, status: 'finished', stateText: m.aet ? 'Na verlenging' : 'Finished',
      score: { home: m.hs, away: m.as }, penalties: m.penalties || null, rsNote: m.note || null,
      createdAt: new Date().toISOString(),
    };
  };
  const list = [];
  if (div && div.leagueId) {
    const league = { id: div.leagueId, name: div.name };
    own(div.matches).forEach((m) => list.push(build(m, league, m.stage === 'regular' && m.round ? `Regular Season - ${m.round}` : (m.label || (m.stage === 'nacompetitie' ? 'Nacompetitie' : 'Play-offs')))));
  }
  if (rs.cup && rs.cup.matches) own(rs.cup.matches).forEach((m) => list.push(build(m, CUP, m.label || 'Beker')));
  return { list, division: div ? div.name : null };
}

/** Omzetten. Slaat duels over die Highlightly al als gespeeld heeft. */
export async function convertRsssf(year) {
  const { list, reason } = await rsssfMatches(year);
  if (!list.length) return { added: 0, skipped: 0, reason: reason || 'Geen duels van de club gevonden in de RSSSF-basis' };
  const all = await getAllMatches().catch(() => []);
  const hl = all.filter((m) => !String(m.id).startsWith(prefixOf(year)));
  const fresh = list.filter((m) => !twinOf({ ...m, status: 'scheduled' }, hl));
  await saveMatches(fresh);
  return { added: fresh.length, skipped: list.length - fresh.length };
}

/** Alle omgezette duels van dat seizoen weghalen (inclusief wat je erbij invulde). */
export async function removeConverted(year) {
  const all = await getAllMatches().catch(() => []);
  const mine = all.filter((m) => String(m.id).startsWith(prefixOf(year)));
  for (const m of mine) await deleteMatch(m.id);
  return mine.length;
}
