// Selectie en spelerspagina's.

import { esc, toast } from './ui.js';
import { savePlayer } from './store.js';
import { clubField, clubCrest, knownTeams, matchTeam } from './clubpick.js';
import { autoShort } from './names.js';
import { openSheet } from './editor.js';
import { MAIN_CLUB } from './config.js';
import { seasonLabel, isCurrentSeason, getSeason } from './seasonstate.js';
import { statusIn, seasonWindow, spells } from './membership.js';
import { flag, nationalities, countryCode, NAT_TOP, NAT_ALL } from './flags.js';
import { COST, missingDetails, fetchMany } from './sync.js';
import { buildSquad, playerFacts, LINES, LINE_SHORT } from './players.js';
import { correctedList, runWithButton, explain, head, crest } from './matchviews.js';
import { dayShort, opponentOf, isHome } from './season.js';
import { valueBlock, injuryBlock, mountExtra, injuryLabel, euro } from './playerextra.js';
import { currentSquad } from './importer.js';

const TEAM = MAIN_CLUB.id;
const r1 = (v) => (v == null ? '–' : v.toFixed(2));

function missingBlock(list) {
  const miss = missingDetails(list);
  if (!miss.length) return '';
  const calls = miss.length * COST.match;
  return `
    <section class="section">
      <div class="warn-line">${miss.length} gespeelde ${miss.length === 1 ? 'wedstrijd heeft' : 'wedstrijden hebben'} nog geen details, dus die tellen nog niet mee in de spelersstats.</div>
      <div><button class="btn btn--primary" type="button" data-action="fetch-missing">Ontbrekende details ophalen · ${calls} calls</button></div>
    </section>`;
}

async function handleMissing(btn, ctx) {
  const { list } = await correctedList();
  const miss = missingDetails(list);
  let done = 0;
  try {
    await runWithButton(btn, `Ophalen 0/${miss.length}…`, () => fetchMany(miss, (n, total) => {
      done = n;
      btn.innerHTML = `<span>Ophalen ${n}/${total}…</span>`;
    }));
    toast(`${done} wedstrijden opgehaald · ${done * COST.match} calls`);
  } catch (err) {
    toast(`${done} opgehaald, daarna fout: ${explain(err)}`);
  }
  ctx.refresh();
}

const dmy = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
function ageOf(dob) {
  if (!dob) return null;
  const b = new Date(dob + 'T12:00:00'); const n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
}
const T_LABEL = { 'transfer-in': 'Gekomen', 'transfer-uit': 'Vertrokken', 'huur-in': 'Gehuurd', 'huur-uit': 'Verhuurd', promotie: 'Doorgestroomd', verlenging: 'Verlengd' };

const T_TYPES = [['transfer-in', 'Gekomen'], ['transfer-uit', 'Vertrokken'], ['huur-in', 'Gehuurd'], ['huur-uit', 'Verhuurd'], ['promotie', 'Doorgestroomd uit de jeugd'], ['verlenging', 'Contract verlengd']];

/** Transfers met toevoegen/aanpassen/verwijderen. id = het spelersprofiel (Highlightly-id of legacy-…). */
function transfersBlock(pr, id) {
  const list = ((pr && pr.transfers) || []).map((t, i) => ({ ...t, i })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `
    <section class="section">
      <div class="section__label"><span>Transfers</span><span>${list.length || ''}</span></div>
      ${list.length ? `<div class="list">${list.map((t) => `
        <button type="button" class="list-row transfer-row" data-edit-transfer="${t.i}" data-pid="${esc(String(id))}">
          <span class="list-row__main"><span class="list-row__title">${esc(T_LABEL[t.type] || t.type)}${t.club ? ` · <span class="transfer-club">${t.clubId ? clubCrest({ logo: t.clubLogo, name: t.club }, 18) : ''}${esc(t.club)}</span>` : ''}</span>
          <span class="list-row__sub">${esc(dmy(t.date))}${t.dateTo ? ` t/m ${esc(dmy(t.dateTo))}` : ''}${t.amount ? ` · ${euro(t.amount)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}${/vrij/i.test(t.note || '') && t.amount > 0 ? ' <span class="ptag ptag--warn">vrije transfer met bedrag?</span>' : ''}</span></span>
          <span class="muted" aria-hidden="true">✎</span></button>`).join('')}</div>`
        : '<p class="muted" style="font-size:13px">Nog geen transfers. Zonder transfers telt alleen het wedstrijdformulier.</p>'}
      <div><button class="btn btn--sm" type="button" data-add-transfer data-pid="${esc(String(id))}">+ Transfer toevoegen</button></div>
    </section>`;
}

async function editTransfer(ctx, id, index, profiles) {
  const pr = profiles[String(id)] || {};
  const all = (pr.transfers || []).slice();
  const t = index != null ? all[index] : { type: 'transfer-uit', date: new Date().toISOString().slice(0, 10) };
  const data = await openSheet({
    title: index != null ? 'Transfer aanpassen' : 'Transfer toevoegen',
    body: `<label class="field"><span>Soort</span><select name="type">${T_TYPES.map(([v, l]) => `<option value="${v}" ${t.type === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="field-row"><label class="field"><span>Datum</span><input name="date" type="date" value="${esc(t.date || '')}"></label>
      <label class="field"><span>Tot (bij huur)</span><input name="dateTo" type="date" value="${esc(t.dateTo || '')}"></label></div>
      ${clubField('club', 'Club', t)}
      <div class="field-row"><label class="field"><span>Bedrag (€)</span><input name="amount" type="number" inputmode="numeric" min="0" step="1000" placeholder="leeg = onbekend" value="${t.amount ?? ''}"></label>
      <label class="field"><span>Notitie</span><input name="note" maxlength="120" placeholder="bijv. Vrije transfer" value="${esc(t.note || '')}"></label></div>
      ${index != null ? '<label class="field field--check"><input type="checkbox" name="delete"> <span>Deze transfer verwijderen</span></label>' : ''}`,
    validate: (fd) => {
      if (fd.get('delete')) return null;
      if (!fd.get('date')) return 'Vul een datum in.';
      if (fd.get('dateTo') && fd.get('dateTo') < fd.get('date')) return '"Tot" ligt vóór de datum.';
      return null;
    },
  });
  if (!data) return;
  const next = all.slice();
  if (data.get('delete')) next.splice(index, 1);
  else {
    const amount = data.get('amount') === '' ? null : Number(data.get('amount'));
    const club = String(data.get('club') || '').trim() || null;
    let clubId = data.get('clubId') || null; let clubLogo = data.get('clubLogo') || null;
    if (club && !clubId) { const hit = matchTeam(await knownTeams(), club); if (hit) { clubId = hit.id; clubLogo = hit.logo || null; } }
    const item = { type: data.get('type'), date: data.get('date'), dateTo: data.get('dateTo') || null, club, clubId: clubId && !Number.isNaN(Number(clubId)) ? Number(clubId) : clubId, clubLogo: clubId ? clubLogo : null, amount, note: String(data.get('note') || '').trim() || null };
    if (index != null) next[index] = item; else next.push(item);
  }
  try {
    await savePlayer(id, { transfers: next });
    toast(data.get('delete') ? 'Transfer verwijderd' : 'Transfer opgeslagen', { action: 'Ongedaan maken', onAction: async () => { await savePlayer(id, { transfers: all }); ctx.refresh(); } });
    ctx.refresh();
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); }
}

// ---------- Speler zelf toevoegen (bijv. een oude selectie klaarzetten) ----------
const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Lijkt deze naam op iemand die je al hebt? Zelfde achternaam + zelfde eerste letter, of de ene naam zit in de andere. */
function similarNames(name, known) {
  const n = normName(name); if (n.length < 3) return [];
  const parts = n.split(' '); const last = parts[parts.length - 1]; const first = parts[0][0];
  return known.filter((k) => {
    const m = normName(k.name); if (!m) return false;
    const mp = m.split(' ');
    return m === n || (mp[mp.length - 1] === last && last.length > 2 && mp[0][0] === first) || (n.length > 5 && (m.includes(n) || n.includes(m)));
  }).slice(0, 3);
}

async function knownPeople(profiles) {
  const out = []; const seen = new Set();
  const squad = await currentSquad().catch(() => []);
  squad.forEach((p) => { seen.add(String(p.id)); out.push({ id: String(p.id), name: p.name, where: 'Highlightly' }); });
  Object.entries(profiles || {}).forEach(([id, pr]) => {
    if (seen.has(id) || pr.linkedTo) return;
    const name = pr.fullName || pr.legacyName; if (name) out.push({ id, name, where: 'archief' });
  });
  return out;
}

async function addPlayer(ctx) {
  const { profiles } = await correctedList();
  const known = await knownPeople(profiles);
  const start = `${getSeason()}-07-01`;
  const sheet = openSheet({
    title: 'Speler toevoegen',
    body: `<label class="field"><span>Naam</span><input name="name" maxlength="60" autocomplete="off" required placeholder="Voor- en achternaam"></label>
      <div data-dup class="sheet__note" hidden></div>
      <div class="field-row"><label class="field"><span>Positie</span><select name="position">${POS_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
      <label class="field"><span>Rugnummer</span><input name="shirt" type="number" inputmode="numeric" min="1" max="99"></label></div>
      <div class="field-row"><label class="field"><span>Nationaliteit</span>${natSelect('nat1', '', false)}</label>
      <label class="field"><span>Geboortedatum</span><input name="dob" type="date"></label></div>
      <div class="field-row"><label class="field"><span>Hoe kwam hij</span><select name="type">${T_TYPES.filter(([v]) => ['transfer-in', 'huur-in', 'promotie'].includes(v)).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <label class="field"><span>Datum</span><input name="date" type="date" value="${esc(start)}"></label></div>
      ${clubField('club', 'Van club', {})}
      <p class="muted sheet__note">Hij staat dan in de selectie van elk seizoen vanaf die datum. Vertrek, waarde en contract zet je daarna op zijn spelerspagina. Komt hij later in een Highlightly-opstelling voor, dan koppel je hem daar.</p>`,
    validate: (fd) => {
      if (!String(fd.get('name') || '').trim()) return 'Vul een naam in.';
      if (!fd.get('date')) return 'Vul de datum in waarop hij kwam.';
      return null;
    },
  });
  // Waarschuwen bij een naam die je al hebt (de sheet staat nu open).
  const dlg = document.querySelector('dialog[open]');
  const input = dlg && dlg.querySelector('input[name="name"]');
  const box = dlg && dlg.querySelector('[data-dup]');
  if (input && box) {
    input.addEventListener('input', () => {
      const hits = similarNames(input.value, known);
      box.hidden = !hits.length;
      box.innerHTML = hits.length ? `<span class="ptag ptag--warn">Bestaat al?</span> ${hits.map((h) => `<a href="#/speler/${encodeURIComponent(h.id)}">${esc(h.name)}</a> <span class="muted">(${h.where})</span>`).join(', ')}` : '';
    });
  }
  const data = await sheet;
  if (!data) return;
  const club = String(data.get('club') || '').trim() || null;
  let clubId = data.get('clubId') || null; let clubLogo = data.get('clubLogo') || null;
  if (club && !clubId) { const hit = matchTeam(await knownTeams(), club); if (hit) { clubId = hit.id; clubLogo = hit.logo || null; } }
  const id = `legacy-m${Date.now().toString(36)}`;
  const shirt = data.get('shirt') === '' ? null : Number(data.get('shirt'));
  const prof = {
    fullName: String(data.get('name')).trim(), position: data.get('position') || null, shirt,
    nationality: data.get('nat1') || null, dob: data.get('dob') || null, manual: true, linkedTo: null,
    transfers: [{ type: data.get('type'), date: data.get('date'), dateTo: null, club, clubId: clubId && !Number.isNaN(Number(clubId)) ? Number(clubId) : clubId, clubLogo: clubId ? clubLogo : null, amount: null, note: null }],
  };
  try {
    await savePlayer(id, prof);
    toast(`${prof.fullName} toegevoegd`, { action: 'Bekijken', onAction: () => { location.hash = `#/speler/${encodeURIComponent(id)}`; } });
    ctx.refresh();
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); }
}

/** Handmatige of oude speler koppelen aan een Highlightly-speler: zijn gegevens gaan mee, bestaande blijven staan. */
async function linkPlayer(ctx, id) {
  const { profiles } = await correctedList();
  const pr = profiles[String(id)] || {};
  const squad = await currentSquad().catch(() => []);
  if (!squad.length) { toast('Nog geen Highlightly-spelers: haal eerst wedstrijddetails op.'); return; }
  const sugg = similarNames(pr.fullName || pr.legacyName, squad.map((p) => ({ id: String(p.id), name: p.name })))[0];
  const data = await openSheet({
    title: 'Koppelen aan Highlightly',
    body: `<label class="field"><span>Speler</span><select name="to"><option value="">Kies…</option>${squad.map((p) => `<option value="${p.id}" ${sugg && sugg.id === String(p.id) ? 'selected' : ''}>${esc(p.name)}${p.number != null ? ' #' + p.number : ''} · ${p.seasons.map((y) => `${y}`.slice(2)).join(', ')}</option>`).join('')}</select></label>
      <p class="muted sheet__note">Naam, profiel, transfers, waarde en blessures gaan naar die speler. Wat daar al ingevuld is, blijft staan; transfers worden samengevoegd.</p>`,
    validate: (fd) => (fd.get('to') ? null : 'Kies een speler.'),
    submitLabel: 'Koppelen',
  });
  if (!data) return;
  const to = String(data.get('to'));
  const target = profiles[to] || {};
  const merged = {};
  ['fullName', 'shortName', 'photoUrl', 'position', 'shirt', 'nationality', 'dob', 'foot', 'height', 'joined', 'contractUntil', 'note', 'legacyId', 'legacyName'].forEach((k) => {
    if (pr[k] != null && pr[k] !== '' && (target[k] == null || target[k] === '')) merged[k] = pr[k];
  });
  const key = (t) => `${t.type}|${t.date}`;
  ['transfers', 'valueHistory', 'injuries'].forEach((k) => {
    if (!(pr[k] || []).length) return;
    const have = new Set((target[k] || []).map((x) => (k === 'transfers' ? key(x) : JSON.stringify(x))));
    merged[k] = [...(target[k] || []), ...pr[k].filter((x) => !have.has(k === 'transfers' ? key(x) : JSON.stringify(x)))];
  });
  try {
    await savePlayer(to, merged);
    await savePlayer(id, { linkedTo: Number(to) });
    toast('Gekoppeld');
    location.hash = `#/speler/${encodeURIComponent(to)}`;
  } catch (err) { toast(`Koppelen lukte niet: ${err.message || err}`); }
}

function mountTransfers(root, ctx) {
  root.addEventListener('click', async (e) => {
    const addP = e.target.closest('[data-add-player]');
    if (addP) { addPlayer(ctx); return; }
    const lk = e.target.closest('[data-link-player]');
    if (lk) { linkPlayer(ctx, lk.dataset.linkPlayer); return; }
    const prof = e.target.closest('[data-edit-profile]');
    if (prof) { const { profiles } = await correctedList(); editProfile(ctx, prof.dataset.editProfile, profiles); return; }
    const add = e.target.closest('[data-add-transfer]');
    const ed = e.target.closest('[data-edit-transfer]');
    if (!add && !ed) return;
    const { profiles } = await correctedList();
    const id = (add || ed).dataset.pid;
    editTransfer(ctx, id, ed ? Number(ed.dataset.editTransfer) : null, profiles);
  });
}

function profileBlock(pr, id) {
  pr = pr || {};
  const age = ageOf(pr.dob);
  const kv = [
    ['Geboren', pr.dob ? `${dmy(pr.dob)}${age != null ? ` (${age})` : ''}` : null],
    ['Nationaliteit', pr.nationality ? nationalities(pr.nationality).map((n) => `<span class="nat">${flag(n, 14)}${esc(n)}</span>`).join(' ') : null],
    ['Voet', pr.foot],
    ['Lengte', pr.height ? `${pr.height} cm` : null],
    ['Bij de club sinds', pr.joined ? dmy(pr.joined) : null],
    ['Contract tot', pr.contractUntil ? dmy(pr.contractUntil) : null],
    ['Notitie', pr.note || null],
  ].filter(([, v]) => v);
  const editBtn = id != null ? `<div><button class="btn btn--sm" type="button" data-edit-profile="${esc(String(id))}">Profiel bewerken</button></div>` : '';
  if (!kv.length) {
    return `<section class="section"><div class="section__label"><span>Profiel</span></div>
      <p class="muted" style="font-size:13px">Nog geen profiel: nationaliteit, geboortedatum, voet, lengte en contract vul je zelf in.</p>${editBtn}</section>`;
  }
  return `
    <section class="section">
      <div class="section__label"><span>Profiel</span><span>${pr.legacyId ? 'uit je oude tracker' : ''}</span></div>
      <div class="profile">
        <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Nationaliteit' ? v : esc(v)}</dd>`).join('')}</dl>
      </div>
      ${editBtn}
    </section>`;
}

const POS_OPTS = [['', '—'], ['Goalkeeper', 'Keeper'], ['Defender', 'Verdediger'], ['Midfielder', 'Middenvelder'], ['Forward', 'Aanvaller']];
const FOOT_OPTS = ['', 'rechts', 'links', 'tweebenig'];

function natSelect(name, current, allowNone) {
  const cur = current || '';
  const known = [...NAT_TOP, ...NAT_ALL].includes(cur);
  const opt = (n) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`;
  return `<span class="nat-pick"><span class="nat-pick__flag" data-flag-for="${name}">${cur ? flag(cur, 14) : ''}</span>
    <select name="${name}" data-nat>${allowNone ? '<option value="">Geen</option>' : '<option value="">Onbekend</option>'}
      ${cur && !known ? opt(cur) : ''}<optgroup label="Vaak">${NAT_TOP.map(opt).join('')}</optgroup><optgroup label="Alle">${NAT_ALL.map(opt).join('')}</optgroup>
    </select></span>`;
}

async function editProfile(ctx, id, profiles) {
  const pr = profiles[String(id)] || {};
  const [n1, n2] = nationalities(pr.nationality);
  const data = await openSheet({
    title: 'Profiel bewerken',
    body: `<label class="field"><span>Nationaliteit</span>${natSelect('nat1', n1, false)}</label>
      <label class="field"><span>Tweede nationaliteit</span>${natSelect('nat2', n2, true)}</label>
      <div class="field-row"><label class="field"><span>Geboortedatum</span><input name="dob" type="date" value="${esc(pr.dob || '')}"></label>
      <label class="field"><span>Rugnummer</span><input name="shirt" type="number" inputmode="numeric" min="1" max="99" value="${pr.shirt ?? ''}"></label></div>
      <div class="field-row"><label class="field"><span>Positie</span><select name="position">${POS_OPTS.map(([v, l]) => `<option value="${v}" ${(pr.position || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Voet</span><select name="foot">${FOOT_OPTS.map((f) => `<option value="${f}" ${(pr.foot || '') === f ? 'selected' : ''}>${f || '—'}</option>`).join('')}</select></label></div>
      <div class="field-row"><label class="field"><span>Lengte (cm)</span><input name="height" type="number" inputmode="numeric" min="140" max="220" value="${pr.height ?? ''}"></label>
      <label class="field"><span>Contract tot</span><input name="contract" type="date" value="${esc(pr.contractUntil || '')}"></label></div>
      <p class="muted sheet__note">Positie en rugnummer van Highlightly blijven leidend in de opstellingen; dit is je profiel.</p>`,
    validate: (fd) => {
      if (fd.get('nat2') && fd.get('nat2') === fd.get('nat1')) return 'Twee keer dezelfde nationaliteit.';
      const h = fd.get('height'); if (h && (Number(h) < 140 || Number(h) > 220)) return 'Lengte tussen 140 en 220 cm.';
      const s = fd.get('shirt'); if (s && (Number(s) < 1 || Number(s) > 99)) return 'Rugnummer tussen 1 en 99.';
      return null;
    },
  });
  if (!data) return;
  const nats = [data.get('nat1'), data.get('nat2')].filter(Boolean);
  const next = {
    nationality: nats.length ? nats.join(' / ') : null,
    dob: data.get('dob') || null,
    shirt: data.get('shirt') ? Number(data.get('shirt')) : null,
    position: data.get('position') || null,
    foot: data.get('foot') || null,
    height: data.get('height') ? Number(data.get('height')) : null,
    contractUntil: data.get('contract') || null,
  };
  const before = Object.fromEntries(Object.keys(next).map((k) => [k, pr[k] ?? null]));
  try {
    await savePlayer(id, next);
    toast('Profiel opgeslagen', { action: 'Ongedaan maken', onAction: async () => { await savePlayer(id, before); ctx.refresh(); } });
    ctx.refresh();
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); }
}

// Vlag naast de dropdown live bijwerken (native dropdowns kunnen geen plaatjes tonen).
document.addEventListener('change', (e) => {
  const s = e.target.closest && e.target.closest('select[data-nat]');
  if (!s) return;
  const slot = s.closest('.nat-pick').querySelector('.nat-pick__flag');
  if (slot) slot.innerHTML = s.value ? flag(s.value, 14) : '';
});

const SORTS = [['line', 'Linie'], ['goals', 'Goals'], ['minutes', 'Minuten'], ['rating', 'Cijfer']];

function initials(name) {
  const parts = String(name || '?').replace(/^[A-Z]\.\s*/, '').split(/\s+/).filter(Boolean);
  const last = parts.filter((w) => !/^(van|der|de|den|het|ter|te)$/i.test(w)).pop() || parts[0] || '?';
  return ((parts[0] || '?')[0] + (parts.length > 1 ? last[0] : '')).toUpperCase();
}

/** Transfermarkt levert dezelfde foto in meerdere maten; 'header' is klein en wazig, 'big' is scherp. */
export function sharpPhoto(url) {
  return String(url || '').replace('/portrait/header/', '/portrait/big/').replace('/portrait/small/', '/portrait/big/').replace('/portrait/medium/', '/portrait/big/');
}

/** Bij een fout: eerst de originele link proberen, daarna initialen. */
function photoImg(url, cls, ini) {
  const big = sharpPhoto(url);
  const fallbackIni = ini ? `this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar__ini',textContent:'${ini}'}))` : 'this.remove()';
  return `<img class="${cls}" src="${esc(big)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-orig="${esc(url)}" onerror="if(this.dataset.orig&&this.src!==this.dataset.orig){this.src=this.dataset.orig;this.dataset.orig='';}else{${fallbackIni}}">`;
}

/** Portret met rugnummer; zonder foto initialen in clubkleuren. */
function avatar(p) {
  const photo = p.photo || (p.profile && p.profile.photoUrl);
  const ini = esc(initials(p.name));
  return `<span class="avatar">${photo ? photoImg(photo, 'avatar__img', ini) : `<span class="avatar__ini">${ini}</span>`}${p.number != null ? `<span class="avatar__num mono">${p.number}</span>` : ''}</span>`;
}

/** Twee spelers in de huidige selectie met hetzelfde rugnummer: waarschuwen (archief maakt niet uit). */
function markDuplicateNumbers(players) {
  const byNr = new Map();
  players.forEach((p) => { p.dupWith = null; if (p.number != null) byNr.set(p.number, [...(byNr.get(p.number) || []), p]); });
  byNr.forEach((ps) => { if (ps.length > 1) ps.forEach((p) => { p.dupWith = ps.filter((x) => x !== p).map((x) => x.name); }); });
}
const dupTag = (p) => (p.dupWith && p.dupWith.length ? `<span class="ptag ptag--warn" title="Pas het nummer aan op de spelerspagina als het niet klopt">⚠ nr. ${esc(String(p.number))} ook: ${esc(p.dupWith.join(', '))}</span>` : '');
const fmtLabel = (l) => l.replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => new Date(`${y}-${m}-${d}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: y === String(new Date().getFullYear()) ? undefined : 'numeric' }));

function rowHtml(p, sort) {
  const base = p.apps
    ? `${p.apps} ${p.apps === 1 ? 'duel' : 'duels'}${p.subIns ? ` (${p.subIns} in)` : ''} · ${p.minutes}'`
    : p.squads ? `${p.squads}× op de bank` : 'nog geen officieel duel';
  const tags = (p.labels || []).map((l) => `<span class="ptag ${l.startsWith('geblesseerd') ? 'ptag--inj' : ''}">${esc(fmtLabel(l))}</span>`).join('') + (p.conflict ? '<span class="ptag ptag--warn">⚠ volgens transfers al weg</span>' : '') + dupTag(p);
  const sub = `${base}${tags ? ' ' + tags : ''}`;
  const nat = p.nationality || (p.profile && p.profile.nationality);
  const flags = nat ? nationalities(nat).map((n) => flag(n, 12)).join('') : '';
  return `<a class="list-row player-row" href="#/speler/${encodeURIComponent(p.id)}">
    ${avatar(p)}
    <span class="list-row__main"><span class="list-row__title">${esc(p.name)}${flags ? `<span class="row-flags">${flags}</span>` : ''}</span>
      <span class="list-row__sub">${sort === 'line' ? '' : esc(LINE_SHORT[p.position] || '—') + ' · '}${sub}</span></span>
    <span class="player-row__stats mono">
      <span title="Goals">${p.goals || '·'}</span><span title="Assists">${p.assists || '·'}</span>
      <span class="${p.rating >= 7 ? 'accent-text' : ''}" title="Gemiddeld cijfer">${p.rating == null ? '–' : p.rating.toFixed(1)}</span>
    </span>
  </a>`;
}

const statHead = '<div class="player-head mono"><span></span><span>G</span><span>A</span><span>Cijfer</span></div>';

// ---------- Desktop: selectie als sorteerbare tabel ----------
const LINE_ORDER = { Goalkeeper: 1, Defender: 2, Midfielder: 3, Forward: 4 };
const COLS = [
  ['nr', '#', 'num'], ['name', 'Speler', 'text'], ['pos', 'Pos', 'num'], ['age', 'Leeftijd', 'num'], ['apps', 'Duels', 'num'],
  ['min', 'Minuten', 'num'], ['goals', 'G', 'num'], ['assists', 'A', 'num'], ['rating', 'Cijfer', 'num'], ['value', 'Waarde', 'num'],
];
function squadTable(players, profiles) {
  const posKey = (p) => (LINE_ORDER[p.position] || 9) * 100 + (p.number ?? 99);
  const rows = players.slice().sort((a, b) => posKey(a) - posKey(b)).map((p) => {
    const pr = p.profile || profiles[String(p.id)] || {};
    const age = ageOf(pr.dob);
    const val = (pr.valueHistory || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const nat = p.nationality || pr.nationality;
    const tags = (p.labels || []).map((l) => `<span class="ptag ${l.startsWith('geblesseerd') ? 'ptag--inj' : ''}">${esc(fmtLabel(l))}</span>`).join('') + (p.conflict ? '<span class="ptag ptag--warn">⚠ volgens transfers al weg</span>' : '') + dupTag(p);
    const v = { nr: p.number ?? 99, name: p.name, pos: (LINE_ORDER[p.position] || 9) * 100 + (p.number ?? 99), age: age ?? 99, apps: p.apps || 0, min: p.minutes || 0, goals: p.goals || 0, assists: p.assists || 0, rating: p.rating ?? -1, value: val ? val.amount : -1 };
    return `<tr data-line="${esc(p.position || '')}" data-href="#/speler/${encodeURIComponent(p.id)}" ${Object.entries(v).map(([k, x]) => `data-${k}="${esc(String(x))}"`).join(' ')}>
      <td class="mono sq-nr">${p.number ?? '–'}</td>
      <td class="sq-name"><a href="#/speler/${encodeURIComponent(p.id)}">${avatar(p)}<span class="sq-name__txt"><span class="sq-name__n">${esc(p.name)}${nat ? `<span class="row-flags">${nationalities(nat).map((n) => flag(n, 14)).join('')}</span>` : ''}</span>${tags ? `<span class="sq-name__tags">${tags}</span>` : ''}</span></a></td>
      <td>${esc(LINE_SHORT[p.position] || '—')}</td>
      <td class="mono">${age ?? '–'}</td>
      <td class="mono">${p.apps || 0}${p.subIns ? `<span class="muted"> (${p.subIns})</span>` : ''}</td>
      <td class="mono">${p.minutes || 0}</td>
      <td class="mono sq-strong">${p.goals || '·'}</td>
      <td class="mono">${p.assists || '·'}</td>
      <td class="mono ${p.rating >= 7 ? 'accent-text' : ''}">${p.rating == null ? '–' : p.rating.toFixed(1)}</td>
      <td class="mono">${val ? euro(val.amount) : '–'}</td>
    </tr>`;
  }).join('');
  const html = `<div class="table-wrap"><table class="table sq-table" data-sort-key="pos" data-sort-dir="asc">
    <thead><tr>${COLS.map(([k, l]) => `<th data-key="${k}" data-type="${COLS.find((c) => c[0] === k)[2]}" ${k === 'pos' ? 'aria-sort="ascending"' : ''}><button type="button">${l}</button></th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
  return html;
}

/** Kopjes Keepers / Verdedigers / ... tussen de rijen, alleen als er op positie gesorteerd is. */
const LINE_LABEL = Object.fromEntries(LINES.map(([k, l]) => [k, l]));
function groupRows(table) {
  table.querySelectorAll('tr.sq-group').forEach((r) => r.remove());
  if (table.dataset.group === 'flat') return;
  const body = table.tBodies[0];
  const rows = [...body.rows];
  let last = null;
  rows.forEach((r) => {
    const line = r.dataset.line || '';
    if (line === last) return;
    last = line;
    const n = rows.filter((x) => (x.dataset.line || '') === line).length;
    const g = document.createElement('tr');
    g.className = 'sq-group';
    g.innerHTML = `<th colspan="${COLS.length}"><span>${esc(LINE_LABEL[line] || 'Overig')}</span><span class="mono">${n}</span></th>`;
    body.insertBefore(g, r);
  });
}

const GROUP_KEY = 'ms-sq-group';
const groupPref = () => { try { return localStorage.getItem(GROUP_KEY) === 'flat' ? 'flat' : 'lines'; } catch { return 'lines'; } };

function sortTable(table, key, { keepDir = false } = {}) {
  const type = (COLS.find((c) => c[0] === key) || [])[2] || 'num';
  const same = table.dataset.sortKey === key && !keepDir;
  // Standaardrichting: namen/nummers/positie oplopend, stats aflopend.
  const asc = keepDir ? table.dataset.sortDir === 'asc' : same ? table.dataset.sortDir !== 'asc' : ['nr', 'name', 'pos', 'age'].includes(key);
  table.dataset.sortKey = key; table.dataset.sortDir = asc ? 'asc' : 'desc';
  const body = table.tBodies[0];
  table.querySelectorAll('tr.sq-group').forEach((r) => r.remove());
  const rows = [...body.rows];
  const grouped = table.dataset.group !== 'flat';
  const lineOf = (r) => Math.floor(Number(r.dataset.pos) / 100);
  rows.sort((a, b) => {
    if (grouped && lineOf(a) !== lineOf(b)) return lineOf(a) - lineOf(b);
    const x = a.dataset[key]; const y = b.dataset[key];
    const c = type === 'text' ? x.localeCompare(y, 'nl') : Number(x) - Number(y);
    return (asc ? c : -c) || Number(a.dataset.pos) - Number(b.dataset.pos);
  });
  rows.forEach((r) => body.append(r));
  groupRows(table);
  table.querySelectorAll('thead th').forEach((th) => { if (th.dataset.key === key) th.setAttribute('aria-sort', asc ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort'); });
}

function sorted(players, sort) {
  const by = {
    goals: (a, b) => b.goals - a.goals || b.assists - a.assists || b.minutes - a.minutes,
    minutes: (a, b) => b.minutes - a.minutes,
    rating: (a, b) => (b.rated >= 3) - (a.rated >= 3) || (b.rating ?? -1) - (a.rating ?? -1),
  }[sort];
  return players.slice().sort(by);
}

function squadList(players, sort) {
  if (sort !== 'line') {
    return `<section class="section">${statHead}<div class="list">${sorted(players, sort).map((p) => rowHtml(p, sort)).join('')}</div>
      ${sort === 'rating' ? '<p class="muted" style="font-size:12px">Spelers met minder dan 3 beoordeelde duels staan onderaan.</p>' : ''}</section>`;
  }
  return LINES.map(([key, label]) => {
    const group = players.filter((p) => (p.position || '') === key)
      .sort((a, b) => b.apps - a.apps || b.minutes - a.minutes || (a.number ?? 99) - (b.number ?? 99));
    if (!group.length) return '';
    return `<section class="section">
      <div class="section__label"><span>${esc(label)}</span><span>${group.length}</span></div>
      ${statHead}<div class="list">${group.map((p) => rowHtml(p, sort)).join('')}</div>
    </section>`;
  }).join('');
}

/** "· 9 nationaliteiten", alleen als we van de meeste spelers de nationaliteit kennen. */
function natFact(players, profiles) {
  const nats = players.map((p) => { const pr = p.profile || profiles[String(p.id)]; return pr && pr.nationality ? nationalities(pr.nationality) : []; });
  const known = nats.filter((n) => n.length).length;
  if (known < Math.max(5, players.length * 0.6)) return '';
  const set = new Set(nats.flat().map((n) => countryCode(n) || n.toLowerCase()));
  return set.size > 1 ? ` · ${set.size} nationaliteiten` : '';
}

/**
 * Selectie van het bekeken seizoen: wedstrijdformulieren + perioden uit de transfers.
 * Geeft alle leden en de groepen active / left / loaned / future.
 */
function seasonMembers(list, squadPlayers, profiles) {
  const official = list.filter((m) => m.league && !/friendl/i.test(m.league.name));
  const win = seasonWindow(getSeason(), official);
  const today = new Date().toISOString().slice(0, 10);
  const ref = isCurrentSeason() ? today : win.end;
  const members = [];
  const seen = new Set();
  squadPlayers.forEach((p) => {
    const last = p.log.length ? p.log[p.log.length - 1].match.date : null;
    const st = statusIn(p.profile, win, ref, { onSheet: true, lastSheet: last });
    seen.add(String(p.id));
    const inj = injuryLabel(p.profile, ref, isCurrentSeason());
    members.push({ ...p, status: st.status || 'active', labels: [...(inj ? [inj] : []), ...(st.labels || [])], conflict: !!st.conflict, injured: !!inj });
  });
  Object.entries(profiles || {}).forEach(([id, pr]) => {
    if (seen.has(id) || pr.linkedTo) return; // gekoppelde oud-profielen staan al onder hun Highlightly-id
    if (!pr.legacyId && !pr.transfers) return; // alleen een naamkeuze, geen periode
    const st = statusIn(pr, win, ref);
    if (!st.member) return;
    members.push({
      id, name: pr.fullName || pr.legacyName || '?', number: pr.shirt ?? null, position: pr.position || '',
      photo: pr.photoUrl || null, nationality: pr.nationality || null,
      apps: 0, subIns: 0, minutes: 0, squads: 0, goals: 0, assists: 0, rating: null, rated: 0, log: [],
      status: pr.squadLevel === 'jeugd' && st.status === 'active' ? 'youth' : st.status, labels: [...(injuryLabel(pr, ref, isCurrentSeason()) ? [injuryLabel(pr, ref, isCurrentSeason())] : []), ...(st.labels || [])], conflict: false, profileOnly: true,
      injured: !!injuryLabel(pr, ref, isCurrentSeason()),
    });
  });
  const groups = { active: [], youth: [], left: [], loaned: [], future: [] };
  members.forEach((m) => (groups[m.status] || groups.active).push(m));
  return { members, groups };
}

function periodText(pr) {
  const { spells: sp } = spells(pr);
  if (!sp.length) return null;
  const y = (d) => (d ? d.slice(0, 4) : '…');
  return sp.map((s) => `${y(s.from)}–${s.to ? y(s.to) : 'nu'}${s.kind === 'huur' ? ' (huur)' : s.kind === 'jeugd' ? ' (jeugd)' : ''}`).join(', ');
}

/** Spelerspagina zonder Highlightly-stats dit seizoen: alleen het profiel uit je archief. */
function profileOnlyPage(pr, id) {
  const name = pr.fullName || pr.legacyName || '?';
  const per = periodText(pr);
  return `
    ${head({ kicker: `Archief · ${LINE_SHORT[pr.position] || '—'}`, title: name, back: 'selectie' })}
    <section class="section">
      <div class="player-hero">${pr.photoUrl ? photoImg(pr.photoUrl, 'player-hero__photo', '') : ''}<span class="player-hero__num">${pr.shirt ?? '–'}</span><span class="muted">${esc(LINE_SHORT[pr.position] || '')}${per ? ' · ' + esc(per) : ''}</span></div>
      <div><button class="btn btn--sm" type="button" data-action="edit-name" data-id="${esc(id)}" data-api="" data-full="${esc(pr.fullName || '')}" data-short="${esc(pr.shortName || '')}" data-photo="${esc(pr.photoUrl || '')}">Naam en foto</button></div>
      <p class="muted" style="font-size:13px;margin:0">${pr.linkedTo === null || String(id).startsWith('legacy-')
        ? 'Nog niet gekoppeld aan Highlightly. Stats verschijnen zodra hij in een opgehaald seizoen voorkomt en je hem hieronder koppelt.'
        : 'Geen officiële duels in dit seizoen. Kies een ander seizoen via de clubnaam op Home.'}</p>
      ${pr.linkedTo == null ? `<div><button class="btn btn--sm" type="button" data-link-player="${esc(id)}">Koppelen aan Highlightly-speler</button></div>` : ''}
    </section>
    ${profileBlock(pr, id)}
    ${valueBlock(pr, id)}
    ${injuryBlock(pr, id)}
    ${transfersBlock(pr, id)}`;
}

export const playerViews = {
  archief: {
    title: 'Archief',
    navKey: 'selectie',
    async render() {
      const { profiles } = await correctedList();
      const rows = Object.entries(profiles || {})
        .filter(([, pr]) => (pr.legacyId || pr.transfers) && !(pr.linkedTo && profiles[String(pr.linkedTo)]))
        .map(([id, pr]) => {
          const { spells: sp } = spells(pr);
          const last = sp.length ? (sp[sp.length - 1].to || '9999') : '';
          return { id, pr, last, name: pr.fullName || pr.legacyName || '?' };
        })
        .sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
      return `${head({ kicker: 'Selectie / Archief', title: 'Archief', back: 'selectie' })}
        <section class="section">
          <p class="muted" style="font-size:13px">Iedereen uit je archief, huidige spelers bovenaan, daarna wie het laatst vertrok.</p>
          <div><button class="btn btn--sm" type="button" data-add-player>+ Speler toevoegen</button></div>
          <div class="list">${rows.map((r) => `<a class="list-row player-row" href="#/speler/${encodeURIComponent(r.id)}">
            ${avatar({ name: r.name, photo: r.pr.photoUrl, number: r.pr.shirt })}
            <span class="list-row__main"><span class="list-row__title">${esc(r.name)}${r.pr.nationality ? `<span class="row-flags">${nationalities(r.pr.nationality).map((n) => flag(n, 12)).join('')}</span>` : ''}</span>
              <span class="list-row__sub">${esc(LINE_SHORT[r.pr.position] || '—')}${periodText(r.pr) ? ' · ' + esc(periodText(r.pr)) : ''}${String(r.id).startsWith('legacy-') ? ' · niet gekoppeld' : ''}</span></span>
            <span></span></a>`).join('')}</div>
        </section>`;
    },
    mount(root, ctx) { mountTransfers(root, ctx); },
  },

  selectie: {
    title: 'Selectie',
    async render() {
      const { list, profiles } = await correctedList();
      const built = buildSquad(list, TEAM, profiles);
      const { matches } = built;
      const { members, groups } = seasonMembers(list, built.players, profiles);
      const players = groups.active;
      markDuplicateNumbers(players);
      const kicker = `MySeasons / ${MAIN_CLUB.name} ${seasonLabel()}`;
      if (!members.length) {
        return `${head({ kicker, title: 'Selectie' })}
          ${missingBlock(list) || `<section class="section"><div class="empty"><span class="empty__title">Nog geen spelers</span>
            <p class="muted">De selectie komt uit de opstellingen van gespeelde wedstrijden. Synchroniseer eerst het seizoen op Home.</p>
            <div><a class="btn" href="#/home">Naar Home</a></div></div></section>`}`;
      }
      const used = members.filter((p) => p.apps).length;
      const extra = [
        ['left', isCurrentSeason() ? 'Vertrokken dit seizoen' : 'Vertrokken tijdens het seizoen'],
        ['youth', 'Jeugd en beloften'],
        ['loaned', 'Verhuurd'],
        ['future', 'Komt nog'],
      ].filter(([k]) => groups[k].length);
      return `
        ${head({ kicker, title: 'Selectie' })}
        <section class="section">
          <p class="muted" style="font-size:13px">${players.length} ${isCurrentSeason() ? 'spelers nu bij de club' : 'spelers aan het eind van het seizoen'} · ${used} kwamen in actie in ${matches} officiële ${matches === 1 ? 'duel' : 'duels'}${natFact(players, profiles)}</p>
          <fieldset class="segmented segmented--4" style="margin:0;padding:0">
            <legend class="visually-hidden">Sorteren</legend>
            ${SORTS.map(([v, l], i) => `<input type="radio" name="sq-sort" id="sq-${v}" value="${v}" ${i === 0 ? 'checked' : ''}><label for="sq-${v}">${l}</label>`).join('')}
          </fieldset>
        </section>
        ${missingBlock(list)}
        <div class="mob-only">${SORTS.map(([v], i) => `<div data-sq="${v}" ${i === 0 ? '' : 'hidden'}>${squadList(players, v)}</div>`).join('')}</div>
        <section class="section desk-only-block">
          <div class="sq-tools"><fieldset class="segmented segmented--2 sq-group-toggle" style="margin:0;padding:0"><legend class="visually-hidden">Indeling</legend>
            <input type="radio" name="sq-group" id="sqg-lines" value="lines" ${groupPref() === 'lines' ? 'checked' : ''}><label for="sqg-lines">Per linie</label>
            <input type="radio" name="sq-group" id="sqg-flat" value="flat" ${groupPref() === 'flat' ? 'checked' : ''}><label for="sqg-flat">Eén lijst</label></fieldset></div>
          ${squadTable(players, profiles)}<p class="muted" style="font-size:12px">Klik op een kolom om te sorteren, nog een keer draait de volgorde om. Duels: tussen haakjes de invalbeurten.</p></section>
        ${extra.map(([k, label]) => `<section class="section"><details class="fold" ${isCurrentSeason() ? '' : 'open'}>
          <summary class="section__label"><span>${esc(label)}</span><span>${groups[k].length}</span></summary>
          <div class="mob-only">${statHead}<div class="list">${groups[k].map((p) => rowHtml(p, 'all')).join('')}</div></div>
          <div class="desk-only-block">${squadTable(groups[k], profiles)}</div></details></section>`).join('')}
        <section class="section"><div class="btn-row"><button class="btn btn--sm" type="button" data-add-player>+ Speler toevoegen</button><a class="link-btn" href="#/archief">Alle spelers uit je archief</a></div></section>`;
    },
    mount(root, ctx) {
      mountTransfers(root, ctx);
      root.querySelectorAll('.sq-table').forEach((t) => { t.dataset.group = groupPref(); sortTable(t, t.dataset.sortKey || 'pos', { keepDir: true }); });
      root.querySelectorAll('input[name="sq-group"]').forEach((i) => i.addEventListener('change', () => {
        try { localStorage.setItem(GROUP_KEY, i.value); } catch { /* niet erg */ }
        root.querySelectorAll('.sq-table').forEach((t) => { t.dataset.group = i.value; sortTable(t, t.dataset.sortKey || 'pos', { keepDir: true }); });
      }));
      root.addEventListener('click', (e) => {
        const th = e.target.closest('.sq-table th[data-key]');
        if (th) { sortTable(th.closest('table'), th.dataset.key); return; }
        const tr = e.target.closest('.sq-table tbody tr:not(.sq-group)');
        if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
      });
      root.querySelectorAll('input[name="sq-sort"]').forEach((input) => input.addEventListener('change', () => {
        root.querySelectorAll('[data-sq]').forEach((el) => { el.hidden = el.dataset.sq !== input.value; });
      }));
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="fetch-missing"]');
        if (btn) handleMissing(btn, ctx);
      });
    },
  },

  speler: {
    title: 'Speler',
    navKey: 'selectie',
    mount(root, ctx) {
      mountTransfers(root, ctx);
      mountExtra(root, ctx, async () => (await correctedList()).profiles);
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action="edit-name"]');
        if (!btn) return;
        const { id, api, full, short, photo } = btn.dataset;
        const data = await openSheet({
          title: 'Naam aanpassen',
          body: `<label class="field"><span>Volledige naam</span><input name="full" maxlength="60" autocomplete="off" placeholder="${esc(api)}" value="${esc(full)}"></label>
            <label class="field"><span>Korte naam (tijdlijn, opstellingen)</span><input name="short" maxlength="30" autocomplete="off" placeholder="${esc(autoShort(full || api))}" value="${esc(short)}"></label>
            <label class="field"><span>Foto-link</span><input name="photo" type="url" inputmode="url" autocomplete="off" placeholder="https://…" value="${esc(photo || '')}"></label>
            <p class="muted sheet__note">Leeg laten = automatisch. ${api ? `Highlightly noemt hem: ${esc(api)}` : ''}</p>`,
          validate: (fd) => (fd.get('photo') && !/^https:\/\/\S+$/.test(String(fd.get('photo')).trim()) ? 'De foto-link moet met https:// beginnen.' : null),
        });
        if (!data) return;
        const next = { fullName: String(data.get('full') || '').trim() || null, shortName: String(data.get('short') || '').trim() || null, photoUrl: String(data.get('photo') || '').trim() || null };
        if (next.fullName === (full || null) && next.shortName === (short || null) && next.photoUrl === (photo || null)) { toast('Niets veranderd'); return; }
        try {
          await savePlayer(id, next);
          toast('Naam opgeslagen', { action: 'Ongedaan maken', onAction: async () => { await savePlayer(id, { fullName: full || null, shortName: short || null, photoUrl: photo || null }); ctx.refresh(); } });
          ctx.refresh();
        } catch (err) {
          toast(`Opslaan lukte niet: ${err.message || err}`);
        }
      });
    },
    async render(ctx, args) {
      const rawId = decodeURIComponent(args[0] || '');
      const id = Number(rawId);
      const { list, profiles } = await correctedList();
      const { players } = buildSquad(list, TEAM, profiles);
      const p = players.find((x) => x.id === id);
      const prof = profiles[rawId];
      if (!p && prof) return profileOnlyPage(prof, rawId);
      if (!p) {
        return `${head({ kicker: 'Selectie', title: 'Niet gevonden', back: 'selectie' })}
          <section class="section"><p class="muted">Deze speler staat (nog) niet in een opgehaalde wedstrijd.</p></section>`;
      }
      const facts = playerFacts(p, players);
      const tiles = [
        [p.apps, p.apps === 1 ? 'duel' : 'duels', p.starts ? `${p.starts} basis` : ''],
        [p.minutes, 'minuten', p.apps ? `gem. ${Math.round(p.minutes / p.apps)}'` : ''],
        [p.goals, p.goals === 1 ? 'goal' : 'goals', p.penalties ? `${p.penalties} pen.` : ''],
        [p.assists, p.assists === 1 ? 'assist' : 'assists', ''],
        [p.rating == null ? '–' : p.rating.toFixed(2), 'gem. cijfer', p.rated ? `${p.rated} beoordeeld` : ''],
        [p.yellow + p.red, 'kaarten', p.red ? `${p.red} rood` : ''],
      ];
      const log = p.log.slice().reverse();
      return `
        ${head({ kicker: `Selectie · ${LINE_SHORT[p.position] || '—'}`, title: p.name, back: 'selectie' })}
        <section class="section">
          <div class="player-hero">${p.profile && p.profile.photoUrl ? photoImg(p.profile.photoUrl, 'player-hero__photo', '') : ''}<span class="player-hero__num">${p.number ?? '–'}</span>
            <span class="muted">${esc(LINE_SHORT[p.position] || '')}${p.squads > p.apps ? ` · ${p.squads - p.apps}× op de bank zonder invalbeurt` : ''}</span></div>
          <p class="muted" style="font-size:12px;margin:0">Kort: ${esc(p.short)}${p.profile && (p.profile.fullName || p.profile.shortName) ? ` · Highlightly: ${esc(p.apiName)}` : ''}</p>
          <div><button class="btn" type="button" data-action="edit-name" data-id="${p.id}" data-api="${esc(p.apiName)}" data-full="${esc((p.profile && p.profile.fullName) || '')}" data-short="${esc((p.profile && p.profile.shortName) || '')}" data-photo="${esc((p.profile && p.profile.photoUrl) || '')}">Naam en foto</button></div>
          <div class="tiles">${tiles.map(([v, l, sub]) => `<div class="tile"><span class="tile__num">${v}</span><span class="tile__label">${l}</span>${sub ? `<span class="tile__sub muted">${sub}</span>` : ''}</div>`).join('')}</div>
        </section>
        ${profileBlock(p.profile, p.id)}
        ${valueBlock(p.profile || {}, p.id)}
        ${injuryBlock(p.profile || {}, p.id)}
        ${transfersBlock(p.profile, p.id)}
        ${facts.length ? `<section class="section"><div class="section__label"><span>Feitjes</span></div>
          <div class="facts">${facts.map((f) => `<div class="fact"><span>${esc(f)}</span></div>`).join('')}</div></section>` : ''}
        <section class="section">
          <div class="section__label"><span>Wedstrijden</span><span>${p.log.length}</span></div>
          <div class="list">${log.map((l) => {
            const m = l.match;
            const opp = opponentOf(m, TEAM);
            const role = l.started ? `${l.minutes}'` : l.minutes ? `in · ${l.minutes}'` : 'bank';
            const ga = [l.goals ? `${l.goals}G` : '', l.assists ? `${l.assists}A` : ''].filter(Boolean).join(' ');
            return `<a class="list-row log-row" href="#/wedstrijd/${m.id}">
              <span class="match-row__date mono">${esc(dayShort(m.date))}</span>
              <span class="list-row__main"><span class="list-row__title">${isHome(m, TEAM) ? '' : '@ '}${esc(opp ? opp.name : '?')} <span class="result result--${l.result}">${m.score ? `${m.score.home}–${m.score.away}` : ''}</span></span>
                <span class="list-row__sub">${role}${l.captain ? ' · (c)' : ''}</span></span>
              <span class="log-row__end mono">${ga ? `<strong>${ga}</strong>` : ''}
                ${l.red ? '<span class="card card--red"></span>' : l.yellow ? '<span class="card card--yellow"></span>' : ''}
                <span class="${l.rating >= 7 ? 'accent-text' : 'muted'}">${l.rating == null ? '' : l.rating.toFixed(1)}</span></span>
            </a>`;
          }).join('')}</div>
        </section>`;
    },
  },
};
