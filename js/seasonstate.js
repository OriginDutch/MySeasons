// Welk seizoen je bekijkt. Bewust niet bewaard: de app opent altijd in het huidige seizoen.

import { CURRENT_SEASON } from './config.js';

let selected = CURRENT_SEASON;

export const getSeason = () => selected;
export const isCurrentSeason = () => selected === CURRENT_SEASON;
export function setSeason(year) { selected = Number(year) || CURRENT_SEASON; }

/** 2025 → "2025–26". */
export const seasonLabel = (year = selected) => `${year}–${String(Number(year) + 1).slice(2)}`;

/** Seizoen van een wedstrijd volgens Highlightly (league.season), of null. */
export const seasonOf = (m) => (m && m.league && m.league.season != null ? Number(m.league.season) : null);

export const inSeason = (year = selected) => (m) => seasonOf(m) === Number(year);
