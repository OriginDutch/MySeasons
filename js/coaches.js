// Trainers: wie stond er langs de lijn? Uit je eigen aanstellingen (Highlightly heeft geen trainers).

const iso = (d) => (d ? String(d).slice(0, 10) : null);

/** Hoofdtrainer op een datum, of null. override = trainer-id uit matchNotes (wint altijd). */
export function coachOn(coaches, date, override = null) {
  if (override) {
    const c = coaches.find((x) => x.id === override || x.legacyId === override);
    if (c) return c;
  }
  const d = iso(date);
  return coaches.find((c) => (c.appointments || []).some((a) => /hoofd/i.test(a.role || '') && (!a.from || a.from <= d) && (!a.to || d <= a.to))) || null;
}

export const coachName = (c) => (c ? `${c.firstname || ''} ${c.lastname || ''}`.trim() : null);
