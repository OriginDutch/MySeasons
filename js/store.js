// Opslag in Firestore. Alle reads en writes van de app lopen via dit bestand.
//
// matches/{id}     genormaliseerde wedstrijd (+ detail zodra opgehaald)
// rawMatches/{id}  ruwe Highlightly-responses als JSON-tekst, voor herverwerking
// meta/sync        laatste synchronisatie
// meta/quota       aantal API-calls per dag (eigen telling)

import { db } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, setDoc, writeBatch, increment, deleteField,
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
  return snap.docs.map((d) => d.data());
}

export async function getMatch(id) {
  const snap = await getDoc(doc(db, 'matches', String(id)));
  return snap.exists() ? snap.data() : null;
}

/** Programma opslaan. merge: een al opgehaald `detail` blijft staan. */
export async function saveMatches(list) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    list.slice(i, i + 400).forEach((m) => batch.set(doc(db, 'matches', String(m.id)), m, { merge: true }));
    await batch.commit();
  }
}

export async function saveMatchDetail(id, base, detail, raw) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'matches', String(id)), { ...base, detail }, { merge: true });
  batch.set(doc(db, 'rawMatches', String(id)), raw, { merge: true });
  await batch.commit();
}

const standingsId = (leagueId, season) => `${leagueId}_${season}`;

export async function getStandings(leagueId, season) {
  const snap = await getDoc(doc(db, 'standings', standingsId(leagueId, season)));
  return snap.exists() ? snap.data() : null;
}

export function saveStandings(leagueId, season, data) {
  return setDoc(doc(db, 'standings', standingsId(leagueId, season)), data);
}

export async function getMeta(name) {
  const snap = await getDoc(doc(db, 'meta', name));
  return snap.exists() ? snap.data() : null;
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

export async function getCallsToday() {
  const q = await getMeta('quota');
  return q && q.day === today() ? q.count || 0 : 0;
}

// ---------- Spelersprofielen: players/{id} ----------
// { fullName, shortName, updatedAt }. Later ook contract, marktwaarde, blessures.

export async function getPlayers() {
  const snap = await getDocs(collection(db, 'players'));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data(); });
  return out;
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
