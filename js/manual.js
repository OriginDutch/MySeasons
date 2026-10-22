// Handmatige wedstrijddetails (alleen de eigen club). Opgeslagen in matchNotes/{id}.manual, los van Highlightly:
// "Opnieuw ophalen" raakt het niet. Bij tonen maakt applyCorrections er een gewone `detail` van, zodat tijdlijn,
// opstelling, spelersstats en schorsingen het meelezen. De Highlightly-details (als die er zijn) blijven als apiDetail.
//
// manual = {
//   formation, venue, referee, source,
//   starters: [{ id, name, number }],
//   subs:  [{ minute, extra, inId, inName, outId, outName }],
//   goals: [{ minute, extra, for: 'us'|'them', kind: 'goal'|'penalty'|'own', playerId, player, assistId, assist }],
//   cards: [{ minute, extra, playerId, player, kind: 'yellow'|'second'|'red' }],
//   at,
// }
// Eigen goal: `for` = wie de goal krijgt; de schutter is van het andere team (zoals Highlightly: teamId = team van de schutter).

export const FORMATIONS = ['4-3-3', '4-2-3-1', '4-4-2', '4-1-4-1', '3-5-2', '3-4-3', '3-4-2-1', '5-3-2', '5-4-1', '4-3-1-2', '4-4-1-1'];
const GOAL_TYPE = { goal: 'Goal', penalty: 'Penalty', own: 'Own Goal' };
const CARD_TYPE = { yellow: 'Yellow Card', second: 'Yellow Red Card', red: 'Red Card' };

const at = (e) => (e.minute ?? 0) + (e.extra ?? 0) / 100;
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

/** Ids uit een formulier: Highlightly-ids zijn getallen, eigen profielen tekst. */
export const idv = (v) => (v == null || v === '' ? null : /^\d+$/.test(String(v)) ? Number(v) : String(v));

/** Goals per kant: { us, them }. */
export function tally(manual) {
  const g = { us: 0, them: 0 };
  ((manual && manual.goals) || []).forEach((x) => { g[x.for === 'them' ? 'them' : 'us']++; });
  return g;
}

/** Score { home, away } volgens de ingevulde goals. */
export function manualScore(manual, match, teamId) {
  const t = tally(manual);
  const home = match.homeTeam && match.homeTeam.id === teamId;
  return home ? { home: t.us, away: t.them } : { home: t.them, away: t.us };
}

/** Speelminuten per speler-id uit basis, wissels en rode kaarten. Terugkomen mag (oefenduels). */
export function minutesOf(manual) {
  const end = Math.max(90, ...[...(manual.subs || []), ...(manual.goals || []), ...(manual.cards || [])].map((e) => e.minute || 0));
  const on = new Map(); const mins = new Map();
  const add = (id, n) => mins.set(String(id), (mins.get(String(id)) || 0) + Math.max(0, n));
  (manual.starters || []).forEach((p) => on.set(String(p.id), 0));
  const moments = [
    ...(manual.subs || []).map((s) => ({ t: s.minute || 0, k: at(s), out: s.outId, in: s.inId })),
    ...(manual.cards || []).filter((c) => c.kind !== 'yellow').map((c) => ({ t: c.minute || 0, k: at(c), out: c.playerId })),
  ].sort((a, b) => a.k - b.k);
  moments.forEach((m) => {
    if (m.out != null && on.has(String(m.out))) { add(m.out, m.t - on.get(String(m.out))); on.delete(String(m.out)); }
    if (m.in != null && !on.has(String(m.in))) on.set(String(m.in), m.t);
  });
  on.forEach((from, id) => add(id, end - from));
  return { mins, end };
}

/** manual → een `detail` in hetzelfde formaat als normalizeDetail. */
export function manualDetail(manual, match, teamId, profiles = {}) {
  const oppId = match.homeTeam && match.homeTeam.id === teamId ? (match.awayTeam && match.awayTeam.id) : (match.homeTeam && match.homeTeam.id);
  const pos = (id) => { const pr = profiles[String(id)]; return (pr && ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'].includes(pr.position) && pr.position) || null; };
  const ev = (e, rest) => ({ minute: e.minute ?? null, extra: e.extra ?? null, ...rest, manual: true });
  const events = [
    ...(manual.goals || []).map((g) => {
      const scorerTeam = (g.for === 'them') !== (g.kind === 'own') ? oppId : teamId;
      return ev(g, { type: GOAL_TYPE[g.kind] || 'Goal', teamId: scorerTeam, playerId: g.playerId ?? null, player: g.player || null, assistId: g.kind === 'own' ? null : g.assistId ?? null, assist: g.kind === 'own' ? null : g.assist || null });
    }),
    ...(manual.cards || []).map((c) => ev(c, { type: CARD_TYPE[c.kind] || 'Yellow Card', teamId, playerId: c.playerId ?? null, player: c.player || null, assistId: null, assist: null })),
    ...(manual.subs || []).map((s) => ev(s, { type: 'Substitution', teamId, outId: s.outId ?? null, outName: s.outName || null, inId: s.inId ?? null, inName: s.inName || null })),
  ].sort((a, b) => at(a) - at(b));

  const starters = (manual.starters || []).map((p) => ({ id: p.id, name: p.name, number: p.number ?? null, position: pos(p.id), line: null }));
  const subIns = []; const seen = new Set(starters.map((p) => String(p.id)));
  (manual.subs || []).forEach((s) => { if (s.inId != null && !seen.has(String(s.inId))) { seen.add(String(s.inId)); subIns.push({ id: s.inId, name: s.inName, number: s.inNumber ?? null, position: pos(s.inId) }); } });
  const side = { teamId, formation: manual.formation || null, starters, subs: subIns, manual: true };
  const home = match.homeTeam && match.homeTeam.id === teamId;

  const { mins } = minutesOf(manual);
  const box = [...starters.map((p) => ({ ...p, sub: false })), ...subIns.map((p) => ({ ...p, sub: true }))].map((p) => {
    const goals = (manual.goals || []).filter((g) => g.for !== 'them' && g.kind !== 'own' && sameId(g.playerId, p.id)).length;
    const assists = (manual.goals || []).filter((g) => g.for !== 'them' && g.kind !== 'own' && sameId(g.assistId, p.id)).length;
    const cards = (manual.cards || []).filter((c) => sameId(c.playerId, p.id));
    return {
      id: p.id, name: p.name, number: p.number ?? null, position: p.position, minutes: mins.get(String(p.id)) || 0,
      rating: null, captain: false, sub: p.sub, goals, assists,
      yellow: cards.filter((c) => c.kind === 'yellow').length, red: cards.filter((c) => c.kind !== 'yellow').length, saves: 0, conceded: 0,
    };
  });
  return {
    fetchedAt: manual.at || null, manual: true, source: manual.source || null,
    venue: manual.venue ? { name: manual.venue, city: null, capacity: null } : null,
    referee: manual.referee || null,
    events, stats: { home: {}, away: {} },
    lineups: { home: home ? side : null, away: home ? null : side },
    players: { [teamId]: box },
  };
}

/** Waarschuwingen (niets wordt geblokkeerd). official = officieel duel. */
export function manualWarnings(manual, { official }) {
  const w = [];
  const n = (manual.starters || []).length;
  if (n && n !== 11) w.push(`${n} spelers in de basis in plaats van 11.`);
  if (official) {
    const subs = (manual.subs || []).length;
    if (subs > 6) w.push(`${subs} wissels: officieel mogen er 5 (6 met verlenging).`);
    else if (subs === 6) w.push('6 wissels: kan alleen met verlenging.');
    const out = new Set();
    (manual.subs || []).slice().sort((a, b) => at(a) - at(b)).forEach((s) => {
      if (s.inId != null && out.has(String(s.inId))) w.push(`${s.inName || 'Een speler'} komt terug na een wissel: in een officieel duel kan dat niet.`);
      if (s.outId != null) out.add(String(s.outId));
    });
  }
  return w;
}
