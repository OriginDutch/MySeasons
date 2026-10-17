// Ophalen bij Highlightly en opslaan. Elke functie zegt vooraf hoeveel calls ze kost.

import { hl } from './api.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import { normalizeListMatch, normalizeDetail } from './normalize.js';
import { saveMatches, saveMatchDetail, setMeta, countCalls } from './store.js';

export const COST = { season: 2, match: 3 };

/** Programma + uitslagen van de hoofdclub dit seizoen. Kost 2 calls (thuis + uit). */
export async function syncSeason() {
  const teamId = MAIN_CLUB.id;
  let calls = 0;
  try {
    const home = await hl('/matches', { homeTeamId: teamId, season: CURRENT_SEASON, limit: 100 });
    calls++;
    const away = await hl('/matches', { awayTeamId: teamId, season: CURRENT_SEASON, limit: 100 });
    calls++;
    const all = [...(home && home.data || []), ...(away && away.data || [])];
    const unique = [...new Map(all.map((m) => [m.id, m])).values()];
    const list = unique.map(normalizeListMatch);
    await saveMatches(list);
    await setMeta('sync', { lastSeasonSync: new Date().toISOString(), season: CURRENT_SEASON, matchCount: list.length });
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
