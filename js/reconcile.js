// Highlightly gebruikt binnen één wedstrijd soms twee id's voor dezelfde speler: het ene in de opstelling,
// het andere in de spelersstats (bijv. Kvam: 89153421 in de opstelling, 83077442 in de stats), of in de
// opstelling helemaal geen id. Per team en per wedstrijd is het rugnummer uniek, dus: zelfde team + zelfde
// rugnummer = zelfde speler. Alles gaat naar het id uit de spelersstats; events volgen mee.
// Bij het lezen toegepast; de opgeslagen data blijft zoals Highlightly hem gaf.

export function reconcileIds(match) {
  const d = match && match.detail;
  if (!d || !d.players || !d.lineups) return match;
  const map = new Map(); // oud id → stats-id
  ['home', 'away'].forEach((side) => {
    const l = d.lineups[side];
    if (!l || l.teamId == null) return;
    const box = d.players[l.teamId] || d.players[String(l.teamId)] || [];
    const byNr = new Map();
    box.forEach((p) => { if (p.number != null && p.id != null) byNr.set(Number(p.number), p.id); });
    [...(l.starters || []), ...(l.subs || [])].forEach((p) => {
      if (p.number == null) return;
      const to = byNr.get(Number(p.number));
      if (to == null || to === p.id) return;
      if (p.id != null) map.set(p.id, to);
      p.lineupId = p.id ?? null;
      p.id = to;
    });
  });
  if (map.size) {
    const a = (id) => (id != null && map.has(id) ? map.get(id) : id);
    (d.events || []).forEach((e) => { e.playerId = a(e.playerId); e.assistId = a(e.assistId); e.inId = a(e.inId); e.outId = a(e.outId); });
  }
  return match;
}
