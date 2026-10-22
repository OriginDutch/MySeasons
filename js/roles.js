// Rollen per seizoen: players/{id}.roles = { 2025: { role: 'LW', note }, 2026: { role: 'RB' } }.
// Een rol geldt vanaf dat seizoen tot de volgende wijziging. Geen rol = de linie van Highlightly.
//
// Afleiden uit opstellingen: Highlightly geeft alleen de linie per speler, maar wel de formatie en de volgorde
// per rij (keeper → aanval). Binnen een rij staat de EERSTE speler RECHTS en de laatste links
// (bevestigd: Galvez eerste = rechtsback, Marsman laatste = linksback; Kvam rechtsbuiten, Ferrah linksbuiten).
// Alleen basisspelers; invallers hebben geen plek in de formatie.
// LET OP: die volgorde is niet betrouwbaar (vanaf sept. 2026 draaide Highlightly hem om). Afleiden geeft daarom
// geen kant: 'FB' (back) en 'W' (vleugelspeler). De kant kiest de gebruiker; FB/W wordt nooit zo opgeslagen.

export const ROLES = [
  ['GK', 'Keeper', 'Goalkeeper'],
  ['RB', 'Rechtsback', 'Defender'], ['CB', 'Centrale verdediger', 'Defender'], ['LB', 'Linksback', 'Defender'],
  ['DM', 'Verdedigende mid', 'Midfielder'], ['CM', 'Centrale mid', 'Midfielder'], ['AM', 'Aanvallende mid', 'Midfielder'],
  ['RW', 'Rechtsbuiten', 'Forward'], ['LW', 'Linksbuiten', 'Forward'], ['ST', 'Spits', 'Forward'],
];
const BY = Object.fromEntries(ROLES.map(([k, l, line]) => [k, { label: l, line }]));
// Alleen voor voorstellen (zonder kant):
const GENERIC = { FB: { label: 'Back', line: 'Defender', sides: ['RB', 'LB'] }, W: { label: 'Vleugelspeler', line: 'Forward', sides: ['RW', 'LW'] } };
export const isGeneric = (r) => !!GENERIC[r];
export const sidesOf = (r) => (GENERIC[r] ? GENERIC[r].sides : [r]);
/** Past een echte rol bij een voorstel? (Rechtsback past bij 'Back'.) */
export const fitsRole = (role, suggestion) => !!role && sidesOf(suggestion).includes(role);
export const roleLabel = (r) => (r && BY[r] ? BY[r].label : r && GENERIC[r] ? GENERIC[r].label : null);
export const lineOfRole = (r) => (r && BY[r] ? BY[r].line : r && GENERIC[r] ? GENERIC[r].line : null);

/** { jaar: { role, note } } opgeschoond, oud → nieuw. */
export function rolesOf(pr) {
  return Object.entries((pr && pr.roles) || {})
    .filter(([y, v]) => /^\d{4}$/.test(y) && v && BY[v.role])
    .map(([y, v]) => ({ year: Number(y), role: v.role, note: v.note || '' }))
    .sort((a, b) => a.year - b.year);
}

/** Rol in dit seizoen (doorgetrokken vanaf de laatste wijziging), of null. */
export function roleFor(pr, year) {
  const list = rolesOf(pr).filter((r) => r.year <= Number(year));
  return list.length ? list[list.length - 1].role : null;
}

// ---------- Afleiden ----------
/** Rollen voor één rij (zonder kant). ctx: { kind: 'def'|'mid'|'att', defSize, nearAttack } */
function rowRoles(n, ctx) {
  if (ctx.kind === 'def') {
    if (n === 4) return ['FB', 'CB', 'CB', 'FB'];
    if (n === 5) return ['FB', 'CB', 'CB', 'CB', 'FB'];
    return Array(n).fill('CB');
  }
  if (ctx.kind === 'att') {
    if (n === 3) return ['W', 'ST', 'W'];
    if (n === 4) return ['W', 'ST', 'ST', 'W'];
    return Array(n).fill('ST');
  }
  // middenveld
  if (ctx.defSize === 3 && n >= 4) return ['FB', ...Array(n - 2).fill('CM'), 'FB']; // vleugelverdedigers bij drie centrale
  if (ctx.nearAttack) {
    if (n >= 3) return ['W', ...Array(n - 2).fill('AM'), 'W'];
    return Array(n).fill('AM');
  }
  if (ctx.only) {
    if (n >= 4) return ['W', ...Array(n - 2).fill('CM'), 'W'];
    return Array(n).fill('CM');
  }
  if (n <= 2) return Array(n).fill('DM');
  if (n >= 4) return ['W', ...Array(n - 2).fill('CM'), 'W'];
  return Array(n).fill('CM');
}

/** Rollen in één wedstrijd voor team teamId: Map(spelerId → rol). */
export function matchRoles(m, teamId) {
  const l = m && m.detail && m.detail.lineups;
  const side = l && ['home', 'away'].map((s) => l[s]).find((x) => x && x.teamId === teamId);
  if (!side || !side.starters || side.starters.some((p) => p.line == null)) return new Map();
  const rows = new Map();
  side.starters.forEach((p) => { if (!rows.has(p.line)) rows.set(p.line, []); rows.get(p.line).push(p); });
  const idx = [...rows.keys()].sort((a, b) => a - b);
  const out = new Map();
  if (idx.length < 3) return out;
  const defSize = rows.get(idx[1]).length;
  const mids = idx.slice(2, -1);
  idx.forEach((li, k) => {
    const row = rows.get(li);
    let roles;
    if (k === 0) roles = row.map(() => 'GK');
    else if (k === 1) roles = rowRoles(row.length, { kind: 'def' });
    else if (k === idx.length - 1) roles = rowRoles(row.length, { kind: 'att' });
    else roles = rowRoles(row.length, { kind: 'mid', defSize, only: mids.length === 1, nearAttack: mids.length > 1 && k === idx.length - 2 });
    row.forEach((p, i) => { if (p.id != null) out.set(p.id, roles[i]); });
  });
  return out;
}

/** Per speler in deze wedstrijden: { top, count, starts, all: {rol: n} }. */
export function inferRoles(list, teamId) {
  const acc = new Map();
  (list || []).forEach((m) => matchRoles(m, teamId).forEach((r, id) => {
    const a = acc.get(id) || { starts: 0, all: {} };
    a.starts++; a.all[r] = (a.all[r] || 0) + 1; acc.set(id, a);
  }));
  const out = new Map();
  acc.forEach((a, id) => {
    const [top, count] = Object.entries(a.all).sort((x, y) => y[1] - x[1])[0];
    out.set(id, { top, count, starts: a.starts, all: a.all });
  });
  return out;
}
