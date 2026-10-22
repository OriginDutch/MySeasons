// Opslag in Firestore. Alle reads en writes van de app lopen via dit bestand.
//
// matches/{id}     genormaliseerde wedstrijd (+ detail zodra opgehaald)
// rawMatches/{id}  ruwe Highlightly-responses als JSON-tekst, voor herverwerking
// meta/sync        laatste synchronisatie
// meta/quota       aantal API-calls per dag (eigen telling)

import { db } from './firebase.js';
import { nameMatch as nameOnly, nameStandings, nameTeam, rawMatch, rawStandings } from './clubnames.js';
import { markShootout } from './shootout.js';
import { reconcileIds } from './reconcile.js';

// Bij elke gelezen wedstrijd: eigen clubnamen erop en de strafschoppenserie herkennen (telt niet als goals).
const nameMatch = (m) => markShootout(reconcileIds(nameOnly(m)));
import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, increment, deleteField, query, where, arrayUnion, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { createLive } from './live.js';

// Live cache: één listener per collectie/query, daarna alleen wijzigingen (zie live.js).
const live = createLive({ onSnapshot });
export const setLiveChangeHandler = (fn) => live.setHandler(fn);
const coll = (name) => live.docs(name, collection(db, name));
const one = async (name, id) => { const s = await live.doc(`${name}/${id}`, doc(db, name, String(id))); return s.exists() ? s.data() : null; };
const byId = async (name, id) => { const d = (await coll(name)).find((x) => x.id === String(id)); return d ? d.data() : null; };

// ---------- Handwerk per wedstrijd: matchNotes/{id} ----------
// { attendance, note, corrections: { [key]: { api, mine, at } }, updatedAt }

export async function getNotes(id) {
  return byId('matchNotes', id);
}

export async function getAllNotes() {
  const out = {};
  (await coll('matchNotes')).forEach((d) => { out[d.id] = d.data(); });
  return out;
}

export function saveNotes(id, partial) {
  return setDoc(doc(db, 'matchNotes', String(id)), { ...partial, updatedAt: new Date().toISOString() }, { merge: true });
}

/** Een zelf toegevoegde wedstrijd weghalen (basis, details en handwerk). Alleen voor manual-wedstrijden. */
export async function deleteMatch(id) {
  if (!String(id).startsWith('manual-')) throw new Error('Alleen zelf toegevoegde wedstrijden');
  await Promise.all([deleteDoc(doc(db, 'matches', String(id))), deleteDoc(doc(db, 'matchNotes', String(id)))]);
}

/** Handmatige details (manual.js) in één keer vervangen; null = weg. */
export function saveManual(id, manual) {
  return setDoc(doc(db, 'matchNotes', String(id)), { manual: manual === null ? deleteField() : manual, updatedAt: new Date().toISOString() }, { mergeFields: ['manual', 'updatedAt'] });
}

/** changes: { key: value | null }. null verwijdert die correctie. */
export function saveCorrections(id, changes) {
  const corrections = {};
  Object.entries(changes).forEach(([k, v]) => { corrections[k] = v === null ? deleteField() : v; });
  return setDoc(doc(db, 'matchNotes', String(id)), { corrections, updatedAt: new Date().toISOString() }, { merge: true });
}

// Wedstrijden: matches/{id} = de basis (datum, teams, uitslag, ronde) + hasDetail. De details (events,
// opstellingen, spelersstats, ~19 kB per duel) staan sinds v0.44 in matchDetails/{id} = { ...detail, season, matchId },
// en worden per seizoen geladen. Oude documenten met `detail` erin werken nog (worden bij het openen omgezet).

export const hasDetail = (m) => !!(m && (m.detail || m.hasDetail));

/** Alle wedstrijden, alleen de basis (snel, alle seizoenen). */
export async function getAllMatches() {
  return (await coll('matches')).map((d) => nameMatch(d.data()));
}

async function detailsOfSeason(season) {
  const q = query(collection(db, 'matchDetails'), where('season', '==', Number(season)));
  const out = new Map();
  (await live.docs(`md:${Number(season)}`, q)).forEach((d) => out.set(d.id, d.data()));
  return out;
}
const stripDetail = ({ season, matchId, ...detail }) => detail;

/** Details erbij voor deze wedstrijden (per seizoen één live query). Muteert en geeft de lijst terug. */
export async function attachDetails(list) {
  const seasons = [...new Set(list.filter((m) => !m.detail && m.hasDetail && m.league).map((m) => Number(m.league.season)))];
  const maps = new Map(await Promise.all(seasons.map(async (y) => [y, await detailsOfSeason(y)])));
  list.forEach((m) => {
    if (m.detail || !m.hasDetail || !m.league) return;
    const d = (maps.get(Number(m.league.season)) || new Map()).get(String(m.id));
    if (d) { m.detail = stripDetail(d); reconcileIds(m); markShootout(m); }
  });
  return list;
}

/** Wedstrijden van één seizoen, mét details. */
export async function getSeasonMatches(season) {
  const list = (await getAllMatches()).filter((m) => m.league && Number(m.league.season) === Number(season));
  return attachDetails(list);
}

export async function getMatch(id) {
  const m = await byId('matches', id);
  if (!m) return null;
  if (!m.detail && m.hasDetail) {
    const d = await one('matchDetails', id);
    if (d) m.detail = stripDetail(d);
  }
  reconcileIds(m);
  return nameMatch(m);
}

/** Eenmalig: details die nog ín matches staan naar matchDetails verhuizen. Eerst kopiëren, dan pas weghalen. */
export async function migrateDetails() {
  const snap = await getDocs(collection(db, 'matches'));
  const todo = snap.docs.filter((d) => d.data().detail);
  let moved = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const part = todo.slice(i, i + 50);
    const copy = writeBatch(db);
    part.forEach((d) => { const m = d.data(); copy.set(doc(db, 'matchDetails', d.id), { ...m.detail, season: m.league ? Number(m.league.season) : null, matchId: d.id }); });
    await copy.commit(); // pas als de kopie bij de server staat, gaat het origineel eruit
    const strip = writeBatch(db);
    part.forEach((d) => strip.set(doc(db, 'matches', d.id), { detail: deleteField(), hasDetail: true }, { merge: true }));
    await strip.commit();
    moved += part.length;
  }
  if (moved) await setMeta('detailsV2', { at: new Date().toISOString(), moved });
  return moved;
}

/** Programma opslaan. merge: een al opgehaald `detail` blijft staan. */
export async function saveMatches(list) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    list.slice(i, i + 400).forEach((m) => { const { detail, notes, ...plain } = rawMatch(m); batch.set(doc(db, 'matches', String(m.id)), plain, { merge: true }); });
    await batch.commit();
  }
  await indexTeams(list);
}

export async function saveMatchDetail(id, base, detail, raw) {
  const batch = writeBatch(db);
  const { detail: _old, ...plain } = rawMatch(base);
  batch.set(doc(db, 'matches', String(id)), { ...plain, hasDetail: true, detail: deleteField() }, { merge: true });
  batch.set(doc(db, 'matchDetails', String(id)), { ...detail, season: base && base.league ? Number(base.league.season) : null, matchId: String(id) });
  batch.set(doc(db, 'rawMatches', String(id)), raw, { merge: true });
  await batch.commit();
}

const standingsId = (leagueId, season) => `${leagueId}_${season}`;

export async function getStandings(leagueId, season) {
  const st = await one('standings', standingsId(leagueId, season));
  return st ? nameStandings(st) : null;
}

export function saveStandings(leagueId, season, data) {
  return setDoc(doc(db, 'standings', standingsId(leagueId, season)), rawStandings(data));
}

export async function getMeta(name) {
  return byId('meta', name);
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
  const out = {};
  (await coll('players')).forEach((d) => { out[d.id] = d.data(); });
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
  return (await coll('news')).map((d) => d.data());
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
  return (await coll('seasons')).map((d) => d.data());
}

export function saveSeason(year, data) {
  return setDoc(doc(db, 'seasons', String(year)), { year: Number(year), ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

// ---------- RSSSF: rsssf/{seizoensjaar} ----------
// Gelezen seizoenspagina: eindstanden, uitslagen, nacompetitie, beker en de zelfcontrole.

export async function getRsssf(year) {
  return one('rsssf', year);
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
  return (await live.docs(`lm:${Number(leagueId)}:${Number(season)}`, q)).map((d) => nameMatch(d.data()));
}

export async function saveLeagueMatches(list) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    list.slice(i, i + 400).forEach((m) => batch.set(doc(db, 'leagueMatches', String(m.id)), rawMatch(m), { merge: true }));
    await batch.commit();
  }
  await indexTeams(list);
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
  return (await coll('coaches')).map((d) => ({ id: d.id, ...d.data() }));
}
export async function saveCoachesBatch(list) {
  const batch = writeBatch(db);
  list.forEach((c) => batch.set(doc(db, 'coaches', String(c.id)), c, { merge: true }));
  await batch.commit();
}

// ---------- Clubmarkeringen: clubs/{teamId} (rivaal, interessant, notitie) ----------
export async function getClubMarks() {
  const out = {};
  (await coll('clubs')).forEach((d) => { out[d.id] = d.data(); });
  return out;
}
export async function saveClubMarksBatch(entries) {
  const batch = writeBatch(db);
  entries.forEach(([id, data]) => batch.set(doc(db, 'clubs', String(id)), data, { merge: true }));
  await batch.commit();
}

/** Alle clubs die de app kent (uit Cambuur-wedstrijden en competitiewedstrijden), uniek op id. */
// Teamindex: meta/teamIndex = { teams: { [id]: { name, logo } }, builtAt }. Eén document in plaats van alle
// wedstrijden lezen (duizenden reads). Wordt bijgewerkt bij elke opgeslagen wedstrijd en eens per 30 dagen
// helemaal opnieuw opgebouwd, voor de zekerheid.
const TEAM_INDEX_DAYS = 30;
const teamsOf = (list) => {
  const out = {};
  (list || []).forEach((m) => [m && m.homeTeam, m && m.awayTeam].forEach((t) => { if (t && t.id != null && /^\d+$/.test(String(t.id))) out[String(t.id)] = { name: t.apiName || t.name || '', logo: t.logo || null }; }));
  return out;
};
function indexTeams(list) {
  const teams = teamsOf(list);
  if (!Object.keys(teams).length) return Promise.resolve();
  return setDoc(doc(db, 'meta', 'teamIndex'), { teams }, { merge: true }).catch(() => {});
}
const fromIndex = (teams) => Object.entries(teams || {}).map(([id, t]) => nameTeam({ id: Number(id), name: t.name, logo: t.logo || null }));

export async function rebuildTeamIndex() {
  const [a, b] = await Promise.all([getDocs(collection(db, 'matches')), getDocs(collection(db, 'leagueMatches'))]);
  const teams = teamsOf([...a.docs, ...b.docs].map((d) => d.data()));
  await setDoc(doc(db, 'meta', 'teamIndex'), { teams, builtAt: new Date().toISOString() });
  return teams;
}

export async function getAllLeagueTeams() {
  const d = await getMeta('teamIndex');
  const fresh = d && d.builtAt && Date.now() - Date.parse(d.builtAt) < TEAM_INDEX_DAYS * 864e5;
  if (d && d.teams && Object.keys(d.teams).length && fresh) return fromIndex(d.teams);
  return fromIndex(await rebuildTeamIndex());
}

// ---------- Competitie-index: leagueIndex/{leagueId}_{season} ----------
// Klein overzicht per competitie-seizoen, zodat de nachtploeg niet elke keer duizenden wedstrijden hoeft te lezen.
// { ids: [...], finished: [...], withEvents: [...] }

export async function getLeagueIndexes() {
  return (await coll('leagueIndex')).map((d) => ({ key: d.id, ...d.data() }));
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
  const step = name === 'photos' ? 20 : 400; // foto's zijn groot: kleine batches (max. 10 MB per verzoek)
  for (let i = 0; i < docs.length; i += step) {
    const batch = writeBatch(db);
    docs.slice(i, i + step).forEach(({ id, data }) => batch.set(doc(db, name, String(id)), data, { merge: true }));
    await batch.commit();
    n += Math.min(step, docs.length - i);
    if (onProgress) onProgress(n);
  }
  return n;
}

// ---------- Foto's: photos/{autoId} ----------
// { owner: 'player:123' | 'coach:abc' | 'stadium:456', season, thumb, small, large, w, h, bytes, hash,
//   source: 'upload' | 'link', sourceUrl, addedAt }. Verwijzing naar de hoofdfoto staat bij de eigenaar
// (players/coaches.gallery, clubs.stadiumGallery), met een klein plaatje voor lijsten.

export async function getPhotos(owner) {
  return (await live.docs(`ph:${owner}`, query(collection(db, 'photos'), where('owner', '==', owner)))).map((d) => ({ id: d.id, ...d.data() }));
}
export async function addPhoto(data) {
  const ref = doc(collection(db, 'photos'));
  await setDoc(ref, data);
  return ref.id;
}
export function updatePhoto(id, patch) {
  return setDoc(doc(db, 'photos', String(id)), patch, { merge: true });
}
export function deletePhoto(id) {
  return deleteDoc(doc(db, 'photos', String(id)));
}
const GALLERY_AT = { player: ['players', 'gallery'], coach: ['coaches', 'gallery'], stadium: ['clubs', 'stadiumGallery'] };
/** Galerijverwijzing bij de eigenaar in zijn geheel vervangen (mergeFields: geen oude seizoenen laten staan). */
export function setOwnerGallery(kind, id, gallery) {
  const [col, field] = GALLERY_AT[kind];
  return setDoc(doc(db, col, String(id)), { [field]: gallery }, { mergeFields: [field] });
}
/** Stand van de wekelijkse linkcontrole bij de eigenaar: { url, hash, at, pending: { hash, at } | null }. */
export function setOwnerLinkCheck(kind, id, lc) {
  const [col] = GALLERY_AT[kind];
  return setDoc(doc(db, col, String(id)), { photoLinkCheck: lc }, { mergeFields: ['photoLinkCheck'] });
}
