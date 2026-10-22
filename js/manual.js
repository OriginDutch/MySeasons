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

// ---------- Vergelijken met Highlightly (als die later toch details levert) ----------
// Elk verschil is een item { key, what, mine, api, sig, adopt(manual) → manual }. "Mijne houden" bewaart
// manual.kept[key] = sig (de Highlightly-waarde van dat moment); verandert Highlightly later, dan komt het terug.

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();
const surname = (s) => norm(s).split(' ').pop();
function samePerson(aId, aName, bId, bName) {
  if (aId != null && bId != null && String(aId) === String(bId)) return true;
  return !!aName && !!bName && (norm(aName) === norm(bName) || (surname(aName).length > 2 && surname(aName) === surname(bName)));
}
const pname = (n) => n || '?';
const mm = (e) => (e ? `${e.minute ?? '?'}${e.extra ? '+' + e.extra : ''}'` : '—');

/** Highlightly-detail → dezelfde vorm als manual (alleen de eigen club, plus tegengoals). */
export function apiAsManual(detail, match, teamId) {
  const l = detail.lineups || {};
  const side = ['home', 'away'].map((s) => l[s]).find((x) => x && x.teamId === teamId);
  const ev = (detail.events || []).filter((e) => !e.shootout);
  const isGoal = (t) => { const x = String(t || ''); return !/missed|var|cancel|disallow/i.test(x) && (/goal/i.test(x) || /^penalty( goal| scored)?$/i.test(x)); };
  return {
    formation: side ? side.formation : null,
    starters: side ? side.starters.map((p) => ({ id: p.id, name: p.name, number: p.number ?? null })) : [],
    subs: ev.filter((e) => e.type === 'Substitution' && e.teamId === teamId).map((e) => ({ minute: e.minute, extra: e.extra, inId: e.inId, inName: e.inName, outId: e.outId, outName: e.outName })),
    goals: ev.filter((e) => isGoal(e.type)).map((e) => {
      const own = /own/i.test(e.type);
      return { minute: e.minute, extra: e.extra, for: (e.teamId === teamId) !== own ? 'us' : 'them', kind: own ? 'own' : /penalty/i.test(e.type) ? 'penalty' : 'goal', playerId: e.playerId ?? null, player: e.player || null, assistId: e.assistId ?? null, assist: e.assist || null };
    }),
    cards: ev.filter((e) => e.teamId === teamId && /card/i.test(e.type)).map((e) => ({ minute: e.minute, extra: e.extra, playerId: e.playerId ?? null, player: e.player || null, kind: /second yellow|yellow.?red/i.test(e.type) ? 'second' : /red/i.test(e.type) ? 'red' : 'yellow' })),
  };
}

export function compareManual(manual, apiDetail, match, teamId) {
  if (!manual || !apiDetail) return [];
  const api = apiAsManual(apiDetail, match, teamId);
  const items = [];
  const clone = (m) => JSON.parse(JSON.stringify(m));

  // Basiself: één item voor de hele opstelling.
  if (api.starters.length) {
    const onlyMine = manual.starters.filter((p) => !api.starters.some((q) => samePerson(p.id, p.name, q.id, q.name)));
    const onlyApi = api.starters.filter((q) => !manual.starters.some((p) => samePerson(p.id, p.name, q.id, q.name)));
    if (onlyMine.length || onlyApi.length) {
      items.push({ key: 'xi', kind: 'opstelling', what: 'Basiself', mine: onlyMine.map((p) => p.name).join(', ') || '—', api: onlyApi.map((p) => p.name).join(', ') || '—',
        note: 'alleen bij jou / alleen bij Highlightly', sig: api.starters.map((p) => p.id).join(','),
        adopt: (m) => { const x = clone(m); x.starters = api.starters; if (api.formation) x.formation = api.formation; return x; } });
    }
  }

  // Wissels: gekoppeld op de speler die erin komt.
  const usedApiSubs = new Set();
  manual.subs.forEach((s, i) => {
    const j = api.subs.findIndex((a, k) => !usedApiSubs.has(k) && samePerson(s.inId, s.inName, a.inId, a.inName));
    if (j < 0) { items.push({ key: `sub:${s.inId ?? s.inName}`, kind: 'wissels', what: `Wissel ${mm(s)} ${pname(s.inName)} erin`, mine: `${pname(s.inName)} voor ${pname(s.outName)}`, api: 'niet bij Highlightly', sig: 'none', adopt: (m) => { const x = clone(m); x.subs.splice(i, 1); return x; } }); return; }
    usedApiSubs.add(j); const a = api.subs[j];
    if (s.minute !== a.minute || (s.extra || null) !== (a.extra || null) || !samePerson(s.outId, s.outName, a.outId, a.outName)) {
      items.push({ key: `sub:${s.inId ?? s.inName}`, kind: 'wissels', what: `Wissel ${pname(s.inName)} erin`, mine: `${mm(s)} voor ${pname(s.outName)}`, api: `${mm(a)} voor ${pname(a.outName)}`, sig: JSON.stringify(a),
        adopt: (m) => { const x = clone(m); x.subs[i] = { ...x.subs[i], minute: a.minute, extra: a.extra, outId: a.outId, outName: a.outName }; return x; } });
    }
  });
  api.subs.forEach((a, k) => { if (!usedApiSubs.has(k)) items.push({ key: `sub+:${a.inId ?? a.inName}`, kind: 'wissels', what: `Wissel ${mm(a)} ${pname(a.inName)} erin`, mine: 'niet bij jou', api: `${pname(a.inName)} voor ${pname(a.outName)}`, sig: JSON.stringify(a), adopt: (m) => { const x = clone(m); x.subs.push(a); return x; } }); });

  // Goals: per kant op volgorde.
  ['us', 'them'].forEach((side) => {
    const mine = manual.goals.map((g, i) => ({ g, i })).filter(({ g }) => g.for === side).sort((a, b) => at(a.g) - at(b.g));
    const theirs = api.goals.filter((g) => g.for === side).sort((a, b) => at(a) - at(b));
    const label = side === 'us' ? 'Goal' : 'Tegengoal';
    for (let n = 0; n < Math.max(mine.length, theirs.length); n++) {
      const a = theirs[n]; const own = mine[n];
      const key = `goal:${side}:${n + 1}`;
      if (own && !a) { items.push({ key, kind: 'goals', what: `${label} ${n + 1} (${mm(own.g)})`, mine: pname(own.g.player), api: 'niet bij Highlightly', sig: 'none', adopt: (m) => { const x = clone(m); x.goals.splice(own.i, 1); return x; } }); continue; }
      if (!own && a) { items.push({ key, kind: 'goals', what: `${label} ${n + 1} (${mm(a)})`, mine: 'niet bij jou', api: pname(a.player), sig: JSON.stringify(a), adopt: (m) => { const x = clone(m); x.goals.push(a); return x; } }); continue; }
      const g = own.g;
      const diffMin = g.minute !== a.minute || (g.extra || null) !== (a.extra || null);
      const diffWho = side === 'us' ? !samePerson(g.playerId, g.player, a.playerId, a.player) : (g.player && a.player && !samePerson(null, g.player, null, a.player));
      const diffAst = side === 'us' && (g.assist || a.assist) && !samePerson(g.assistId, g.assist, a.assistId, a.assist);
      if (diffMin || diffWho || diffAst || g.kind !== a.kind) {
        items.push({ key, kind: 'goals', what: `${label} ${n + 1}`, mine: `${mm(g)} ${pname(g.player)}${g.assist ? ` (assist ${g.assist})` : ''}${g.kind !== 'goal' ? ` · ${g.kind === 'own' ? 'eigen goal' : 'penalty'}` : ''}`,
          api: `${mm(a)} ${pname(a.player)}${a.assist ? ` (assist ${a.assist})` : ''}${a.kind !== 'goal' ? ` · ${a.kind === 'own' ? 'eigen goal' : 'penalty'}` : ''}`, sig: JSON.stringify(a),
          adopt: (m) => { const x = clone(m); x.goals[own.i] = { ...a }; return x; } });
      }
    }
  });

  // Kaarten: gekoppeld op speler + soort.
  const usedCards = new Set();
  manual.cards.forEach((c, i) => {
    const j = api.cards.findIndex((a, k) => !usedCards.has(k) && a.kind === c.kind && samePerson(c.playerId, c.player, a.playerId, a.player));
    const K = { yellow: 'Geel', second: '2× geel', red: 'Rood' };
    if (j < 0) { items.push({ key: `card:${c.playerId ?? c.player}:${c.kind}`, kind: 'kaarten', what: `${K[c.kind]} ${pname(c.player)}`, mine: mm(c), api: 'niet bij Highlightly', sig: 'none', adopt: (m) => { const x = clone(m); x.cards.splice(i, 1); return x; } }); return; }
    usedCards.add(j); const a = api.cards[j];
    if (c.minute !== a.minute || (c.extra || null) !== (a.extra || null)) items.push({ key: `card:${c.playerId ?? c.player}:${c.kind}`, kind: 'kaarten', what: `${K[c.kind]} ${pname(c.player)}`, mine: mm(c), api: mm(a), sig: JSON.stringify(a), adopt: (m) => { const x = clone(m); x.cards[i] = { ...x.cards[i], minute: a.minute, extra: a.extra }; return x; } });
  });
  api.cards.forEach((a, k) => { if (!usedCards.has(k)) items.push({ key: `card+:${a.playerId ?? a.player}:${a.kind}`, kind: 'kaarten', what: `${{ yellow: 'Geel', second: '2× geel', red: 'Rood' }[a.kind]} ${pname(a.player)}`, mine: 'niet bij jou', api: mm(a), sig: JSON.stringify(a), adopt: (m) => { const x = clone(m); x.cards.push(a); return x; } }); });

  const kept = manual.kept || {};
  return items.map((it) => ({ ...it, kept: kept[it.key] === it.sig }));
}

/** Aantal open verschillen (niet bewust gehouden). */
export const openDiffs = (manual, apiDetail, match, teamId) => compareManual(manual, apiDetail, match, teamId).filter((i) => !i.kept).length;
