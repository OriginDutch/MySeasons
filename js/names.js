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

/** Zet jouw korte namen in een (kopie van een) wedstrijd: tijdlijn, opstellingen, spelerstabel. */
export function applyNames(match, profiles) {
  if (!match.detail || !profiles || !Object.keys(profiles).length) return match;
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
