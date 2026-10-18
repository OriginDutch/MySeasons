// Eigen clubnamen. Highlightly heet "GO Ahead Eagles"? Jij zegt "Go Ahead Eagles".
//
// Opslag: clubs/{teamId} (zelfde doc als rivaal/notitie) met nameOverride, shortName en code.
// Toepassen: bij het LEZEN uit store.js krijgt elk team-object je naam (team.name), plus short en code.
// De Highlightly-naam blijft bewaard als team.apiName. Bij het SCHRIJVEN gaat altijd de Highlightly-naam
// terug de database in, zodat een naam terugzetten nooit iets kwijtmaakt.

const overrides = new Map(); // id -> { name, short, code }
let loaded = false;

export const clubNamesLoaded = () => loaded;

/** marks: uitkomst van getClubMarks() ({ [id]: { nameOverride, shortName, code, ... } }). */
export function setClubOverrides(marks) {
  overrides.clear();
  Object.entries(marks || {}).forEach(([id, m]) => setOne(id, m));
  loaded = true;
}

export function setOne(id, m) {
  const o = { name: clean(m && m.nameOverride), short: clean(m && m.shortName), code: clean(m && m.code).toUpperCase().slice(0, 4) };
  if (o.name || o.short || o.code) overrides.set(String(id), o); else overrides.delete(String(id));
}

export const overrideOf = (id) => overrides.get(String(id)) || null;

const clean = (v) => String(v || '').trim().slice(0, 60);

/** Standaardcode: "FC Twente" -> TWE, "Go Ahead Eagles" -> GO… zoals voorheen. */
export function defaultCode(name) {
  return String(name || '?').replace(/^(FC|SC|sc|SV|AFC|Jong)\s+/, '').slice(0, 3).toUpperCase();
}

/** Team-object (muteert): eigen naam erop, Highlightly-naam in apiName. */
export function nameTeam(t) {
  if (!t || typeof t !== 'object') return t;
  const api = t.apiName || t.name;
  const o = t.id != null ? overrides.get(String(t.id)) : null;
  t.apiName = api;
  t.name = (o && o.name) || api;
  t.short = (o && o.short) || t.name;
  t.code = (o && o.code) || defaultCode(t.name);
  return t;
}

export function nameMatch(m) {
  if (m) { nameTeam(m.homeTeam); nameTeam(m.awayTeam); }
  return m;
}

export function nameStandings(st) {
  if (st && st.groups) st.groups.forEach((g) => (g.rows || []).forEach((r) => nameTeam(r.team)));
  return st;
}

/** Terug naar Highlightly-naam voor opslag. Geeft een kopie. */
export function rawTeam(t) {
  if (!t || typeof t !== 'object') return t;
  const { short, code, apiName, ...rest } = t;
  const api = apiName || t.name;
  return { ...rest, name: api, apiName: api };
}

export function rawMatch(m) {
  if (!m || typeof m !== 'object') return m;
  const out = { ...m };
  if (m.homeTeam) out.homeTeam = rawTeam(m.homeTeam);
  if (m.awayTeam) out.awayTeam = rawTeam(m.awayTeam);
  return out;
}

export function rawStandings(st) {
  if (!st || !st.groups) return st;
  return { ...st, groups: st.groups.map((g) => ({ ...g, rows: (g.rows || []).map((r) => ({ ...r, team: rawTeam(r.team) })) })) };
}

/** Code voor krappe plekken (seizoensstrip). Werkt ook op teams die niet via de store kwamen. */
export function clubCode(t) {
  if (!t) return '?';
  const o = t.id != null ? overrides.get(String(t.id)) : null;
  return (o && o.code) || t.code || defaultCode(t.name);
}

/** Korte naam voor krappe plekken (mobiele stand, ministand). */
export function clubShort(t) {
  if (!t) return '?';
  const o = t.id != null ? overrides.get(String(t.id)) : null;
  return (o && o.short) || t.short || (o && o.name) || t.name || '?';
}

export function clubName(t) {
  if (!t) return '?';
  const o = t.id != null ? overrides.get(String(t.id)) : null;
  return (o && o.name) || t.name || '?';
}

/** Naam als HTML: volledige naam, en de korte naam voor krappe plekken (CSS kiest). esc = escape-functie. */
export function nameHtml(t, esc) {
  const full = clubName(t); const short = clubShort(t);
  return short && short !== full ? `<span class="nm-full">${esc(full)}</span><span class="nm-short">${esc(short)}</span>` : esc(full);
}
