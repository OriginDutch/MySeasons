// Rollen per seizoen: players/{id}.roles = { 2025: { role: 'LW', note }, 2026: { role: 'RB' } }.
// Een rol geldt vanaf dat seizoen tot de volgende wijziging. Geen rol = de linie van Highlightly.
//
// Afleiden uit opstellingen: Highlightly geeft alleen de linie per speler, maar wel de formatie en de volgorde
// per rij (keeper → aanval). Binnen een rij staat de EERSTE speler RECHTS en de laatste links
// (bevestigd: Galvez eerste = rechtsback, Marsman laatste = linksback; Kvam rechtsbuiten, Ferrah linksbuiten).
// Alleen basisspelers; invallers hebben geen plek in de formatie.

export const ROLES = [
  ['GK', 'Keeper', 'Goalkeeper'],
  ['RB', 'Rechtsback', 'Defender'], ['CB', 'Centrale verdediger', 'Defender'], ['LB', 'Linksback', 'Defender'],
  ['DM', 'Verdedigende mid', 'Midfielder'], ['CM', 'Centrale mid', 'Midfielder'], ['AM', 'Aanvallende mid', 'Midfielder'],
  ['RW', 'Rechtsbuiten', 'Forward'], ['LW', 'Linksbuiten', 'Forward'], ['ST', 'Spits', 'Forward'],
];
const BY = Object.fromEntries(ROLES.map(([k, l, line]) => [k, { label: l, line }]));
export const roleLabel = (r) => (r && BY[r] ? BY[r].label : null);
export const lineOfRole = (r) => (r && BY[r] ? BY[r].line : null);

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
/** Rollen voor één rij, van rechts naar links. ctx: { kind: 'def'|'mid'|'att', defSize, nearAttack } */
function rowRoles(n, ctx) {
  if (ctx.kind === 'def') {
    if (n === 4) return ['RB', 'CB', 'CB', 'LB'];
    if (n === 5) return ['RB', 'CB', 'CB', 'CB', 'LB'];
    return Array(n).fill('CB');
  }
  if (ctx.kind === 'att') {
    if (n === 3) return ['RW', 'ST', 'LW'];
    if (n === 4) return ['RW', 'ST', 'ST', 'LW'];
    return Array(n).fill('ST');
  }
  // middenveld
  if (ctx.defSize === 3 && n >= 4) return ['RB', ...Array(n - 2).fill('CM'), 'LB']; // vleugelverdedigers bij drie centrale
  if (ctx.nearAttack) {
    if (n >= 3) return ['RW', ...Array(n - 2).fill('AM'), 'LW'];
    return Array(n).fill('AM');
  }
  if (ctx.only) {
    if (n >= 4) return ['RW', ...Array(n - 2).fill('CM'), 'LW'];
    return Array(n).fill('CM');
  }
  if (n <= 2) return Array(n).fill('DM');
  if (n >= 4) return ['RW', ...Array(n - 2).fill('CM'), 'LW'];
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
