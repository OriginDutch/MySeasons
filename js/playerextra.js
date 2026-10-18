// Marktwaarde en blessures per speler: invoeren, aanpassen, verwijderen en tonen.
// Opslag in het spelersprofiel: valueHistory [{ date, amount, note }] (nieuwste eerst),
// injuries [{ type, startDate, expectedReturn, actualReturn, note }].

import { esc, toast } from './ui.js';
import { savePlayer } from './store.js';
import { openSheet } from './editor.js';

export const euro = (v) => (v == null ? '—' : v >= 1e6 ? `€${(v / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} mln` : `€${Math.round(v / 1e3).toLocaleString('nl-NL')}k`);
const dmy = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dm = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
const todayIso = () => new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const weeks = (n) => (n < 14 ? `${n} ${n === 1 ? 'dag' : 'dagen'}` : `${Math.round(n / 7)} weken`);

export const INJURY_TYPES = ['Hamstring', 'Enkel', 'Knie', 'Kruisband', 'Meniscus', 'Lies', 'Kuit', 'Dijbeen', 'Rug', 'Schouder', 'Voet', 'Hersenschudding', 'Spierblessure', 'Ziek', 'Overig'];

/** Waarden oud → nieuw, opgeschoond. */
export function valuesAsc(pr) {
  return ((pr && pr.valueHistory) || []).filter((v) => v && v.date && v.amount != null).slice().sort((a, b) => a.date.localeCompare(b.date));
}

/** Status van één blessure op peildatum ref. */
export function injuryState(inj, ref = todayIso()) {
  const start = inj.startDate;
  if (!start) return { state: 'unknown' };
  const back = inj.actualReturn && inj.actualReturn <= ref ? inj.actualReturn : null;
  if (back) return { state: 'healed', out: days(start, back) };
  if (start > ref) return { state: 'planned' };
  const expected = inj.actualReturn || inj.expectedReturn || null; // terugkeer in de toekomst = verwachting
  return { state: 'out', out: days(start, ref), expected };
}

/** Is de speler geblesseerd op ref? Geeft de blessure + verwachte terugkeer, of null. */
export function injuredOn(pr, ref = todayIso()) {
  const list = ((pr && pr.injuries) || []).map((i) => ({ ...i, ...injuryState(i, ref) })).filter((i) => i.state === 'out');
  return list.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))[0] || null;
}

/** Label voor de selectielijst. */
export function injuryLabel(pr, ref, current) {
  if (current) {
    const i = injuredOn(pr, ref);
    if (!i) return null;
    return `geblesseerd${i.type ? ' · ' + i.type.toLowerCase() : ''}${i.expected ? ` · terug ~${dm(i.expected)}` : ''}`;
  }
  return null;
}

// ---------- Marktwaarde ----------

function chart(vals) {
  if (vals.length < 2) return '';
  const W = 320; const H = 96; const P = 6;
  const t0 = new Date(vals[0].date).getTime(); const t1 = Math.max(new Date(vals[vals.length - 1].date).getTime(), t0 + 1);
  const max = Math.max(...vals.map((v) => v.amount)); const min = Math.min(...vals.map((v) => v.amount));
  const lo = Math.max(0, min - (max - min) * 0.25); const hi = max === lo ? lo + 1 : max;
  const x = (d) => P + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - 2 * P);
  const y = (a) => H - P - ((a - lo) / (hi - lo)) * (H - 2 * P - 14);
  let d = `M${x(vals[0].date).toFixed(1)},${y(vals[0].amount).toFixed(1)}`;
  vals.slice(1).forEach((v) => { d += ` H${x(v.date).toFixed(1)} V${y(v.amount).toFixed(1)}`; });
  const area = `${d} V${H - P} H${x(vals[0].date).toFixed(1)} Z`;
  const peak = vals.reduce((a, b) => (b.amount >= a.amount ? b : a));
  return `<svg class="value-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Marktwaarde van ${esc(euro(vals[0].amount))} naar ${esc(euro(vals[vals.length - 1].amount))}">
    <path class="value-chart__area" d="${area}"/><path class="value-chart__line" d="${d}" vector-effect="non-scaling-stroke"/>
    ${vals.map((v) => `<circle cx="${x(v.date).toFixed(1)}" cy="${y(v.amount).toFixed(1)}" r="2.6" class="${v === peak ? 'is-peak' : ''}"/>`).join('')}
  </svg>
  <div class="value-chart__axis mono"><span>${esc(dm(vals[0].date))} ’${vals[0].date.slice(2, 4)}</span><span>top ${esc(euro(peak.amount))}</span><span>${esc(dm(vals[vals.length - 1].date))} ’${vals[vals.length - 1].date.slice(2, 4)}</span></div>`;
}

export function valueBlock(pr, id) {
  const vals = valuesAsc(pr);
  const desc = vals.slice().reverse();
  const cur = desc[0]; const prev = desc[1];
  const delta = cur && prev ? cur.amount - prev.amount : 0;
  const pid = esc(String(id));
  return `
    <section class="section">
      <div class="section__label"><span>Marktwaarde</span><span>${vals.length ? `${vals.length} ${vals.length === 1 ? 'meting' : 'metingen'}` : ''}</span></div>
      ${cur ? `<div class="value-now"><span class="big-num">${esc(euro(cur.amount))}</span>
          ${prev ? `<span class="value-delta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${delta ? esc(euro(Math.abs(delta))) : 'gelijk'}</span>` : ''}
          <span class="muted" style="font-size:12px">${esc(dmy(cur.date))}</span></div>
        ${chart(vals)}
        <details class="fold"><summary>Alle metingen</summary><div class="list">${desc.map((v) => {
          const i = (pr.valueHistory || []).indexOf(v);
          return `<button type="button" class="list-row transfer-row" data-edit-value="${i}" data-pid="${pid}">
            <span class="list-row__main"><span class="list-row__title mono">${esc(euro(v.amount))}</span><span class="list-row__sub">${esc(dmy(v.date))}${v.note ? ` · ${esc(v.note)}` : ''}</span></span>
            <span class="muted" aria-hidden="true">✎</span></button>`;
        }).join('')}</div></details>`
        : '<p class="muted" style="font-size:13px">Nog geen marktwaarde. Neem hem over van Transfermarkt wanneer die een nieuwe waarde publiceert.</p>'}
      <div><button class="btn btn--sm" type="button" data-add-value data-pid="${pid}">+ Waarde toevoegen</button></div>
    </section>`;
}

async function editValue(ctx, id, index, profiles) {
  const pr = profiles[String(id)] || {};
  const all = (pr.valueHistory || []).slice();
  const v = index != null ? all[index] : { date: todayIso(), amount: null };
  const data = await openSheet({
    title: index != null ? 'Marktwaarde aanpassen' : 'Marktwaarde toevoegen',
    body: `<div class="field-row"><label class="field"><span>Datum</span><input name="date" type="date" value="${esc(v.date || '')}"></label>
      <label class="field"><span>Waarde (€)</span><input name="amount" type="number" inputmode="numeric" min="0" step="5000" placeholder="bijv. 350000" value="${v.amount ?? ''}"></label></div>
      <p class="muted sheet__note" data-euro-preview>${v.amount != null ? esc(euro(v.amount)) : 'Typ het hele bedrag: 350000 = €350k, 1200000 = €1,2 mln.'}</p>
      <label class="field"><span>Notitie</span><input name="note" maxlength="80" placeholder="bijv. Transfermarkt-update" value="${esc(v.note || '')}"></label>
      ${index != null ? '<label class="field field--check"><input type="checkbox" name="delete"> <span>Deze meting verwijderen</span></label>' : ''}`,
    validate: (fd) => {
      if (fd.get('delete')) return null;
      if (!fd.get('date')) return 'Vul een datum in.';
      const a = fd.get('amount');
      if (a === '' || Number(a) < 0) return 'Vul een bedrag in.';
      if (Number(a) > 0 && Number(a) < 1000) return 'Dat lijkt in duizenden. Typ het hele bedrag, bijv. 350000.';
      const dup = all.findIndex((x, i) => i !== index && x.date === fd.get('date'));
      if (dup >= 0) return 'Er is al een meting op die datum. Pas die aan.';
      return null;
    },
  });
  if (!data) return;
  const next = all.slice();
  if (data.get('delete')) next.splice(index, 1);
  else {
    const item = { date: data.get('date'), amount: Number(data.get('amount')), note: String(data.get('note') || '').trim() };
    if (index != null) next[index] = item; else next.push(item);
  }
  next.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  await saveWithUndo(ctx, id, { valueHistory: next }, { valueHistory: all }, data.get('delete') ? 'Meting verwijderd' : 'Marktwaarde opgeslagen');
}

// ---------- Blessures ----------

export function injuryBlock(pr, id) {
  const list = ((pr && pr.injuries) || []).map((x, i) => ({ ...x, i, ...injuryState(x) })).sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  const pid = esc(String(id));
  const total = list.filter((x) => x.out).reduce((t, x) => t + x.out, 0);
  return `
    <section class="section">
      <div class="section__label"><span>Blessures</span><span>${list.length ? `${list.length}${total ? ` · ${weeks(total)} totaal` : ''}` : ''}</span></div>
      ${list.length ? `<div class="list">${list.map((x) => `
        <button type="button" class="list-row transfer-row ${x.state === 'out' ? 'is-injured' : ''}" data-edit-injury="${x.i}" data-pid="${pid}">
          <span class="list-row__main"><span class="list-row__title">${x.state === 'out' ? '<span class="inj-dot" aria-hidden="true"></span>' : ''}${esc(x.type || 'Blessure')}</span>
          <span class="list-row__sub">${esc(dmy(x.startDate))} → ${x.state === 'healed' ? esc(dmy(x.actualReturn)) + ` · ${weeks(x.out)} out` : x.state === 'out' ? `nog geblesseerd · ${x.out ? weeks(x.out) : 'sinds vandaag'}${x.expected ? ` · verwacht ${esc(dmy(x.expected))}` : ''}` : x.state === 'planned' ? 'gepland' : '?'}${x.note ? ` · ${esc(x.note)}` : ''}</span></span>
          <span class="muted" aria-hidden="true">✎</span></button>`).join('')}</div>`
        : '<p class="muted" style="font-size:13px">Geen blessures bekend.</p>'}
      <div><button class="btn btn--sm" type="button" data-add-injury data-pid="${pid}">+ Blessure toevoegen</button></div>
    </section>`;
}

async function editInjury(ctx, id, index, profiles) {
  const pr = profiles[String(id)] || {};
  const all = (pr.injuries || []).slice();
  const x = index != null ? all[index] : { type: '', startDate: todayIso() };
  const known = INJURY_TYPES.includes(x.type);
  const data = await openSheet({
    title: index != null ? 'Blessure aanpassen' : 'Blessure toevoegen',
    body: `<div class="field-row"><label class="field"><span>Soort</span><select name="type"><option value="">Kies…</option>${INJURY_TYPES.map((t) => `<option ${x.type === t ? 'selected' : ''}>${t}</option>`).join('')}${x.type && !known ? `<option selected>${esc(x.type)}</option>` : ''}</select></label>
      <label class="field"><span>Sinds</span><input name="start" type="date" value="${esc(x.startDate || '')}"></label></div>
      <div class="field-row"><label class="field"><span>Verwacht terug</span><input name="expected" type="date" value="${esc(x.expectedReturn || '')}"></label>
      <label class="field"><span>Echt terug</span><input name="actual" type="date" value="${esc(x.actualReturn || '')}"></label></div>
      <p class="muted sheet__note">"Echt terug" leeg laten zolang hij er nog uit ligt. Terug = weer bij de wedstrijdselectie.</p>
      <label class="field"><span>Notitie</span><input name="note" maxlength="120" placeholder="bijv. Geopereerd" value="${esc(x.note || '')}"></label>
      ${index != null ? '<label class="field field--check"><input type="checkbox" name="delete"> <span>Deze blessure verwijderen</span></label>' : ''}`,
    validate: (fd) => {
      if (fd.get('delete')) return null;
      if (!fd.get('type')) return 'Kies een soort.';
      if (!fd.get('start')) return 'Vul in sinds wanneer.';
      if (fd.get('expected') && fd.get('expected') < fd.get('start')) return '"Verwacht terug" ligt vóór het begin.';
      if (fd.get('actual') && fd.get('actual') < fd.get('start')) return '"Echt terug" ligt vóór het begin.';
      return null;
    },
  });
  if (!data) return;
  const next = all.slice();
  if (data.get('delete')) next.splice(index, 1);
  else {
    const item = { type: data.get('type'), startDate: data.get('start'), expectedReturn: data.get('expected') || null, actualReturn: data.get('actual') || null, note: String(data.get('note') || '').trim() };
    if (index != null) next[index] = item; else next.push(item);
  }
  await saveWithUndo(ctx, id, { injuries: next }, { injuries: all }, data.get('delete') ? 'Blessure verwijderd' : 'Blessure opgeslagen');
}

async function saveWithUndo(ctx, id, next, before, msg) {
  try {
    await savePlayer(id, next);
    toast(msg, { action: 'Ongedaan maken', onAction: async () => { await savePlayer(id, before); ctx.refresh(); } });
    ctx.refresh();
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); }
}

/** Klikken op de knoppen in beide blokken. getProfiles: () => Promise<profiles>. */
export function mountExtra(root, ctx, getProfiles) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add-value],[data-edit-value],[data-add-injury],[data-edit-injury]');
    if (!b) return;
    const profiles = await getProfiles();
    const id = b.dataset.pid;
    if (b.matches('[data-add-value]')) editValue(ctx, id, null, profiles);
    else if (b.matches('[data-edit-value]')) editValue(ctx, id, Number(b.dataset.editValue), profiles);
    else if (b.matches('[data-add-injury]')) editInjury(ctx, id, null, profiles);
    else editInjury(ctx, id, Number(b.dataset.editInjury), profiles);
  });
}

// Live voorbeeld van het bedrag ("€350k") onder het invoerveld.
document.addEventListener('input', (e) => {
  if (!e.target.matches || !e.target.matches('.sheet input[name="amount"]')) return;
  const p = e.target.closest('form, .sheet').querySelector('[data-euro-preview]');
  if (p) p.textContent = e.target.value ? euro(Number(e.target.value)) : '';
});
