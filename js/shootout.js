// Strafschoppenserie herkennen. Highlightly levert de schoppen als gewone events: "Penalty" (raak) en
// "Missed Penalty", op 120+1, 120+2, ... (of 90+n zonder verlenging), waarbij de extra minuut het
// volgnummer van de schop is. Zonder herkenning tellen ze als goals (2–2 wordt dan 5–7).
//
// Herkenning (bij het lezen, de opgeslagen data blijft zoals Highlightly hem gaf): in een duel met een
// strafschoppenstand is de serie het laatste aaneengesloten blok penalty-events vanaf minuut 90. Telt dat blok
// meer benutte schoppen dan de serie-stand, dan vallen de vroegste af (een late penalty in de wedstrijd zelf).
// Herkende schoppen krijgen type "Shootout Penalty" / "Shootout Missed" (apiType = origineel), shootout: true.

const SCORED = /^penalty$/i;
const MISSED = /^missed penalty$/i;
const isKick = (e) => e && (SCORED.test(e.type || '') || MISSED.test(e.type || ''));
const at = (e) => (e.minute ?? 0) * 1000 + (e.extra ?? 0);

function mark(list, pen) {
  const need = (Number(pen.home) || 0) + (Number(pen.away) || 0);
  const order = list.map((e, i) => ({ e, i })).sort((a, b) => at(a.e) - at(b.e) || a.i - b.i).map((x) => x.e);
  const run = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const e = order[k];
    if (/subst/i.test(e.type || '') && run.length === 0) continue; // wissel na afloop: negeren
    if (!isKick(e) || (e.minute ?? 0) < 90) break;
    run.unshift(e);
  }
  if (!run.length) return;
  let scored = run.filter((e) => SCORED.test(e.type)).length;
  while (need && scored > need && run.length) { const x = run.shift(); if (SCORED.test(x.type)) scored--; }
  run.forEach((e, n) => {
    e.apiType = e.type;
    e.shootout = true;
    e.kick = n + 1;
    e.type = SCORED.test(e.type) ? 'Shootout Penalty' : 'Shootout Missed';
  });
}

/** Muteert en geeft de wedstrijd terug. Zowel detail.events (Cambuur) als events (andere clubs). */
export function markShootout(m) {
  if (!m || !m.penalties || m.penalties.home == null) return m;
  [m.detail && m.detail.events, m.events].forEach((list) => { if (Array.isArray(list) && !list.some((e) => e.shootout)) mark(list, m.penalties); });
  return m;
}

/** Schoppen van de serie in volgorde, met tussenstand. */
export function shootoutKicks(events, homeId) {
  let h = 0; let a = 0;
  return (events || []).filter((e) => e.shootout).sort((x, y) => (x.kick || 0) - (y.kick || 0)).map((e) => {
    const home = e.teamId === homeId; const raak = e.type === 'Shootout Penalty';
    if (raak) { if (home) h++; else a++; }
    return { ...e, home, raak, stand: `${h}–${a}` };
  });
}
