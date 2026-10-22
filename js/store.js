// Opslag in Firestore. Alle reads en writes van de app lopen via dit bestand.
//
// matches/{id}     genormaliseerde wedstrijd (+ detail zodra opgehaald)
// rawMatches/{id}  ruwe Highlightly-responses als JSON-tekst, voor herverwerking
// meta/sync        laatste synchronisatie
// meta/quota       aantal API-calls per dag (eigen telling)

import { db } from './firebase.js';
import { nameMatch, nameStandings, nameTeam, rawMatch, rawStandings } from './clubnames.js';
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, increment, deleteField, query, where, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

// ---------- Handwerk per wedstrijd: matchNotes/{id} ----------
// { attendance, note, corrections: { [key]: { api, mine, at } }, updatedAt }

export async function getNotes(id) {
  const snap = await getDoc(doc(db, 'matchNotes', String(id)));
  return snap.exists() ? snap.data() : null;
}

export async function getAllNotes() {
  const snap = await getDocs(collection(db, 'matchNotes'));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data(); });
  return out;
}

export function saveNotes(id, partial) {
  return setDoc(doc(db, 'matchNotes', String(id)), { ...partial, updatedAt: new Date().toISOString() }, { merge: true });
}

/** changes: { key: value | null }. null verwijdert die correctie. */
export function saveCorrections(id, changes) {
  const corrections = {};
  Object.entries(changes).forEach(([k, v]) => { corrections[k] = v === null ? deleteField() : v; });
  return setDoc(doc(db, 'matchNotes', String(id)), { corrections, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function getAllMatches() {
  const snap = await getDocs(collection(db, 'matches'));
  return snap.docs.map((d) => nameMatch(d.data()));
}

export async function getMatch(id) {
  const snap = await getDoc(doc(db, 'matches', String(id)));
  return snap.exists() ? nameMatch(snap.data()) : null;
}

/** Programma opslaan. merge: een al opgehaald `detail` blijft staan. */
export async function saveMatches(list) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    list.slice(i, i + 400).forEach((m) => batch.set(doc(db, 'matches', String(m.id)), rawMatch(m), { merge: true }));
    await batch.commit();
  }
}

export async function saveMatchDetail(id, base, detail, raw) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'matches', String(id)), { ...rawMatch(base), detail }, { merge: true });
  batch.set(doc(db, 'rawMatches', String(id)), raw, { merge: true });
  await batch.commit();
}

const standingsId = (leagueId, season) => `${leagueId}_${season}`;

export async function getStandings(leagueId, season) {
  const snap = await getDoc(doc(db, 'standings', standingsId(leagueId, season)));
  return snap.exists() ? nameStandings(snap.data()) : null;
}

export function saveStandings(leagueId, season, data) {
  return setDoc(doc(db, 'standings', standingsId(leagueId, season)), rawStandings(data));
}

export async function getMeta(name) {
  const snap = await getDoc(doc(db, 'meta', name));
  return snap.exists() ? snap.data() : null;
}

/** Meta-document in zijn geheel vervangen (geen merge). */
export function replaceMeta(name, data) {
  return setDoc(doc(db, 'meta', name), data);
}

export function setMeta(name, data) {
  return setDoc(doc(db, 'meta', name), data, { merge: true });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function countCalls(n) {
  const current = await getMeta('quota');
  if (!current || current.day !== today()) {
    await setMeta('quota', { day: today(), count: n });
  } else {
    await setMeta('quota', { count: increment(n) });
  }
}

/**
 * Wat Highlightly zelf zegt over je quotum (header via de Worker, of de laatste nachtploegronde).
 * Eigen telling mist calls van de Worker tot de brievenbus geleegd is; Highlightly weet het altijd.
 */
let lastNoted = null;
export async function noteRateLimit({ remaining, limit, at = new Date().toISOString() } = {}) {
  if (remaining == null || Number.isNaN(Number(remaining))) return;
  const key = `${String(at).slice(0, 10)}:${remaining}`;
  if (key === lastNoted) return;
  lastNoted = key;
  const q = (await getMeta('quota')) || {};
  if (q.hl && q.hl.at && q.hl.at > at) return; // nieuwere meting al bekend
  await setMeta('quota', { hl: { remaining: Number(remaining), limit: Number(limit) || 100, at } });
}

/** Calls vandaag: het hoogste van je eigen telling en wat Highlightly zegt. */
export async function getCallsToday() {
  const q = (await getMeta('quota')) || {};
  const own = q.day === today() ? q.count || 0 : 0;
  const hl = q.hl && String(q.hl.at || '').slice(0, 10) === today() ? Math.max(0, (q.hl.limit || 100) - q.hl.remaining) : 0;
  return Math.max(own, hl);
}

// ---------- Spelersprofielen: players/{id} ----------
// { fullName, shortName, updatedAt }. Later ook contract, marktwaarde, blessures.

export async function getPlayers() {
  const snap = await getDocs(collection(db, 'players'));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data(); });
  return out;
}

/** Profiel helemaal weg (alleen voor eigen/oude spelers zonder Highlightly-koppeling). */
export function deletePlayer(id) {
  return deleteDoc(doc(db, 'players', String(id)));
}

export function savePlayer(id, partial) {
  return setDoc(doc(db, 'players', String(id)), { ...partial, updatedAt: new Date().toISOString() }, { merge: true });
}

// ---------- Nieuws: news/{id} ----------
// Alleen kop, teaser, link, datum en clubs. Zo blijft clubnieuws bewaard als de feed doorschuift.

export async function getNews() {
  const snap = await getDocs(collection(db, 'news'));
  return snap.docs.map((d) => d.data());
}

export async function saveNews(items) {
  if (!items.length) return;
  const batch = writeBatch(db);
  items.forEach((n) => batch.set(doc(db, 'news', n.id), n, { merge: true }));
  await batch.commit();
}

// ---------- Seizoenen: seasons/{jaar} ----------
// { year, source: 'highlightly' | 'manual', follows: [leagueId], createdAt }

export async function getSeasons() {
  const snap = await getDocs(collection(db, 'seasons'));
  return snap.docs.map((d) => d.data());
}

export function saveSeason(year, data) {
  return setDoc(doc(db, 'seasons', String(year)), { year: Number(year), ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

// ---------- RSSSF: rsssf/{seizoensjaar} ----------
// Gelezen seizoenspagina: eindstanden, uitslagen, nacompetitie, beker en de zelfcontrole.

export async function getRsssf(year) {
  const snap = await getDoc(doc(db, 'rsssf', String(year)));
  return snap.exists() ? snap.data() : null;
}

export async function getAllRsssf() {
  const snap = await getDocs(collection(db, 'rsssf'));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data(); });
  return out;
}

export function saveRsssf(year, data) {
  return setDoc(doc(db, 'rsssf', String(year)), data);
}

/** Meerdere spelersprofielen tegelijk (merge), in batches van 400. writes: [[id, data], ...] */
export async function savePlayersBatch(writes) {
  const at = new Date().toISOString();
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    writes.slice(i, i + 400).forEach(([id, data]) => batch.set(doc(db, 'players', String(id)), { ...data, updatedAt: at }, { merge: true }));
    await batch.commit();
  }
}

// ---------- Competitiewedstrijden: leagueMatches/{id} ----------
// Alle uitslagen en het programma van een hele competitie (ook duels zonder Cambuur). Alleen de basis, geen details.

export async function getLeagueMatches(leagueId, season) {
  const q = query(collection(db, 'leagueMatches'), where('league.id', '==', Number(leagueId)), where('league.season', '==', Number(season)));
  const snap = await getDocs(q);
  return snap.docs.map((d) => nameMatch(d.data()));
}

export async function saveLeagueMatches(list) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    list.slice(i, i + 400).forEach((m) => batch.set(doc(db, 'leagueMatches', String(m.id)), rawMatch(m), { merge: true }));
    await batch.commit();
  }
}

// ---------- Handwerk in bulk (import) ----------

/** matchNotes in bulk (merge). entries: [[matchId, data], ...] */
export async function saveNotesBatch(entries) {
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(db);
    entries.slice(i, i + 400).forEach(([id, data]) => batch.set(doc(db, 'matchNotes', String(id)), { ...data, updatedAt: new Date().toISOString() }, { merge: true }));
    await batch.commit();
  }
}

// ---------- Trainers: coaches/{id} ----------
export async function getCoaches() {
  const snap = await getDocs(collection(db, 'coaches'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function saveCoachesBatch(list) {
  const batch = writeBatch(db);
  list.forEach((c) => batch.set(doc(db, 'coaches', String(c.id)), c, { merge: true }));
  await batch.commit();
}

// ---------- Clubmarkeringen: clubs/{teamId} (rivaal, interessant, notitie) ----------
export async function getClubMarks() {
  const snap = await getDocs(collection(db, 'clubs'));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data(); });
  return out;
}
export async function saveClubMarksBatch(entries) {
  const batch = writeBatch(db);
  entries.forEach(([id, data]) => batch.set(doc(db, 'clubs', String(id)), data, { merge: true }));
  await batch.commit();
}

/** Alle clubs die de app kent (uit Cambuur-wedstrijden en competitiewedstrijden), uniek op id. */
export async function getAllLeagueTeams() {
  const [a, b] = await Promise.all([getDocs(collection(db, 'matches')), getDocs(collection(db, 'leagueMatches'))]);
  const map = new Map();
  [...a.docs, ...b.docs].forEach((d) => { const m = d.data(); [m.homeTeam, m.awayTeam].forEach((t) => { if (t && t.id) map.set(t.id, nameTeam({ id: t.id, name: t.apiName || t.name, logo: t.logo || null })); }); });
  return [...map.values()];
}

// ---------- Competitie-index: leagueIndex/{leagueId}_{season} ----------
// Klein overzicht per competitie-seizoen, zodat de nachtploeg niet elke keer duizenden wedstrijden hoeft te lezen.
// { ids: [...], finished: [...], withEvents: [...] }

export async function getLeagueIndexes() {
  const snap = await getDocs(collection(db, 'leagueIndex'));
  return snap.docs.map((d) => ({ key: d.id, ...d.data() }));
}

export function addToLeagueIndex(leagueId, season, { ids = [], finished = [], withEvents = [] }) {
  const data = { leagueId: Number(leagueId), season: Number(season), updatedAt: new Date().toISOString() };
  if (ids.length) data.ids = arrayUnion(...ids);
  if (finished.length) data.finished = arrayUnion(...finished);
  if (withEvents.length) data.withEvents = arrayUnion(...withEvents);
  return setDoc(doc(db, 'leagueIndex', `${leagueId}_${season}`), data, { merge: true });
}

// ---------- Backup: hele collecties lezen en terugzetten ----------

/** Alle documenten van een collectie als [{ id, data }]. */
export async function dumpCollection(name) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/** Documenten terugzetten (samenvoegen), in batches van 400. Geeft het aantal writes terug. */
export async function restoreCollection(name, docs, onProgress) {
  let n = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach(({ id, data }) => batch.set(doc(db, name, String(id)), data, { merge: true }));
    await batch.commit();
    n += Math.min(400, docs.length - i);
    if (onProgress) onProgress(n);
  }
  return n;
}
