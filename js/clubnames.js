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

// ---------- RSSSF-namen koppelen aan Highlightly-clubs ----------
// RSSSF levert alleen tekst ("NEC", "Go Ahead Eagles"). Via de teamindex vinden we het Highlightly-id,
// zodat je eigen naam, korte naam, code en het wapen ook in oude seizoenen verschijnen.
const aliases = new Map(); // sleutel -> { id, logo }
let aliasesLoaded = false;
export const teamAliasesLoaded = () => aliasesLoaded;
const keyOf = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ')
  .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['fc', 'sc', 'sv', 'afc', 'bv', 'vv'].includes(w)).join(' ').trim();

/** teams: uitkomst van getAllLeagueTeams(). */
export function setTeamAliases(teams) {
  aliases.clear();
  (teams || []).forEach((t) => [t.apiName, t.name].forEach((n) => { const k = keyOf(n); if (k && !aliases.has(k)) aliases.set(k, { id: t.id, logo: t.logo || null }); }));
  aliasesLoaded = true;
}

/** Highlightly-club bij een RSSSF-naam: exact, anders één unieke club waarvan de naam de andere bevat. */
export function aliasOf(name) {
  const k = keyOf(name);
  if (!k) return null;
  if (aliases.has(k)) return aliases.get(k);
  const hits = [...aliases.entries()].filter(([a]) => (a.startsWith(`${k} `) || k.startsWith(`${a} `)) && !/^jong /.test(a) === !/^jong /.test(k));
  const ids = new Set(hits.map(([, v]) => v.id));
  return ids.size === 1 ? hits[0][1] : null;
}

/** Team uit RSSSF (muteert): naam en id blijven de RSSSF-sleutel (rsName), weergave krijgt je eigen naam en het wapen. */
export function nameRs(t) {
  if (!t || typeof t !== 'object') return t;
  t.rsName = t.rsName || t.name;
  let id = t.id;
  if (String(id).startsWith('rs:')) {
    const a = aliasOf(t.rsName);
    if (a) { t.hlId = a.id; id = a.id; if (!t.logo) t.logo = a.logo; }
  }
  const o = overrides.get(String(id));
  t.apiName = t.rsName;
  t.name = (o && o.name) || t.rsName;
  t.short = (o && o.short) || t.name;
  t.code = (o && o.code) || defaultCode(t.name);
  return t;
}

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
