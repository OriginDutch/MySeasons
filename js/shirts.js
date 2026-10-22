// Rugnummers per seizoen. players/{id}.shirts = { 2026: 31, 2025: 24 } (null = weggehaald).
// Oud formaat: één los `shirt`. Dat hoort bij één seizoen: het laatste seizoen bij de club (of nu, als hij er nog is).

import { CURRENT_SEASON } from './config.js';
import { spells } from './membership.js';
import { getMeta, setMeta, getPlayers, savePlayersBatch } from './store.js';

/** Seizoen (startjaar) van een datum: juli t/m juni. */
export const seasonOfDate = (d) => { const y = Number(String(d).slice(0, 4)); const m = Number(String(d).slice(5, 7)); return m >= 7 ? y : y - 1; };

function legacyYear(pr) {
  const sp = spells(pr || {}).spells || [];
  const last = sp[sp.length - 1];
  if (!last || !last.to) return CURRENT_SEASON;
  return Math.min(CURRENT_SEASON, seasonOfDate(last.to));
}

/** Alle nummers van een profiel, oud formaat meegerekend. */
export function shirtsOf(pr) {
  if (!pr) return {};
  const out = {};
  if (pr.shirt != null && pr.shirt !== '' && !pr.shirts) out[legacyYear(pr)] = Number(pr.shirt);
  Object.entries(pr.shirts || {}).forEach(([y, n]) => { if (n != null && n !== '') out[y] = Number(n); });
  return out;
}

/** Jouw nummer in dat seizoen, of null. */
export function shirtFor(pr, year) {
  const s = shirtsOf(pr);
  return s[year] ?? null;
}

/** Laatst bekende nummer (archief, spelers zonder opstellingen). Optioneel: niet later dan `upTo`. */
export function latestShirt(pr, upTo = null) {
  const s = shirtsOf(pr);
  const years = Object.keys(s).map(Number).filter((y) => upTo == null || y <= upTo).sort((a, b) => b - a);
  if (years.length) return s[years[0]];
  const any = Object.keys(s).map(Number).sort((a, b) => a - b);
  return any.length ? s[any[0]] : null;
}

/** Eenmalig: los `shirt` omzetten naar `shirts`. */
export async function migrateShirts() {
  const done = await getMeta('shirtsV1').catch(() => null);
  if (done && done.at) return null;
  const profiles = await getPlayers();
  const writes = [];
  Object.entries(profiles).forEach(([id, pr]) => {
    if (!pr || pr.shirts || pr.shirt == null || pr.shirt === '') return;
    writes.push([id, { shirts: { [legacyYear(pr)]: Number(pr.shirt) }, shirt: null }]);
  });
  if (writes.length) await savePlayersBatch(writes);
  await setMeta('shirtsV1', { at: new Date().toISOString(), moved: writes.length });
  return { moved: writes.length };
}

// ---------- Selectie per seizoen: eerste elftal of O21 ----------
// Regels (v0.47):
// 1. Transfer "Doorgestroomd uit de jeugd" op datum X: seizoenen vóór het seizoen van X = O21, vanaf dat seizoen = eerste.
// 2. Geen doorstroom, wel players/{id}.youth = true: alle seizoenen O21.
// 3. Niets: eerste elftal.
// Uitzondering: players/{id}.levels = { 2025: 'o21' } geldt alleen voor DAT seizoen (gaat voor 1–3).
// Oud formaat: squadLevel 'jeugd' uit je oude tracker = uitzondering voor zijn laatste seizoen.

export function levelsOf(pr) {
  if (!pr) return {};
  const out = {};
  if (!pr.levels && /jeugd|o\d\d|beloft/i.test(String(pr.squadLevel || ''))) out[legacyYear(pr)] = 'o21';
  Object.entries(pr.levels || {}).forEach(([y, v]) => { if (v === 'o21' || v === 'first') out[y] = v; });
  return out;
}

/** Seizoen van de (eerste) doorstroom, of null. */
export function promotedSeason(pr) {
  const ys = ((pr && pr.transfers) || []).filter((t) => t && t.type === 'promotie' && t.date).map((t) => seasonOfDate(t.date));
  return ys.length ? Math.min(...ys) : null;
}

/** Volgens de regels, zonder uitzondering. */
export function ruleLevel(pr, year) {
  const ps = promotedSeason(pr);
  if (ps != null) return Number(year) < ps ? 'o21' : 'first';
  return pr && pr.youth ? 'o21' : 'first';
}

/** 'o21' of 'first' voor dat seizoen. */
export function levelFor(pr, year) {
  if (!pr) return 'first';
  const ex = levelsOf(pr)[Number(year)];
  return ex || ruleLevel(pr, year);
}

/** Het oude gedrag (tot v0.46): een keuze gold ook voor de seizoenen erna. Alleen voor de omzetting. */
export function oldLevelFor(pr, year) {
  const lv = levelsOf(pr);
  const set = Object.keys(lv).map(Number).filter((y) => y <= Number(year)).sort((a, b) => b - a)[0];
  if (set == null) return 'first';
  if (lv[set] === 'o21') {
    const promoted = (pr.transfers || []).some((t) => t.type === 'promotie' && t.date && seasonOfDate(t.date) > set && seasonOfDate(t.date) <= Number(year));
    if (promoted) return 'first';
  }
  return lv[set];
}
