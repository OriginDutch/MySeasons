// Opslag in Firestore. Alle reads en writes van de app lopen via dit bestand.
//
// matches/{id}     genormaliseerde wedstrijd (+ detail zodra opgehaald)
// rawMatches/{id}  ruwe Highlightly-responses als JSON-tekst, voor herverwerking
// meta/sync        laatste synchronisatie
// meta/quota       aantal API-calls per dag (eigen telling)

import { db } from './firebase.js';
import {
  collection, doc, getDoc, getDocs, setDoc, writeBatch, increment,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

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
