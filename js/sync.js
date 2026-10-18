// Ophalen bij Highlightly en opslaan. Elke functie zegt vooraf hoeveel calls ze kost.

import { hl } from './api.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import { getSeason } from './seasonstate.js';
import { normalizeListMatch, normalizeDetail, normalizeStandings } from './normalize.js';
import { saveMatches, saveMatchDetail, saveStandings, setMeta, countCalls, saveLeagueMatches, addToLeagueIndex } from './store.js';
import { mainLeague } from './season.js';

export const COST = { season: 3, match: 3, standings: 1, league: 4 };

/** Stand van één competitie. Kost 1 call. */
async function fetchAndSaveStandings(leagueId, season) {
  const raw = await hl('/standings', { leagueId, season });
  const data = normalizeStandings(raw);
  await saveStandings(leagueId, season, { ...data, fetchedAt: new Date().toISOString() });
  return data;
}

export async function syncStandings(leagueId, season = getSeason()) {
  let calls = 0;
  try {
    calls++;
    return await fetchAndSaveStandings(leagueId, season);
  } finally {
    await countCalls(calls);
  }
}

/**
 * Programma + uitslagen van de hoofdclub dit seizoen, en daarna de stand
 * van de hoofdcompetitie. Kost 3 calls (thuis, uit, stand).
 */
export async function syncSeason(season = getSeason()) {
  const teamId = MAIN_CLUB.id;
  let calls = 0;
  try {
    const home = await hl('/matches', { homeTeamId: teamId, season, limit: 100 });
    calls++;
    const away = await hl('/matches', { awayTeamId: teamId, season, limit: 100 });
    calls++;
    const all = [...(home && home.data || []), ...(away && away.data || [])];
    const unique = [...new Map(all.map((m) => [m.id, m])).values()];
    const list = unique.map(normalizeListMatch);
    await saveMatches(list);
    const stamp = { lastSeasonSync: new Date().toISOString(), season, matchCount: list.length };
    await setMeta(`sync_${season}`, stamp);
    if (season === CURRENT_SEASON) await setMeta('sync', stamp);

    const league = mainLeague(list);
    if (league) {
      calls++;
      try {
        await fetchAndSaveStandings(league.id, season);
      } catch (err) {
        console.warn('Stand ophalen mislukt', err); // programma is wel binnen; stand later opnieuw
      }
    }
    return list.length;
  } finally {
    if (calls) await countCalls(calls);
  }
}

/** Volledige wedstrijd: detail, opstellingen en box score. Kost 3 calls. */
export async function fetchMatch(id) {
  let calls = 0;
  try {
    const detail = await hl(`/matches/${id}`);
    calls++;
    const lineups = await hl(`/lineups/${id}`);
    calls++;
    const box = await hl(`/box-score/${id}`);
    calls++;
    const { base, detail: normalized } = normalizeDetail(detail, lineups, box);
    // Ruwe data als tekst: Firestore kan geen geneste arrays opslaan.
    const raw = {
      detail: JSON.stringify(detail),
      lineups: JSON.stringify(lineups),
      boxScore: JSON.stringify(box),
      fetchedAt: normalized.fetchedAt,
    };
    await saveMatchDetail(id, base, normalized, raw);
    return normalized;
  } finally {
    if (calls) await countCalls(calls);
  }
}

/** Gespeelde officiële wedstrijden (geen oefenduels) zonder details. */
export function missingDetails(list) {
  return list.filter((m) => m.status === 'finished' && !m.detail && m.league && !/friendl/i.test(m.league.name));
}

/**
 * Haalt de details op van alle wedstrijden in `list`, één voor één. Kost 3 calls per wedstrijd.
 * Stopt bij de eerste fout (bijv. quotum op); wat al binnen is, blijft bewaard.
 */
export async function fetchMany(list, onProgress) {
  let done = 0;
  for (const m of list) {
    await fetchMatch(m.id);
    done++;
    if (onProgress) onProgress(done, list.length);
  }
  return done;
}

/**
 * Alle wedstrijden van een competitie in een seizoen (uitslagen + programma), per 100.
 * Kost 1 call per 100 wedstrijden: Eredivisie (306) = 4, KKD (380) = 4.
 */
export async function syncLeague(leagueId, season = getSeason()) {
  let calls = 0; let offset = 0; let total = Infinity;
  const all = [];
  try {
    while (offset < total && calls < 8) {
      const res = await hl('/matches', { leagueId, season, limit: 100, offset });
      calls++;
      const data = (res && res.data) || [];
      all.push(...data);
      total = res && res.pagination && res.pagination.totalCount != null ? res.pagination.totalCount : (data.length < 100 ? 0 : Infinity);
      if (!data.length) break;
      offset += data.length;
    }
    const list = [...new Map(all.map((m) => [m.id, m])).values()].map(normalizeListMatch);
    await saveLeagueMatches(list);
    await addToLeagueIndex(leagueId, season, { ids: list.map((m) => m.id), finished: list.filter((m) => m.status === 'finished').map((m) => m.id) });
    await setMeta(`league_${leagueId}_${season}`, { fetchedAt: new Date().toISOString(), count: list.length, calls });
    return { count: list.length, calls };
  } finally {
    if (calls) await countCalls(calls);
  }
}
