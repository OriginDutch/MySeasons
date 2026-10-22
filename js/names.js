// Spelersnamen. Jouw naam uit het spelersprofiel wint altijd van Highlightly;
// de korte naam (tijdlijn, opstellingen, tabellen) maken we zelf als je hem leeg laat.

/** "Nicolas Binder" → "N. Binder", "Billy van Duijl" → "B. van Duijl", "Jordi" → "Jordi". */
export function autoShort(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  if (/^[A-Z]\.$/i.test(parts[0])) return parts.join(' '); // al kort
  return `${parts[0][0].toUpperCase()}. ${parts.slice(1).join(' ')}`;
}

/** Langste naam uit een lijst Highlightly-spellingen. */
export function bestApiName(names) {
  return (names || []).filter(Boolean).slice().sort((a, b) => b.length - a.length)[0] || '?';
}

export function fullName(profile, apiName) {
  return (profile && profile.fullName) || apiName || '?';
}

export function shortName(profile, apiName) {
  if (profile && profile.shortName) return profile.shortName;
  if (profile && profile.fullName) return autoShort(profile.fullName);
  return apiName || '?';
}

// ---------- Aliassen: Highlightly heeft soms twee id's voor één speler ("J. Nap" en "Jochem Nap") ----------
// Een Highlightly-profiel met linkedTo = ander Highlightly-id is een alias: in alle wedstrijddata telt het
// voor de hoofdspeler. De ruwe data blijft zoals hij is; ontkoppelen = linkedTo weghalen.
const aliasCache = new WeakMap();
export function aliasMap(profiles) {
  if (!profiles) return new Map();
  if (aliasCache.has(profiles)) return aliasCache.get(profiles);
  const direct = new Map();
  Object.entries(profiles).forEach(([id, pr]) => { if (/^\d+$/.test(id) && pr && pr.linkedTo != null && /^\d+$/.test(String(pr.linkedTo))) direct.set(Number(id), Number(pr.linkedTo)); });
  const out = new Map();
  direct.forEach((_, id) => { let t = id; const seen = new Set(); while (direct.has(t) && !seen.has(t)) { seen.add(t); t = direct.get(t); } if (t !== id) out.set(id, t); });
  aliasCache.set(profiles, out);
  return out;
}

/** Speler-id's in de details omzetten naar de hoofdspeler (muteert). */
export function applyAliases(match, alias) {
  if (!match || !match.detail || !alias || !alias.size) return match;
  const a = (id) => (id != null && alias.has(Number(id)) ? alias.get(Number(id)) : id);
  const d = match.detail;
  (d.events || []).forEach((e) => { e.playerId = a(e.playerId); e.assistId = a(e.assistId); e.inId = a(e.inId); e.outId = a(e.outId); });
  ['home', 'away'].forEach((side) => { const l = d.lineups && d.lineups[side]; if (l) [...(l.starters || []), ...(l.subs || [])].forEach((p) => { p.id = a(p.id); }); });
  Object.values(d.players || {}).forEach((list) => list.forEach((p) => { p.id = a(p.id); }));
  return match;
}

/** Zet jouw korte namen in een (kopie van een) wedstrijd: tijdlijn, opstellingen, spelerstabel. */
export function applyNames(match, profiles) {
  if (!match.detail || !profiles || !Object.keys(profiles).length) return match;
  applyAliases(match, aliasMap(profiles));
  const s = (id, cur) => (id && profiles[id] ? shortName(profiles[id], cur) : cur);
  const d = match.detail;
  (d.events || []).forEach((e) => {
    e.player = s(e.playerId, e.player);
    e.assist = s(e.assistId, e.assist);
    e.inName = s(e.inId, e.inName);
    e.outName = s(e.outId, e.outName);
  });
  ['home', 'away'].forEach((side) => {
    const l = d.lineups && d.lineups[side];
    if (l) [...l.starters, ...l.subs].forEach((p) => { p.apiName = p.apiName || p.name; p.name = s(p.id, p.name); });
  });
  Object.values(d.players || {}).forEach((list) => list.forEach((p) => { p.apiName = p.apiName || p.name; p.name = s(p.id, p.name); }));
  return match;
}
