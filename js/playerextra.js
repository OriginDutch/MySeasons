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
const daysUntil = (d) => Math.round((Date.parse(`${d}T12:00:00`) - Date.now()) / 864e5);
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

// Marktwaarde-grafiek: een trapgrafiek (de waarde geldt tot de volgende meting), getekend op de echte breedte
// van het scherm zodat niets uitrekt. Assen met ronde bedragen en datums, crosshair + tooltip op hover/tik.
function chart(vals) {
  if (vals.length < 2) return '';
  const data = esc(JSON.stringify(vals.map((v) => ({ d: v.date, a: v.amount, n: v.note || '' }))));
  return `<div class="vchart" data-vals="${data}" tabindex="0" role="img" aria-label="Marktwaarde-verloop: ${esc(vals.map((v) => `${dmy(v.date)} ${euro(v.amount)}`).join(', '))}"></div>`;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
const mShort = (t) => new Date(t).toLocaleDateString('nl-NL', { month: 'short' }).replace('.', '');

function niceStep(range, count) {
  const raw = range / count; const pow = 10 ** Math.floor(Math.log10(raw)); const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

function drawValueChart(box) {
  let vals; try { vals = JSON.parse(box.dataset.vals); } catch { return; }
  const W = Math.max(260, box.clientWidth); const H = 190;
  const P = { l: 56, r: 14, t: 14, b: 28 };
  const iw = W - P.l - P.r; const ih = H - P.t - P.b;
  const pts = vals.map((v) => ({ ...v, t: Date.parse(v.d + 'T12:00:00') })).sort((a, b) => a.t - b.t);
  const now = Date.now();
  const t0 = pts[0].t; const t1 = Math.max(now, pts[pts.length - 1].t + 1);
  const amounts = pts.map((p) => p.a);
  const lo0 = Math.min(...amounts); const hi0 = Math.max(...amounts);
  const step = niceStep(Math.max(hi0 - lo0, hi0 * 0.2, 1), 4);
  const lo = Math.max(0, Math.floor((lo0 - step * 0.5) / step) * step); const hi = Math.ceil((hi0 + step * 0.25) / step) * step;
  const x = (t) => P.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (a) => P.t + ih - ((a - lo) / (hi - lo)) * ih;

  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'vchart__svg' });
  // Y-raster met ronde bedragen
  for (let v = lo; v <= hi + 1; v += step) {
    svg.append(el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'vchart__grid' }));
    const t = el('text', { x: P.l - 8, y: y(v) + 4, class: 'vchart__ytick', 'text-anchor': 'end' }); t.textContent = euro(v); svg.append(t);
  }
  // X-labels: per kwartaal of halfjaar, afhankelijk van de breedte
  const months = (t1 - t0) / (30.4 * 864e5);
  const every = months / (iw / 70) > 6 ? 12 : months / (iw / 70) > 3 ? 6 : 3;
  const d = new Date(t0); d.setDate(1); d.setHours(12); d.setMonth(Math.ceil(d.getMonth() / every) * every);
  for (; d.getTime() <= t1; d.setMonth(d.getMonth() + every)) {
    const tx = x(d.getTime()); if (tx < P.l + 10 || tx > W - P.r - 10) continue;
    svg.append(el('line', { x1: tx, x2: tx, y1: P.t + ih, y2: P.t + ih + 4, class: 'vchart__axis' }));
    const t = el('text', { x: tx, y: H - 8, class: 'vchart__xtick', 'text-anchor': 'middle' });
    t.textContent = `${mShort(d.getTime())} ’${String(d.getFullYear()).slice(2)}`; svg.append(t);
  }
  svg.append(el('line', { x1: P.l, x2: W - P.r, y1: P.t + ih, y2: P.t + ih, class: 'vchart__axis' }));
  // Trap: waarde blijft staan tot de volgende meting, en loopt door tot vandaag.
  let path = `M${x(pts[0].t)},${y(pts[0].a)}`;
  pts.slice(1).forEach((p) => { path += ` H${x(p.t)} V${y(p.a)}`; });
  const lastX = x(pts[pts.length - 1].t); const nowX = x(t1);
  svg.append(el('path', { d: `${path} H${lastX} V${P.t + ih} H${x(pts[0].t)} Z`, class: 'vchart__area' }));
  if (nowX - lastX > 2) svg.append(el('rect', { x: lastX, y: y(pts[pts.length - 1].a), width: nowX - lastX, height: P.t + ih - y(pts[pts.length - 1].a), class: 'vchart__area vchart__area--now' }));
  svg.append(el('path', { d: path, class: 'vchart__line' }));
  if (nowX - lastX > 2) svg.append(el('path', { d: `M${lastX},${y(pts[pts.length - 1].a)} H${nowX}`, class: 'vchart__line vchart__line--now' }));
  pts.forEach((p, i) => svg.append(el('circle', { cx: x(p.t), cy: y(p.a), r: i === pts.length - 1 ? 5 : 4, class: `vchart__dot${i === pts.length - 1 ? ' is-last' : ''}` })));
  // Hover-laag
  const cross = el('line', { y1: P.t, y2: P.t + ih, class: 'vchart__cross', visibility: 'hidden' });
  const ring = el('circle', { r: 7, class: 'vchart__hl', visibility: 'hidden' });
  svg.append(cross, ring);
  const hit = el('rect', { x: P.l, y: 0, width: iw, height: H, fill: 'transparent' });
  svg.append(hit);
  box.replaceChildren(svg);
  const tip = document.createElement('div'); tip.className = 'vchart__tip'; tip.hidden = true; box.append(tip);

  let cur = -1;
  const show = (i) => {
    cur = i; const p = pts[i]; const px = x(p.t); const py = y(p.a);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    ring.setAttribute('cx', px); ring.setAttribute('cy', py); ring.setAttribute('visibility', 'visible');
    const prev = pts[i - 1]; const delta = prev ? p.a - prev.a : null;
    tip.replaceChildren();
    const v = document.createElement('strong'); v.textContent = euro(p.a);
    const dl = document.createElement('span'); dl.className = 'vchart__tipdate'; dl.textContent = dmy(p.d);
    tip.append(v, dl);
    if (delta != null) { const dd = document.createElement('span'); dd.className = `vchart__tipdelta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`; dd.textContent = delta ? `${delta > 0 ? '▲' : '▼'} ${euro(Math.abs(delta))} t.o.v. ${dmy(prev.d)}` : `gelijk aan ${dmy(prev.d)}`; tip.append(dd); }
    if (p.n) { const nn = document.createElement('span'); nn.className = 'vchart__tipnote'; nn.textContent = p.n; tip.append(nn); }
    tip.hidden = false;
    const tw = tip.offsetWidth; const left = Math.min(Math.max(px - tw / 2, 0), W - tw);
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(0, py - tip.offsetHeight - 14)}px`;
  };
  const hide = () => { cur = -1; tip.hidden = true; cross.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect(); const mx = clientX - r.left;
    let best = 0; pts.forEach((p, i) => { if (Math.abs(x(p.t) - mx) < Math.abs(x(pts[best].t) - mx)) best = i; });
    return best;
  };
  hit.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  hit.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  box.onkeydown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(Math.min(pts.length - 1, Math.max(0, (cur < 0 ? pts.length : cur) + (e.key === 'ArrowRight' ? 1 : -1)))); }
    if (e.key === 'Escape') hide();
  };
  box.onblur = hide;
}

/** Alle grafieken in root tekenen, en opnieuw als de breedte verandert. */
export function drawCharts(root) {
  root.querySelectorAll('.vchart').forEach((box) => {
    drawValueChart(box);
    if (typeof ResizeObserver !== 'undefined' && !box._ro) {
      let w = box.clientWidth;
      box._ro = new ResizeObserver(() => { if (Math.abs(box.clientWidth - w) > 4) { w = box.clientWidth; drawValueChart(box); } });
      box._ro.observe(box);
    }
  });
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
        <details class="fold"><summary><span>Alle metingen</span></summary><div class="list">${desc.map((v) => {
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
          <span class="list-row__sub">${esc(dmy(x.startDate))} → ${x.state === 'healed' ? esc(dmy(x.actualReturn)) + ` · ${weeks(x.out)} out` : x.state === 'out' ? `nog geblesseerd · ${x.out ? `${weeks(x.out)} tot nu toe` : 'sinds vandaag'}${x.expected ? ` · verwacht terug ${esc(dmy(x.expected))}${daysUntil(x.expected) > 0 ? ` (nog ${weeks(daysUntil(x.expected))})` : ' (over tijd)'}` : ''}` : x.state === 'planned' ? 'gepland' : '?'}${x.note ? ` · ${esc(x.note)}` : ''}</span></span>
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
  drawCharts(root);
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
