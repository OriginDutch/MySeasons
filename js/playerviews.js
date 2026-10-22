// Selectie en spelerspagina's.

import { esc, toast } from './ui.js';
import { savePlayer, deletePlayer, savePlayersBatch, getAllMatches, attachDetails } from './store.js';
import { addMessageOnce } from './inbox.js';
import { similarNames, normName, siteSnapshot, compareSquad, siteBlock, ignoredKeys, ignoreKey } from './squadsite.js';
import { clubField, clubCrest, knownTeams, matchTeam } from './clubpick.js';
import { autoShort } from './names.js';
import { openSheet } from './editor.js';
import { MAIN_CLUB } from './config.js';
import { seasonLabel, isCurrentSeason, getSeason } from './seasonstate.js';
import { statusIn, seasonWindow, spells } from './membership.js';
import { flag, nationalities, countryCode, NAT_TOP, NAT_ALL } from './flags.js';
import { COST, missingDetails, fetchMany } from './sync.js';
import { buildSquad, playerFacts, LINES, LINE_SHORT } from './players.js';
import { disciplineState, attachDiscTags, discTagsHtml, disciplineBlock, mountDiscipline } from './discview.js';
import { correctedList, runWithButton, explain, head, crest } from './matchviews.js';
import { dayShort, opponentOf, isHome } from './season.js';
import { valueBlock, injuryBlock, mountExtra, injuryLabel, euro } from './playerextra.js';
import { currentSquad } from './importer.js';
import { shirtFor, latestShirt, seasonOfDate, shirtsOf, levelFor, levelsOf } from './shirts.js';
import { loadPhotos, heroImg, galleryHtml, mountPhotos, shownThumb, linkBanner } from './photos.js';

let CUR_PH = null; // foto's van de geopende spelerspagina

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
        : '<p class="muted" style="font-size:var(--fs-md)">Nog geen transfers. Zonder transfers telt alleen het wedstrijdformulier.</p>'}
      <div><button class="btn btn--sm" type="button" data-add-transfer data-pid="${esc(String(id))}">+ Transfer toevoegen</button></div>
    </section>`;
}

async function editTransfer(ctx, id, index, profiles, preset = {}) {
  const pr = profiles[String(id)] || {};
  const all = (pr.transfers || []).slice();
  const t = index != null ? all[index] : { type: preset.type || 'transfer-uit', date: new Date().toISOString().slice(0, 10) };
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

/** Foto-link met voorbeeld, zodat je meteen ziet of de link een afbeelding is. */
function photoField(value) {
  return `<label class="field"><span>Foto-link</span><input name="photo" type="url" inputmode="url" autocomplete="off" placeholder="https://… (link naar de afbeelding zelf)" value="${esc(value)}" data-photo-input></label>
    <div class="photo-preview" data-photo-preview ${value ? '' : 'hidden'}><img alt="" referrerpolicy="no-referrer"${value ? ` src="${esc(value)}"` : ''}><span class="muted" data-photo-msg></span></div>`;
}
document.addEventListener('input', (e) => {
  const inp = e.target.closest && e.target.closest('[data-photo-input]');
  if (!inp) return;
  const box = inp.closest('form').querySelector('[data-photo-preview]');
  const url = inp.value.trim();
  box.hidden = !/^https:\/\/\S+$/.test(url);
  if (box.hidden) return;
  const img = box.querySelector('img'); const msg = box.querySelector('[data-photo-msg]');
  msg.textContent = 'Laden…'; img.hidden = false;
  img.onload = () => { msg.textContent = 'Werkt.'; };
  img.onerror = () => { img.hidden = true; msg.textContent = 'Deze link laadt geen afbeelding. Gebruik "Afbeeldingsadres kopiëren", niet de link van de pagina. Sommige sites blokkeren gebruik buiten hun site.'; };
  img.src = url;
});

// ---------- Speler zelf toevoegen (bijv. een oude selectie klaarzetten) ----------
async function knownPeople(profiles) {
  const out = []; const seen = new Set();
  const squad = await currentSquad().catch(() => []);
  squad.forEach((p) => { seen.add(String(p.id)); out.push({ id: String(p.id), name: p.name, where: 'Highlightly' }); });
  Object.entries(profiles || {}).forEach(([id, pr]) => {
    if (seen.has(id) || pr.linkedTo) return;
    const name = pr.fullName || pr.legacyName || pr.apiName; if (name) out.push({ id, name, where: 'archief' });
  });
  return out;
}

async function addPlayer(ctx, pre = {}) {
  const { profiles } = await correctedList();
  const known = await knownPeople(profiles);
  const start = `${getSeason()}-07-01`;
  const sheet = openSheet({
    title: 'Speler toevoegen',
    body: `<label class="field"><span>Naam</span><input name="name" maxlength="60" autocomplete="off" required placeholder="Voor- en achternaam" value="${esc(pre.name || '')}"></label>
      <label class="field"><span>Selectie</span><select name="level"><option value="first" ${pre.level === 'o21' ? '' : 'selected'}>Eerste elftal</option><option value="o21" ${pre.level === 'o21' ? 'selected' : ''}>O21 / jeugd</option></select></label>
      <p class="muted sheet__note">O21 geldt vanaf het seizoen van de datum hieronder, en ook voor de seizoenen erna, tot je hem op zijn pagina naar het eerste zet of een transfer "Doorgestroomd uit de jeugd" toevoegt.</p>
      <div data-dup class="sheet__note" hidden></div>
      <div class="field-row"><label class="field"><span>Positie</span><select name="position">${POS_OPTS.map(([v, l]) => `<option value="${v}" ${pre.position === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Rugnummer</span><input name="shirt" type="number" inputmode="numeric" min="1" max="99" value="${pre.shirt ?? ''}"></label></div>
      <div class="field-row"><label class="field"><span>Nationaliteit</span>${natSelect('nat1', '', false)}</label>
      <label class="field"><span>Geboortedatum</span><input name="dob" type="date"></label></div>
      <div class="field-row"><label class="field"><span>Hoe kwam hij</span><select name="type">${T_TYPES.filter(([v]) => ['transfer-in', 'huur-in', 'promotie'].includes(v)).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <label class="field"><span>Datum</span><input name="date" type="date" value="${esc(start)}"></label></div>
      <div class="field-row"><label class="field"><span>Tot (bij huur)</span><input name="dateTo" type="date"></label>
      <label class="field"><span>Bedrag (€)</span><input name="amount" type="number" inputmode="numeric" min="0" step="1000" placeholder="leeg = onbekend"></label></div>
      ${clubField('club', 'Van club', {})}
      <label class="field"><span>Notitie bij de transfer</span><input name="tnote" maxlength="120" placeholder="bijv. Vrije transfer"></label>
      ${photoField('')}
      <p class="muted sheet__note">Hij staat dan in de selectie van elk seizoen vanaf die datum. Vertrek, waarde en contract zet je daarna op zijn spelerspagina. Komt hij later in een Highlightly-opstelling voor, dan koppel je hem daar.</p>`,
    validate: (fd) => {
      if (!String(fd.get('name') || '').trim()) return 'Vul een naam in.';
      if (!fd.get('date')) return 'Vul de datum in waarop hij kwam.';
      if (fd.get('dateTo') && fd.get('dateTo') < fd.get('date')) return '"Tot" ligt vóór de datum.';
      if (fd.get('photo') && !/^https:\/\/\S+$/.test(String(fd.get('photo')).trim())) return 'De foto-link moet met https:// beginnen.';
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
    fullName: String(data.get('name')).trim(), position: data.get('position') || null, shirts: shirt != null ? { [seasonOfDate(data.get('date'))]: shirt } : null,
    nationality: data.get('nat1') || null, dob: data.get('dob') || null, manual: true, linkedTo: null,
    photoUrl: String(data.get('photo') || '').trim() || null,
    levels: data.get('level') === 'o21' ? { [seasonOfDate(data.get('date'))]: 'o21' } : null,
    transfers: [{ type: data.get('type'), date: data.get('date'), dateTo: data.get('dateTo') || null, club, clubId: clubId && !Number.isNaN(Number(clubId)) ? Number(clubId) : clubId, clubLogo: clubId ? clubLogo : null, amount: data.get('amount') === '' || data.get('amount') == null ? null : Number(data.get('amount')), note: String(data.get('tnote') || '').trim() || null }],
  };
  try {
    await savePlayer(id, prof);
    toast(`${prof.fullName} toegevoegd`, { action: 'Bekijken', onAction: () => { location.hash = `#/speler/${encodeURIComponent(id)}`; } });
    ctx.refresh();
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); }
}

async function siteFix(ctx, d, act) {
  if (!d) return;
  const { profiles } = await correctedList();
  const pr = profiles[d.id] || {};
  const y = getSeason();
  try {
    if (act === 'open') { location.hash = `#/speler/${encodeURIComponent(d.id)}`; return; }
    if (act === 'out' || act === 'loan') { await editTransfer(ctx, d.id, null, profiles, { type: act === 'out' ? 'transfer-uit' : 'huur-uit' }); return; }
    if (d.kind === 'missing') { await addPlayer(ctx, { name: d.site.name, shirt: d.site.number, position: d.site.line, level: d.site.level }); return; }
    if (d.kind === 'number') await savePlayer(d.id, { shirts: { ...(pr.shirts || shirtsOf(pr)), [y]: d.site }, shirt: null });
    else if (d.kind === 'to-o21' || d.kind === 'to-first') await savePlayer(d.id, { levels: { ...(pr.levels || levelsOf(pr)), [y]: d.kind === 'to-o21' ? 'o21' : 'first' }, squadLevel: null });
    else if (d.kind === 'line') await savePlayer(d.id, { position: d.site });
    else if (d.kind === 'fill') await savePlayer(d.id, { ...d.fill });
    else if (d.kind === 'dob') await savePlayer(d.id, { dob: d.site });
    else if (d.kind === 'nat') await savePlayer(d.id, { nationality: d.site });
    toast(`${d.name}: overgenomen`); ctx.refresh();
  } catch (err) { toast(`Lukte niet: ${err.message || err}`); }
}

async function removePlayer(ctx, id) {
  if (!String(id).startsWith('legacy-')) return; // Highlightly-spelers komen uit de opstellingen, die verwijderen we niet
  const { profiles } = await correctedList();
  const pr = profiles[String(id)]; if (!pr) return;
  const name = pr.fullName || pr.legacyName || pr.apiName || 'deze speler';
  const ok = await openSheet({
    title: 'Speler verwijderen',
    body: `<p>${esc(name)} en alles wat je bij hem invulde (profiel, transfers, waarde, blessures) verdwijnt uit je archief.</p><p class="muted sheet__note">Je krijgt een paar seconden om het ongedaan te maken. Daarna staat hij alleen nog in je back-ups.</p>`,
    submitLabel: 'Verwijderen',
  });
  if (!ok) return;
  try {
    await deletePlayer(id);
    location.hash = '#/archief';
    toast(`${name} verwijderd`, { action: 'Ongedaan maken', duration: 8000, onAction: async () => { await savePlayer(id, pr); location.hash = `#/speler/${encodeURIComponent(id)}`; } });
  } catch (err) { toast(`Verwijderen lukte niet: ${err.message || err}`); }
}

/** Handmatige of oude speler koppelen aan een Highlightly-speler: zijn gegevens gaan mee, bestaande blijven staan. */
async function linkPlayer(ctx, id) {
  const { profiles } = await correctedList();
  const pr = profiles[String(id)] || {};
  const squad = await currentSquad().catch(() => []);
  if (!squad.length) { toast('Nog geen Highlightly-spelers: haal eerst wedstrijddetails op.'); return; }
  const sugg = similarNames(pr.fullName || pr.legacyName || pr.apiName, squad.map((p) => ({ id: String(p.id), name: p.name })))[0];
  const data = await openSheet({
    title: 'Koppelen aan Highlightly',
    body: `<label class="field"><span>Speler</span><select name="to"><option value="">Kies…</option>${squad.map((p) => `<option value="${p.id}" ${sugg && sugg.id === String(p.id) ? 'selected' : ''}>${esc(p.name)}${p.number != null ? ' #' + p.number : ''} · ${p.seasons.map((y) => `${y}`.slice(2)).join(', ')}</option>`).join('')}</select></label>
      <p class="muted sheet__note">Naam, profiel, transfers, waarde en blessures gaan naar die speler. Wat daar al ingevuld is, blijft staan; transfers worden samengevoegd.</p>`,
    validate: (fd) => (fd.get('to') ? null : 'Kies een speler.'),
    submitLabel: 'Koppelen',
  });
  if (!data) return;
  const to = String(data.get('to'));
  try {
    await mergeInto(id, to, profiles);
    toast('Gekoppeld');
    location.hash = `#/speler/${encodeURIComponent(to)}`;
  } catch (err) { toast(`Koppelen lukte niet: ${err.message || err}`); }
}

/** Oud/eigen profiel `id` samenvoegen met Highlightly-speler `to`: lege velden aanvullen, lijsten samenvoegen, id → linkedTo. */
async function mergeInto(id, to, profiles, { name = null } = {}) {
  const pr = profiles[String(id)] || {};
  const target = profiles[String(to)] || {};
  const merged = {};
  ['fullName', 'shortName', 'photoUrl', 'position', 'nationality', 'dob', 'foot', 'height', 'joined', 'contractUntil', 'note', 'legacyId', 'legacyName'].forEach((k) => {
    if (pr[k] != null && pr[k] !== '' && (target[k] == null || target[k] === '')) merged[k] = pr[k];
  });
  const myShirts = shirtsOf(pr);
  if (Object.keys(myShirts).length) merged.shirts = { ...myShirts, ...shirtsOf(target) };
  const key = (t) => `${t.type}|${t.date}`;
  ['transfers', 'valueHistory', 'injuries'].forEach((k) => {
    if (!(pr[k] || []).length) return;
    const have = new Set((target[k] || []).map((x) => (k === 'transfers' ? key(x) : JSON.stringify(x))));
    merged[k] = [...(target[k] || []), ...pr[k].filter((x) => !have.has(k === 'transfers' ? key(x) : JSON.stringify(x)))];
  });
  if (pr.gallery && !target.gallery) merged.gallery = pr.gallery;
  await savePlayer(to, merged);
  await savePlayer(id, { linkedTo: Number(to), ...(name && !pr.apiName && !pr.fullName && !pr.legacyName ? { apiName: name } : {}) });
}

// ---------- Dubbele spelers: oude profielen die nog niet aan hun Highlightly-speler gekoppeld zijn ----------
/** Voorstellen: { from, name, cands: [{ id, name, seasons, sure }] }. Zeker = zelfde naam, of achternaam + voorletter en de enige kandidaat. */
export async function findDuplicates(profiles) {
  const squad = await currentSquad().catch(() => []);
  const hl = squad.map((p) => ({ id: String(p.id), name: p.name, alt: p.apiName, seasons: p.seasons, number: p.number }));
  const taken = new Set(Object.values(profiles).map((pr) => pr && pr.linkedTo && String(pr.linkedTo)).filter(Boolean));
  const out = [];
  Object.entries(profiles).forEach(([id, pr]) => {
    if (!pr || pr.linkedTo || /^\d+$/.test(id)) return; // al gekoppeld, of zelf een Highlightly-speler
    const name = pr.fullName || pr.legacyName || pr.apiName;
    if (!name) return;
    const hits = new Map();
    [...similarNames(name, hl), ...similarNames(name, hl.filter((h) => h.alt).map((h) => ({ ...h, name: h.alt })))].forEach((h) => hits.set(h.id, hl.find((x) => x.id === h.id)));
    const cands = [...hits.values()];
    if (!cands.length) return;
    const exact = (h) => normName(h.name) === normName(name) || (h.alt && normName(h.alt) === normName(name));
    const lastOf = (x) => normName(x).split(' ').pop();
    const sameLast = (h) => [h.name, h.alt].filter(Boolean).some((x) => lastOf(x) === lastOf(name)); // anders: spelfout-match → twijfel
    out.push({ from: id, name, transfers: pr.transfers || [], cands: cands.map((h) => ({ ...h, sure: exact(h) || (cands.length === 1 && sameLast(h)), taken: taken.has(h.id) })) });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

/**
 * Twee Highlightly-id's voor één speler: lijkende naam én (zelfde rugnummer in een gedeeld seizoen of precies dezelfde
 * naam), en nooit samen in één wedstrijd. Voorstel wie blijft: met profiel/foto, anders de meeste duels.
 */
export async function findHlDuplicates(profiles) {
  const squad = await currentSquad().catch(() => []);
  const info = squad.map((p) => ({
    id: String(p.id), name: p.name, alt: p.apiName, apps: p.apps || 0, seasons: p.seasons || [],
    nums: new Set([...(p.numbers || []), ...(p.lineupNumber != null ? [p.lineupNumber] : [])]),
    games: new Set((p.log || []).map((l) => String(l.match.id))),
    rich: (() => { const pr = profiles[String(p.id)] || {}; return (pr.gallery && pr.gallery.main ? 4 : 0) + (pr.photoUrl ? 2 : 0) + (pr.fullName || pr.legacyId ? 2 : 0) + (pr.transfers && pr.transfers.length ? 1 : 0); })(),
  }));
  const pairs = []; const used = new Set();
  info.forEach((a, i) => info.slice(i + 1).forEach((b) => {
    if (used.has(a.id) || used.has(b.id)) return;
    const names = (x) => [x.name, x.alt].filter(Boolean);
    const similar = names(a).some((n) => similarNames(n, names(b).map((m) => ({ id: b.id, name: m }))).length);
    if (!similar) return;
    const sameName = names(a).some((n) => names(b).some((m) => normName(n) === normName(m)));
    const sameNum = [...a.nums].some((n) => b.nums.has(n)) && a.seasons.some((y) => b.seasons.includes(y));
    const together = [...a.games].some((g) => b.games.has(g));
    if (together || !(sameName || sameNum)) return;
    const [keep, drop] = (b.rich - a.rich || b.apps - a.apps || (b.name || '').length - (a.name || '').length) > 0 ? [b, a] : [a, b];
    pairs.push({ keep, drop, why: sameName && sameNum ? 'zelfde naam en rugnummer' : sameName ? 'zelfde naam' : `zelfde rugnummer (${[...a.nums].find((n) => b.nums.has(n))})` });
    used.add(a.id); used.add(b.id);
  }));
  return pairs.sort((x, y) => x.keep.name.localeCompare(y.keep.name, 'nl'));
}

function mountTransfers(root, ctx) {
  root.addEventListener('click', async (e) => {
    const addP = e.target.closest('[data-add-player]');
    if (addP) { addPlayer(ctx); return; }
    const all = e.target.closest('[data-sq-fillall]');
    if (all) {
      const fills = [...SITE_DIFFS.values()].filter((d) => d.kind === 'fill');
      all.disabled = true;
      try { await savePlayersBatch(fills.map((d) => [d.id, { ...d.fill }])); toast(`${fills.length} profielen aangevuld`); ctx.refresh(); } catch (err) { toast(`Lukte niet: ${err.message || err}`); all.disabled = false; }
      return;
    }
    const fix = e.target.closest('[data-sq-fix]');
    if (fix) {
      if (fix.dataset.sqAct === 'ignore') { await ignoreKey(fix.dataset.sqFix); toast('Verborgen'); ctx.refresh(); return; }
      await siteFix(ctx, SITE_DIFFS.get(fix.dataset.sqFix), fix.dataset.sqAct); return;
    }
    const del = e.target.closest('[data-delete-player]');
    if (del) { removePlayer(ctx, del.dataset.deletePlayer); return; }
    const pro = e.target.closest('[data-promote]');
    if (pro) {
      const { profiles } = await correctedList(); const pr = profiles[pro.dataset.promote] || {};
      await savePlayer(pro.dataset.promote, { levels: { ...(pr.levels || levelsOf(pr)), [getSeason()]: 'first' }, squadLevel: null });
      toast('Naar het eerste elftal'); ctx.refresh(); return;
    }
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
      <p class="muted" style="font-size:var(--fs-md)">Nog geen profiel: nationaliteit, geboortedatum, voet, lengte, contract en een notitie vul je zelf in.</p>${editBtn}</section>`;
  }
  return `
    <section class="section">
      <div class="section__label"><span>Profiel</span><span>${pr.legacyId ? 'uit je oude tracker' : ''}</span></div>
      <div class="profile">
        <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd${k === 'Notitie' ? ' class="kv-note"' : ''}>${k === 'Nationaliteit' ? v : esc(v)}</dd>`).join('')}</dl>
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
      <label class="field"><span>Rugnummer in ${esc(seasonLabel())}</span><input name="shirt" type="number" inputmode="numeric" min="1" max="99" placeholder="uit de opstellingen" value="${shirtFor(pr, getSeason()) ?? ''}"></label></div>
      <div class="field-row"><label class="field"><span>Positie</span><select name="position">${POS_OPTS.map(([v, l]) => `<option value="${v}" ${(pr.position || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Voet</span><select name="foot">${FOOT_OPTS.map((f) => `<option value="${f}" ${(pr.foot || '') === f ? 'selected' : ''}>${f || '—'}</option>`).join('')}</select></label></div>
      <div class="field-row"><label class="field"><span>Lengte (cm)</span><input name="height" type="number" inputmode="numeric" min="140" max="220" value="${pr.height ?? ''}"></label>
      <label class="field"><span>Contract tot</span><input name="contract" type="date" value="${esc(pr.contractUntil || '')}"></label></div>
      <label class="field"><span>Selectie in ${esc(seasonLabel())}</span><select name="level"><option value="first" ${levelFor(pr, getSeason()) === 'first' ? 'selected' : ''}>Eerste elftal</option><option value="o21" ${levelFor(pr, getSeason()) === 'o21' ? 'selected' : ''}>O21</option></select></label>
      <label class="field"><span>Notitie</span><textarea name="note" rows="3" maxlength="500" placeholder="bijv. Clubopties +1 jaar">${esc(pr.note || '')}</textarea></label>
      <p class="muted sheet__note">Het rugnummer geldt alleen voor ${esc(seasonLabel())}; leeg = het nummer uit de opstellingen. Ander seizoen? Kies dat eerst via de clubnaam op Home.</p>`,
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
    shirts: { ...(pr.shirts || shirtsOf(pr)), [getSeason()]: data.get('shirt') ? Number(data.get('shirt')) : null },
    shirt: null,
    position: data.get('position') || null,
    foot: data.get('foot') || null,
    height: data.get('height') ? Number(data.get('height')) : null,
    contractUntil: data.get('contract') || null,
    note: String(data.get('note') || '').trim() || null,
  };
  if (data.get('level') !== levelFor(pr, getSeason())) { next.levels = { ...(pr.levels || levelsOf(pr)), [getSeason()]: data.get('level') }; next.squadLevel = null; }
  const before = Object.fromEntries(Object.keys(next).map((k) => [k, pr[k] ?? null]));
  before.shirts = { ...(pr.shirts || {}), [getSeason()]: (pr.shirts || {})[getSeason()] ?? null }; // merge-veilig terugzetten
  if (next.levels && pr.levels) before.levels = { ...pr.levels, [getSeason()]: pr.levels[getSeason()] ?? null };
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
  const photo = shownThumb(p.profile && p.profile.gallery, getSeason()) || p.photo || (p.profile && p.profile.photoUrl);
  const ini = esc(initials(p.name));
  return `<span class="avatar">${photo ? photoImg(photo, 'avatar__img', ini) : `<span class="avatar__ini">${ini}</span>`}${p.number != null ? `<span class="avatar__num mono">${p.number}</span>` : ''}</span>`;
}

/** Twee spelers in de huidige selectie met hetzelfde rugnummer: waarschuwen (archief maakt niet uit). */
const PROMOTE_AT = 5;
let SITE_DIFFS = new Map(); // laatste vergelijking met de clubsite, voor de knoppen

function markDuplicateNumbers(players) {
  const byNr = new Map();
  players.forEach((p) => { p.dupWith = null; if (p.number != null) byNr.set(p.number, [...(byNr.get(p.number) || []), p]); });
  byNr.forEach((ps) => { if (ps.length > 1) ps.forEach((p) => { p.dupWith = ps.filter((x) => x !== p).map((x) => x.name); }); });
}
const conflictTag = (p) => (!p.conflict ? '' : p.conflict === 'early'
  ? '<span class="ptag ptag--warn" title="Hij stond al op een wedstrijdformulier vóór zijn eerste transfer. Vul een eerdere komst in (bijv. vanuit de jeugd), of zet de datum goed.">⚠ volgens transfers nog niet bij de club</span>'
  : '<span class="ptag ptag--warn" title="Hij stond nog op een wedstrijdformulier na zijn vertrek volgens je transfers.">⚠ volgens transfers al weg</span>');
const dupTag = (p) => (p.dupWith && p.dupWith.length ? `<span class="ptag ptag--warn" title="Pas het nummer aan op de spelerspagina als het niet klopt">⚠ nr. ${esc(String(p.number))} ook: ${esc(p.dupWith.join(', '))}</span>` : '');
const fmtLabel = (l) => l.replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => new Date(`${y}-${m}-${d}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: y === String(new Date().getFullYear()) ? undefined : 'numeric' }));

function rowHtml(p, sort) {
  const base = p.apps
    ? `${p.apps} ${p.apps === 1 ? 'duel' : 'duels'}${p.subIns ? ` (${p.subIns} in)` : ''} · ${p.minutes}'`
    : p.squads ? `${p.squads}× op de bank` : 'nog geen officieel duel';
  const tags = (p.labels || []).map((l) => `<span class="ptag ${l.startsWith('geblesseerd') ? 'ptag--inj' : ''}">${esc(fmtLabel(l))}</span>`).join('') + conflictTag(p) + dupTag(p) + discTagsHtml(p.discTags) + (p.status === 'youth' && p.apps ? `<span class="ptag ptag--o21">speelde mee in het eerste${p.apps > 1 ? ` · ${p.apps}×` : ''}</span>` : '');
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
    const tags = (p.labels || []).map((l) => `<span class="ptag ${l.startsWith('geblesseerd') ? 'ptag--inj' : ''}">${esc(fmtLabel(l))}</span>`).join('') + conflictTag(p) + dupTag(p) + discTagsHtml(p.discTags) + (p.status === 'youth' && p.apps ? `<span class="ptag ptag--o21">speelde mee in het eerste${p.apps > 1 ? ` · ${p.apps}×` : ''}</span>` : '');
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
      ${sort === 'rating' ? '<p class="muted" style="font-size:var(--fs-sm)">Spelers met minder dan 3 beoordeelde duels staan onderaan.</p>' : ''}</section>`;
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
    const lvl = levelFor(p.profile || profiles[String(p.id)], getSeason());
    members.push({ ...p, status: lvl === 'o21' && (st.status || 'active') === 'active' ? 'youth' : (st.status || 'active'), labels: [...(inj ? [inj] : []), ...(st.labels || [])], conflict: st.conflict || false, injured: !!inj });
  });
  Object.entries(profiles || {}).forEach(([id, pr]) => {
    if (seen.has(id) || pr.linkedTo) return; // gekoppelde oud-profielen staan al onder hun Highlightly-id
    if (!pr.legacyId && !pr.transfers) return; // alleen een naamkeuze, geen periode
    const st = statusIn(pr, win, ref);
    if (!st.member) return;
    members.push({
      id, name: profName(pr) || '?', number: shirtFor(pr, getSeason()) ?? latestShirt(pr, getSeason()), position: pr.position || '',
      photo: shownThumb(pr.gallery, getSeason()) || pr.photoUrl || null, nationality: pr.nationality || null,
      apps: 0, subIns: 0, minutes: 0, squads: 0, goals: 0, assists: 0, rating: null, rated: 0, log: [],
      status: levelFor(pr, getSeason()) === 'o21' && st.status === 'active' ? 'youth' : st.status, labels: [...(injuryLabel(pr, ref, isCurrentSeason()) ? [injuryLabel(pr, ref, isCurrentSeason())] : []), ...(st.labels || [])], conflict: false, profileOnly: true,
      injured: !!injuryLabel(pr, ref, isCurrentSeason()),
    });
  });
  const groups = { active: [], youth: [], left: [], loaned: [], future: [] };
  members.forEach((m) => (groups[m.status] || groups.active).push(m));
  return { members, groups };
}

/** Naam uit het profiel: jouw naam, de oude tracker, of de Highlightly-naam die we eerder vonden. */
const profName = (pr) => (pr && (pr.fullName || pr.legacyName || pr.apiName)) || null;

/**
 * Profielen zonder naam (bijv. alleen een rugnummer of transfer ingevuld): zoek de naam op in alle
 * opgehaalde wedstrijden (opstellingen en events) en zet hem eenmalig als apiName in het profiel.
 * Vult alleen een leeg veld; fullName/legacyName blijven onaangeraakt. Muteert profiles voor deze render.
 */
let namesTried = false; // hooguit eens per sessie alle details doorzoeken
async function backfillNames(profiles) {
  if (namesTried) return 0;
  const missing = Object.entries(profiles || {}).filter(([id, pr]) => pr && !profName(pr) && !String(id).startsWith('legacy-'));
  if (!missing.length) return 0;
  namesTried = true;
  const names = new Map();
  const put = (id, n) => { if (id != null && n && !names.has(String(id))) names.set(String(id), String(n)); };
  (await getAllMatches().then(attachDetails).catch(() => [])).forEach((m) => {
    const d = m.detail; if (!d) return;
    Object.values(d.players || {}).forEach((side) => (side || []).forEach((pl) => put(pl.id, pl.name)));
    (d.events || []).forEach((e) => { put(e.playerId, e.player); put(e.inId, e.inName); put(e.outId, e.outName); });
  });
  const writes = missing.filter(([id]) => names.has(String(id))).map(([id]) => [id, { apiName: names.get(String(id)) }]);
  if (!writes.length) return 0;
  await savePlayersBatch(writes).catch(() => {});
  writes.forEach(([id, d]) => { profiles[id].apiName = d.apiName; });
  return writes.length;
}

function periodText(pr) {
  const { spells: sp } = spells(pr);
  if (!sp.length) return null;
  const y = (d) => (d ? d.slice(0, 4) : '…');
  return sp.map((s) => `${y(s.from)}–${s.to ? y(s.to) : 'nu'}${s.kind === 'huur' ? ' (huur)' : s.kind === 'jeugd' ? ' (jeugd)' : ''}`).join(', ');
}

/** Spelerspagina zonder Highlightly-stats dit seizoen: alleen het profiel uit je archief. */
async function profileOnlyPage(pr, id) {
  CUR_PH = await loadPhotos('player', id, pr.gallery, { linkUrl: pr.photoUrl, linkCheck: pr.photoLinkCheck });
  const name = profName(pr) || '?';
  const per = periodText(pr);
  return `
    ${head({ kicker: `Archief · ${LINE_SHORT[pr.position] || '—'}`, title: name, back: 'selectie' })}
    <section class="section">
      <div class="player-hero">${heroImg(CUR_PH.photos, pr.gallery, getSeason(), null) || (pr.photoUrl ? photoImg(pr.photoUrl, 'player-hero__photo', '') : '')}<span class="player-hero__num">${shirtFor(pr, getSeason()) ?? latestShirt(pr) ?? '–'}</span><span class="muted">${esc(LINE_SHORT[pr.position] || '')}${per ? ' · ' + esc(per) : ''}</span></div>
      <div class="btn-row"><button class="btn btn--sm" type="button" data-action="edit-name" data-id="${esc(id)}" data-api="${esc(pr.apiName || '')}" data-full="${esc(pr.fullName || '')}" data-short="${esc(pr.shortName || '')}" data-photo="${esc(pr.photoUrl || '')}">Naam en foto-link</button><button class="btn btn--sm" type="button" data-photo-add>Foto toevoegen</button></div>
      <p class="muted" style="font-size:var(--fs-md);margin:0">${pr.linkedTo === null || String(id).startsWith('legacy-')
        ? 'Nog niet gekoppeld aan Highlightly. Stats verschijnen zodra hij in een opgehaald seizoen voorkomt en je hem hieronder koppelt.'
        : 'Geen officiële duels in dit seizoen. Kies een ander seizoen via de clubnaam op Home.'}</p>
      ${pr.linkedTo == null ? `<div><button class="btn btn--sm" type="button" data-link-player="${esc(id)}">Koppelen aan Highlightly-speler</button></div>` : ''}
    </section>
    ${linkBanner(CUR_PH)}
    ${galleryHtml(CUR_PH.photos, pr.gallery, { linkUrl: pr.photoUrl })}
    ${profileBlock(pr, id)}
    ${valueBlock(pr, id)}
    ${injuryBlock(pr, id)}
    ${transfersBlock(pr, id)}
    ${String(id).startsWith('legacy-') ? `<section class="section"><button class="btn btn--sm btn--danger" type="button" data-delete-player="${esc(id)}">Speler verwijderen</button></section>` : ''}`;
}

export const playerViews = {
  dubbelen: {
    title: 'Dubbele spelers',
    navKey: 'selectie',
    async render() {
      const { profiles } = await correctedList();
      const [list, hlPairs] = await Promise.all([findDuplicates(profiles), findHlDuplicates(profiles)]);
      this._list = list; this._hl = hlPairs;
      const per = (t) => { const ys = (t || []).map((x) => String(x.date || '').slice(0, 4)).filter(Boolean).sort(); return ys.length ? `${ys[0]}–${ys[ys.length - 1]}` : ''; };
      return `${head({ kicker: 'Selectie', title: 'Dubbele spelers', back: 'selectie' })}
        ${hlPairs.length ? `<section class="section"><div class="section__label"><span>Twee Highlightly-id's voor één speler</span><span>${hlPairs.length}</span></div>
          <p class="muted" style="font-size:var(--fs-md)">Highlightly gebruikt soms twee id's voor dezelfde speler (bijv. "J. Nap" en "Jochem Nap"). Samenvoegen: alle duels, goals en kaarten van het ene id tellen voor de speler die je houdt. De ruwe data blijft onaangeraakt; ontkoppelen kan op de spelerspagina.</p>
          <div class="list">${hlPairs.map((pr, i) => `<div class="list-row dup-row dup-row--hl">
            <input type="checkbox" data-hl="${i}" checked aria-label="Samenvoegen">
            <span class="list-row__main"><span class="list-row__sub">${esc(pr.why)} · nooit samen in één duel</span>
              ${[pr.keep, pr.drop].map((x, k) => `<label class="dup-keep"><input type="radio" name="hlkeep${i}" value="${k}" ${k === 0 ? 'checked' : ''}> <span>${esc(x.name)} <span class="muted">· ${x.apps} ${x.apps === 1 ? 'duel' : 'duels'} · ${x.seasons.map((y) => `'${String(y).slice(2)}`).join(' ')}${x.rich ? ' · profiel' : ''}</span></span></label>`).join('')}
              <span class="list-row__sub muted">De aangevinkte blijft; de ander wordt een alias.</span></span>
          </div>`).join('')}</div>
          <div><button class="btn btn--primary" type="button" data-hl-go>Samenvoegen</button></div></section>` : ''}
        <section class="section"><p class="muted" style="font-size:var(--fs-md)">${list.length ? `${list.length} spelers uit je oude tracker lijken op een speler uit Highlightly. Samenvoegen = het oude profiel (transfers, rugnummers, waarde, blessures, foto's) gaat naar de Highlightly-speler; wat daar al staat blijft staan. Het oude profiel verdwijnt uit de lijsten maar blijft bewaard (gekoppeld).` : hlPairs.length ? 'Geen oude profielen die nog gekoppeld moeten worden.' : 'Geen dubbele spelers gevonden.'}</p>
          ${list.length ? '<label class="field field--check"><input type="checkbox" data-dup-all> <span>Alles aan/uit</span></label>' : ''}</section>
        ${list.length ? `<section class="section"><div class="list">${list.map((d, i) => {
          const best = d.cands.find((c) => c.sure && !c.taken) || null;
          return `<div class="list-row dup-row">
            <input type="checkbox" data-dup="${i}" ${best && d.cands.length === 1 ? 'checked' : ''} aria-label="Samenvoegen">
            <span class="list-row__main"><span class="list-row__title">${esc(d.name)}</span>
              <span class="list-row__sub">oud profiel${per(d.transfers) ? ` · ${esc(per(d.transfers))}` : ''} → 
              ${d.cands.length === 1 ? `${esc(d.cands[0].name)}${d.cands[0].number != null ? ` #${d.cands[0].number}` : ''} · ${d.cands[0].seasons.map((y) => `'${String(y).slice(2)}`).join(' ')}${d.cands[0].taken ? ' <span class="ptag ptag--warn">al gekoppeld aan een ander profiel</span>' : ''}${d.cands[0].sure ? '' : ' <span class="ptag ptag--warn">twijfel</span>'}`
                : `<select data-dup-to="${i}"><option value="">kies…</option>${d.cands.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.number != null ? ` #${c.number}` : ''} · ${c.seasons.map((y) => `'${String(y).slice(2)}`).join(' ')}</option>`).join('')}</select>`}</span></span>
          </div>`;
        }).join('')}</div>
          <div><button class="btn btn--primary" type="button" data-dup-go>Samenvoegen</button></div>
          <p class="muted" style="font-size:var(--fs-sm);margin:0">Tip: maak eerst een back-up (Meer → Back-up). Twijfelgevallen staan uit; kijk ze even na.</p></section>` : ''}`;
    },
    mount(root, ctx) {
      const view = this;
      root.querySelector('[data-hl-go]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const picks = [...root.querySelectorAll('[data-hl]:checked')].map((c) => {
          const i = Number(c.dataset.hl); const pr = view._hl[i];
          const k = Number((root.querySelector(`input[name="hlkeep${i}"]:checked`) || {}).value || 0);
          return k === 0 ? { keep: pr.keep.id, drop: pr.drop.id, name: pr.drop.alt || pr.drop.name } : { keep: pr.drop.id, drop: pr.keep.id, name: pr.keep.alt || pr.keep.name };
        });
        if (!picks.length) { toast('Niets gekozen'); return; }
        btn.disabled = true; let n = 0;
        try {
          for (const p of picks) {
            btn.textContent = `Bezig… ${n + 1} van ${picks.length}`;
            const { profiles } = await correctedList();
            await mergeInto(p.drop, p.keep, profiles, { name: p.name });
            n++;
          }
          toast(`${n} spelers samengevoegd`); ctx.refresh();
        } catch (err) { toast(`Gestopt na ${n}: ${err.message || err}`); btn.disabled = false; btn.textContent = 'Samenvoegen'; }
      });
      root.querySelector('[data-dup-all]')?.addEventListener('change', (e) => root.querySelectorAll('[data-dup]').forEach((c) => { c.checked = e.target.checked; }));
      root.querySelector('[data-dup-go]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const picks = [...root.querySelectorAll('[data-dup]:checked')].map((c) => {
          const d = view._list[Number(c.dataset.dup)];
          const sel = root.querySelector(`[data-dup-to="${c.dataset.dup}"]`);
          return { from: d.from, to: sel ? sel.value : d.cands[0].id };
        }).filter((x) => x.to);
        if (!picks.length) { toast('Niets gekozen'); return; }
        btn.disabled = true;
        let n = 0;
        try {
          for (const p of picks) {
            btn.textContent = `Bezig… ${n + 1} van ${picks.length}`;
            const { profiles } = await correctedList();
            await mergeInto(p.from, p.to, profiles);
            n++;
          }
          toast(`${n} spelers samengevoegd`);
          ctx.refresh();
        } catch (err) { toast(`Gestopt na ${n}: ${err.message || err}`); btn.disabled = false; btn.textContent = 'Samenvoegen'; }
      });
    },
  },

  archief: {
    title: 'Archief',
    navKey: 'selectie',
    async render() {
      const { profiles } = await correctedList();
      await backfillNames(profiles);
      const today = new Date().toISOString().slice(0, 10);
      const LO = { Goalkeeper: 1, Defender: 2, Midfielder: 3, Forward: 4 };
      const rows = Object.entries(profiles || {})
        .filter(([, pr]) => (pr.legacyId || pr.transfers) && !(pr.linkedTo && profiles[String(pr.linkedTo)]))
        .map(([id, pr]) => {
          const { spells: sp } = spells(pr);
          const to = sp.length ? sp[sp.length - 1].to : null;
          const group = !sp.length ? 'unknown' : !to || to >= today ? 'now' : String(seasonOfDate(to));
          return { id, pr, group, name: profName(pr) || '?' };
        });
      // Groepen: nu bij de club, dan per seizoen van vertrek (nieuwste eerst), onbekend als laatste.
      const keys = [...new Set(rows.map((r) => r.group))].sort((a, b) => (a === 'now' ? -1 : b === 'now' ? 1 : a === 'unknown' ? 1 : b === 'unknown' ? -1 : Number(b) - Number(a)));
      const label = (k) => (k === 'now' ? 'Nu bij de club' : k === 'unknown' ? 'Geen periode bekend' : `Vertrokken in ${k}–${String(Number(k) + 1).slice(2)}`);
      const sortIn = (a, b) => (LO[a.pr.position] || 9) - (LO[b.pr.position] || 9) || a.name.localeCompare(b.name, 'nl');
      const row = (r) => `<a class="list-row player-row" href="#/speler/${encodeURIComponent(r.id)}">
            ${avatar({ name: r.name, photo: shownThumb(r.pr.gallery) || r.pr.photoUrl, number: latestShirt(r.pr) })}
            <span class="list-row__main"><span class="list-row__title">${esc(r.name)}${r.pr.nationality ? `<span class="row-flags">${nationalities(r.pr.nationality).map((n) => flag(n, 12)).join('')}</span>` : ''}</span>
              <span class="list-row__sub">${esc(LINE_SHORT[r.pr.position] || '—')}${periodText(r.pr) ? ' · ' + esc(periodText(r.pr)) : ''}${String(r.id).startsWith('legacy-') ? ' · niet gekoppeld' : ''}</span></span>
            <span></span></a>`;
      return `${head({ kicker: 'Selectie / Archief', title: 'Archief', back: 'selectie' })}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">${rows.length} spelers: wie nu bij de club is, daarna per seizoen waarin ze vertrokken. Binnen een groep op linie.</p>
          <div><button class="btn btn--sm" type="button" data-add-player>+ Speler toevoegen</button></div>
        </section>
        ${keys.map((k) => { const g = rows.filter((r) => r.group === k).sort(sortIn); return `<section class="section">
          <div class="section__label"><span>${esc(label(k))}</span><span>${g.length}</span></div>
          <div class="list">${g.map(row).join('')}</div></section>`; }).join('')}`;
    },
    mount(root, ctx) { mountTransfers(root, ctx); },
  },

  selectie: {
    title: 'Selectie',
    async render() {
      const { list, profiles } = await correctedList();
      await backfillNames(profiles);
      const built = buildSquad(list, TEAM, profiles);
      const { matches } = built;
      const { members, groups } = seasonMembers(list, built.players, profiles);
      const players = groups.active;
      markDuplicateNumbers(players);
      if (isCurrentSeason()) attachDiscTags(Object.values(groups).flat(), await disciplineState(list).catch(() => null));
      let site = '';
      if (isCurrentSeason()) {
        const s = await siteSnapshot();
        if (s && s.snap && (s.pages || []).length) {
          const ign = await ignoredKeys();
          const diffs = compareSquad(s.snap, members, profiles).filter((d) => !ign.has(d.key));
          SITE_DIFFS = new Map(diffs.map((d) => [d.key, d]));
          site = siteBlock(diffs, s.snap);
        }
      }
      if (isCurrentSeason()) groups.youth.filter((p) => !p.profileOnly && p.apps >= PROMOTE_AT).forEach((p) => addMessageOnce({
        id: `promote:${p.id}:${getSeason()}`, kind: 'info', title: `${p.name} speelde ${p.apps} duels in het eerste`,
        text: 'Hij staat bij O21. Doorschuiven naar het eerste elftal?', href: `#/speler/${encodeURIComponent(p.id)}`,
      }).catch(() => {}));
      const kicker = `MySeasons / ${MAIN_CLUB.name} ${seasonLabel()}`;
      if (!members.length) {
        return `${head({ kicker, title: 'Selectie' })}
          ${missingBlock(list) || `<section class="section"><div class="empty"><span class="empty__title">Nog geen spelers</span>
            <p class="muted">De selectie komt uit de opstellingen van gespeelde wedstrijden. Synchroniseer eerst het seizoen op Home.</p>
            <div><a class="btn" href="#/home">Naar Home</a></div></div></section>`}`;
      }
      const hlMembers = members.filter((m) => !m.profileOnly).map((m) => ({ id: String(m.id), name: m.name }));
      const hlOnly = players.filter((p) => !p.profileOnly);
      const hlDup = hlOnly.filter((p) => p.number != null && hlOnly.some((q) => q !== p && q.number === p.number && similarNames(q.name, [{ id: 'x', name: p.name }]).length)).length;
      const dupCount = members.filter((m) => m.profileOnly && similarNames(m.name, hlMembers).length).length + Math.ceil(hlDup / 2);
      const used = members.filter((p) => p.apps).length;
      const extra = [
        ['left', isCurrentSeason() ? 'Vertrokken dit seizoen' : 'Vertrokken tijdens het seizoen'],
        ['youth', 'O21'],
        ['loaned', 'Verhuurd'],
        ['future', 'Komt nog'],
      ].filter(([k]) => groups[k].length);
      return `
        ${head({ kicker, title: 'Selectie' })}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">${players.length} ${isCurrentSeason() ? 'spelers nu bij de club' : 'spelers aan het eind van het seizoen'} · ${used} kwamen in actie in ${matches} officiële ${matches === 1 ? 'duel' : 'duels'}${natFact(players, profiles)}</p>
          <fieldset class="segmented segmented--4" style="margin:0;padding:0">
            <legend class="visually-hidden">Sorteren</legend>
            ${SORTS.map(([v, l], i) => `<input type="radio" name="sq-sort" id="sq-${v}" value="${v}" ${i === 0 ? 'checked' : ''}><label for="sq-${v}">${l}</label>`).join('')}
          </fieldset>
        </section>
        ${missingBlock(list)}
        ${dupCount ? `<section class="section"><a class="warn-line" href="#/dubbelen" style="display:block;text-decoration:none">${dupCount} ${dupCount === 1 ? 'speler staat' : 'spelers staan'} dubbel. Samenvoegen →</a></section>` : ''}
        ${site}
        <div class="mob-only">${SORTS.map(([v], i) => `<div data-sq="${v}" ${i === 0 ? '' : 'hidden'}>${squadList(players, v)}</div>`).join('')}</div>
        <section class="section desk-only-block">
          <div class="sq-tools"><fieldset class="segmented segmented--2 sq-group-toggle" style="margin:0;padding:0"><legend class="visually-hidden">Indeling</legend>
            <input type="radio" name="sq-group" id="sqg-lines" value="lines" ${groupPref() === 'lines' ? 'checked' : ''}><label for="sqg-lines">Per linie</label>
            <input type="radio" name="sq-group" id="sqg-flat" value="flat" ${groupPref() === 'flat' ? 'checked' : ''}><label for="sqg-flat">Eén lijst</label></fieldset></div>
          ${squadTable(players, profiles)}<p class="muted" style="font-size:var(--fs-sm)">Klik op een kolom om te sorteren, nog een keer draait de volgorde om. Duels: tussen haakjes de invalbeurten.</p></section>
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
      mountDiscipline(root, ctx, async () => disciplineState((await correctedList()).list));
      mountPhotos(root, ctx, () => CUR_PH);
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-unalias]');
        if (!b) return;
        b.disabled = true;
        try { await savePlayer(b.dataset.unalias, { linkedTo: null }); toast('Ontkoppeld: dat id telt weer als eigen speler'); ctx.refresh(); } catch (err) { toast(`Lukte niet: ${err.message || err}`); b.disabled = false; }
      });
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action="edit-name"]');
        if (!btn) return;
        const { id, api, full, short, photo } = btn.dataset;
        const data = await openSheet({
          title: 'Naam aanpassen',
          body: `<label class="field"><span>Volledige naam</span><input name="full" maxlength="60" autocomplete="off" placeholder="${esc(api)}" value="${esc(full)}"></label>
            <label class="field"><span>Korte naam (tijdlijn, opstellingen)</span><input name="short" maxlength="30" autocomplete="off" placeholder="${esc(autoShort(full || api))}" value="${esc(short)}"></label>
            ${photoField(photo || '')}
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
      if (!p && prof && /^\d+$/.test(String(prof.linkedTo ?? ''))) { location.replace(`#/speler/${prof.linkedTo}`); return ''; } // alias → hoofdspeler
      if (!p && prof) { await backfillNames({ [rawId]: prof }); return profileOnlyPage(prof, rawId); }
      if (!p) {
        return `${head({ kicker: 'Selectie', title: 'Niet gevonden', back: 'selectie' })}
          <section class="section"><p class="muted">Deze speler staat (nog) niet in een opgehaalde wedstrijd.</p></section>`;
      }
      const gal = p.profile && p.profile.gallery;
      CUR_PH = await loadPhotos('player', p.id, gal, { linkUrl: p.profile && p.profile.photoUrl, linkCheck: p.profile && p.profile.photoLinkCheck });
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
        ${head({ kicker: `Selectie${levelFor(p.profile, getSeason()) === 'o21' ? ' · O21' : ''} · ${LINE_SHORT[p.position] || '—'}`, title: p.name, back: 'selectie' })}
        <section class="section">
          ${levelFor(p.profile, getSeason()) === 'o21' && p.apps >= PROMOTE_AT ? `<div class="promote-line"><span>Staat bij O21, maar speelde ${p.apps} duels in het eerste.</span><button class="btn btn--sm btn--primary" type="button" data-promote="${esc(String(p.id))}">Naar eerste elftal</button></div>` : ''}
          <div class="player-hero">${heroImg(CUR_PH.photos, gal, getSeason(), null) || (p.profile && p.profile.photoUrl ? photoImg(p.profile.photoUrl, 'player-hero__photo', '') : '')}<span class="player-hero__num">${p.number ?? '–'}</span>
            <span class="muted">${esc(LINE_SHORT[p.position] || '')}${p.squads > p.apps ? ` · ${p.squads - p.apps}× op de bank zonder invalbeurt` : ''}</span></div>
          <p class="muted" style="font-size:var(--fs-sm);margin:0">Kort: ${esc(p.short)}${p.profile && (p.profile.fullName || p.profile.shortName) ? ` · Highlightly: ${esc(p.apiName)}` : ''}</p>
          <div class="btn-row"><button class="btn" type="button" data-action="edit-name" data-id="${p.id}" data-api="${esc(p.apiName)}" data-full="${esc((p.profile && p.profile.fullName) || '')}" data-short="${esc((p.profile && p.profile.shortName) || '')}" data-photo="${esc((p.profile && p.profile.photoUrl) || '')}">Naam en foto-link</button><button class="btn" type="button" data-photo-add>Foto toevoegen</button></div>
        </section>
        ${linkBanner(CUR_PH)}
        ${galleryHtml(CUR_PH.photos, gal, { linkUrl: p.profile && p.profile.photoUrl })}
        <section class="section">
          <div class="tiles">${tiles.map(([v, l, sub]) => `<div class="tile"><span class="tile__num">${v}</span><span class="tile__label">${l}</span>${sub ? `<span class="tile__sub muted">${sub}</span>` : ''}</div>`).join('')}</div>
        </section>
        ${(() => {
          const al = Object.entries(profiles).filter(([aid, pr]) => /^\d+$/.test(aid) && pr && String(pr.linkedTo) === String(p.id));
          return al.length ? `<section class="section"><div class="section__label"><span>Ook bekend als</span><span>${al.length}</span></div>
            <div class="list">${al.map(([aid, pr]) => `<div class="list-row"><span class="list-row__main"><span class="list-row__title">${esc(pr.apiName || pr.fullName || `Highlightly-id ${aid}`)}</span>
              <span class="list-row__sub">tweede Highlightly-id (${esc(aid)}), telt mee voor deze speler</span></span>
              <button class="btn btn--sm" type="button" data-unalias="${esc(aid)}">Ontkoppelen</button></div>`).join('')}</div></section>` : '';
        })()}
        ${profileBlock(p.profile, p.id)}
        ${valueBlock(p.profile || {}, p.id)}
        ${injuryBlock(p.profile || {}, p.id)}
        ${disciplineBlock(await disciplineState(list).catch(() => null), p.id)}
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
