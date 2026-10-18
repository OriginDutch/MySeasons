// Wie hoort bij de selectie van een seizoen? Regels: zie het doc, "Selectie per seizoen".
//
// 1. Een speler heeft perioden bij de club (eigen, huur, jeugd), afgeleid uit zijn transfers.
// 2. Een seizoen begint bij de eerste officiële wedstrijd, niet op 1 juli.
// 3. Stats hangen aan wedstrijden, nooit aan transfers.
// 4. Een officieel wedstrijdformulier is bewijs (oefenduels niet).

const START = { 'transfer-in': 'eigen', 'huur-in': 'huur', promotie: 'jeugd' };
const iso = (d) => (d ? String(d).slice(0, 10) : null);

/** Transfers → perioden [{ from, to, kind, club }] en verhuurperioden [{ from, to, club }]. */
export function spells(profile) {
  const ts = ((profile && profile.transfers) || []).filter((t) => t && t.date).slice();
  const out = []; const loans = [];
  let open = null;
  // Volgorde op dezelfde dag: eerst komst, dan huur, dan vertrek.
  const ORDER = { 'transfer-in': 0, promotie: 1, 'huur-in': 2, verlenging: 3, 'huur-uit': 4, 'transfer-uit': 5 };
  ts.sort((a, b) => iso(a.date).localeCompare(iso(b.date)) || (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9));
  ts.forEach((t) => {
    const d = iso(t.date);
    if (START[t.type]) {
      const kind = START[t.type];
      if (open && open.from === d) {
        // Zelfde dag (bijv. transfer-in + huur-in): één periode, de meest specifieke soort.
        if (kind === 'huur') { open.kind = 'huur'; open.club = t.club || open.club; open.to = iso(t.dateTo) || null; }
        if (open.to) { out.push(open); open = null; }
        return;
      }
      if (open && open.kind === 'huur' && t.type === 'transfer-in') {
        // Huurling definitief gekocht: huurperiode gaat over in een eigen periode.
        open.to = d; out.push(open); open = null;
      } else if (open) {
        // Doorstroming (promotie) of nieuwe start terwijl hij er al is: zelfde periode, andere soort.
        if (t.type === 'promotie') { open.kind = 'eigen'; open.promoted = d; }
        else if (kind === 'huur') { open.kind = 'huur'; open.club = t.club || open.club; open.to = iso(t.dateTo) || null; if (open.to) { out.push(open); open = null; } }
        return;
      }
      open = { from: d, to: kind === 'huur' ? iso(t.dateTo) : null, kind, club: t.club || null };
      if (open.to) { out.push(open); open = null; }
    } else if (t.type === 'transfer-uit') {
      const last = open || out[out.length - 1];
      if (open) { open.to = d; out.push(open); open = null; } else if (last && !last.to) last.to = d;
      else out.push({ from: null, to: d, kind: 'eigen', club: null }); // vertrek zonder bekende komst
    } else if (t.type === 'huur-uit') {
      loans.push({ from: d, to: iso(t.dateTo), club: t.club || null });
    }
  });
  if (open) out.push(open);
  // Geen transfers maar wel een "bij de club sinds": dan is dat de periode.
  if (!out.length && profile && profile.joined) out.push({ from: iso(profile.joined), to: null, kind: 'eigen', club: null });
  return { spells: out, loans };
}

const within = (date, from, to) => date && (!from || from <= date) && (!to || date <= to);
const overlaps = (aFrom, aTo, bFrom, bTo) => (!aTo || !bFrom || aTo >= bFrom) && (!aFrom || !bTo || aFrom <= bTo);

/** Seizoensvenster: eerste en laatste officiële wedstrijd. Valt terug op 1 aug – 30 jun. */
export function seasonWindow(year, officialMatches) {
  const dates = officialMatches.map((m) => iso(m.date)).filter(Boolean).sort();
  return {
    start: dates[0] || `${year}-08-01`,
    end: dates[dates.length - 1] || `${year + 1}-06-30`,
  };
}

/**
 * Status van één speler in een seizoen.
 * ref = peildatum: vandaag (lopend seizoen) of het einde van het seizoen.
 * Geeft { member, status: 'active'|'left'|'loaned'|'future', labels: [], conflict } of { member: false }.
 */
export function statusIn(profile, win, ref, { onSheet = false, lastSheet = null } = {}) {
  const { spells: sp, loans } = spells(profile);
  const labels = [];
  if (!sp.length) {
    if (!onSheet) return { member: false };
    return { member: true, status: 'active', labels: ['geen transfer bekend'], conflict: false };
  }
  const inSeason = sp.filter((s) => overlaps(s.from, s.to, win.start, win.end));
  const current = sp.find((s) => within(ref, s.from, s.to));
  const future = sp.find((s) => s.from && s.from > ref && s.from <= win.end);
  if (!inSeason.length && !onSheet) return { member: false };

  // Formulier zegt "erbij", transfers zeggen "weg": conflict, jij beslist (Afwijkingen).
  const conflict = onSheet && lastSheet && !sp.some((s) => within(iso(lastSheet), s.from, s.to));

  const s = current || inSeason[inSeason.length - 1] || null;
  if (s && s.kind === 'huur') labels.push(`huur${s.club ? ' · van ' + s.club : ''}`);
  if (s && s.from && s.from > win.start) labels.push(`nieuw · sinds ${s.from}`);
  const loan = loans.find((l) => within(ref, l.from, l.to));
  if (loan) return { member: true, status: 'loaned', labels: [`verhuurd${loan.club ? ' aan ' + loan.club : ''}${loan.to ? ' tot ' + loan.to : ''}`], conflict, loan };
  if (current) return { member: true, status: 'active', labels, conflict };
  if (future && !inSeason.some((x) => x.from && x.from <= ref)) return { member: true, status: 'future', labels: [`komt op ${future.from}`], conflict };
  const ended = inSeason.filter((x) => x.to && x.to < ref).sort((a, b) => b.to.localeCompare(a.to))[0];
  // Vertrokken vóór de eerste officiële wedstrijd: hoort niet bij dit seizoen (regel 3).
  if (ended && ended.to < win.start && !onSheet) return { member: false };
  if (ended) return { member: true, status: 'left', labels: [`vertrokken ${ended.to}`], conflict };
  return onSheet ? { member: true, status: 'active', labels, conflict } : { member: false };
}
