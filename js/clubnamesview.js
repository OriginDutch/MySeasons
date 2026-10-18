// Meer → Clubnamen: per club je eigen naam, korte naam en code (3–4 letters).

import { esc, icons, toast } from './ui.js';
import { getAllLeagueTeams, saveClubMarksBatch } from './store.js';
import { openSheet } from './editor.js';
import { overrideOf, setOne, defaultCode } from './clubnames.js';

function head(title) {
  return `
    <header class="page-head">
      <div class="page-head__titles">
        <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
        <span class="page-head__kicker">Meer / Clubnamen</span>
        <h1 class="page-head__title">${esc(title)}</h1>
      </div>
    </header>`;
}

const crest = (t) => (t.logo
  ? `<img class="crest" src="${esc(t.logo)}" width="22" height="22" alt="" loading="lazy">`
  : `<span class="crest crest--txt" style="width:22px;height:22px">${esc(t.code || defaultCode(t.name))}</span>`);

function row(t) {
  const o = overrideOf(t.id);
  const bits = [];
  if (o && o.name) bits.push(`Highlightly: ${t.apiName}`);
  if (o && o.short) bits.push(`kort: ${o.short}`);
  bits.push(`code: ${t.code}${o && o.code ? '' : ' (standaard)'}`);
  return `<button type="button" class="list-row cn-row" data-club="${esc(String(t.id))}" data-q="${esc(`${t.name} ${t.apiName} ${t.short}`.toLowerCase())}">
    <span class="list-row__main"><span class="list-row__title cn-row__title">${crest(t)}<span>${esc(t.name)}</span>${o ? '<span class="ptag">eigen</span>' : ''}</span>
    <span class="list-row__sub">${esc(bits.join(' · '))}</span></span>
    <span class="list-row__end" aria-hidden="true">✎</span>
  </button>`;
}

async function edit(ctx, t) {
  const o = overrideOf(t.id) || {};
  const data = await openSheet({
    title: `${t.apiName} hernoemen`,
    body: `<label class="field"><span>Naam</span><input name="name" maxlength="40" placeholder="${esc(t.apiName)}" value="${esc(o.name || '')}"></label>
      <div class="field-row">
        <label class="field"><span>Korte naam</span><input name="short" maxlength="24" placeholder="bijv. Go Ahead" value="${esc(o.short || '')}"></label>
        <label class="field"><span>Code</span><input name="code" maxlength="4" placeholder="${esc(defaultCode(o.name || t.apiName))}" value="${esc(o.code || '')}" style="text-transform:uppercase"></label>
      </div>
      <p class="muted sheet__note">Leeg = de Highlightly-naam. De korte naam staat op mobiel in de stand en in de ministand, de code in de seizoensstrip (bijv. @${esc(defaultCode(o.name || t.apiName))}).</p>
      ${o.name || o.short || o.code ? '<label class="field field--check"><input type="checkbox" name="reset"> <span>Terug naar de Highlightly-naam</span></label>' : ''}`,
    validate: (fd) => (/[^A-Za-z0-9]/.test(String(fd.get('code') || '').trim()) ? 'De code mag alleen letters en cijfers hebben.' : null),
  });
  if (!data) return;
  const reset = !!data.get('reset');
  const next = reset ? { nameOverride: '', shortName: '', code: '' } : {
    nameOverride: String(data.get('name') || '').trim(),
    shortName: String(data.get('short') || '').trim(),
    code: String(data.get('code') || '').trim().toUpperCase(),
  };
  try {
    await saveClubMarksBatch([[String(t.id), next]]);
    setOne(t.id, next);
    toast(reset ? `${t.apiName} heet weer zo` : 'Clubnaam opgeslagen');
    ctx.refresh();
  } catch (err) {
    toast(`Opslaan lukte niet: ${err.message || err}`);
  }
}

export const clubNamesViews = {
  clubnamen: {
    title: 'Clubnamen',
    navKey: 'meer',
    async render() {
      const teams = (await getAllLeagueTeams().catch(() => [])).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
      const own = teams.filter((t) => overrideOf(t.id)).length;
      return `
        ${head('Clubnamen')}
        <section class="section">
          <p class="muted" style="font-size:13px">${teams.length} clubs uit je wedstrijden${own ? ` · ${own} met een eigen naam` : ''}. Je naam staat overal in de app, ook in meldingen. Highlightly-data blijft ongewijzigd.</p>
          <label class="field"><span class="visually-hidden">Zoeken</span><input type="search" data-cn-search placeholder="Zoek een club" autocomplete="off"></label>
          <div class="list" data-cn-list>${teams.map(row).join('') || '<p class="muted">Nog geen clubs. Synchroniseer eerst een seizoen.</p>'}</div>
        </section>`;
    },
    async mount(root, ctx, args) {
      const teams = await getAllLeagueTeams().catch(() => []);
      const byId = new Map(teams.map((t) => [String(t.id), t]));
      root.querySelector('[data-cn-search]')?.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        root.querySelectorAll('.cn-row').forEach((r) => { r.hidden = q && !r.dataset.q.includes(q); });
      });
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-club]');
        if (b && byId.has(b.dataset.club)) edit(ctx, byId.get(b.dataset.club));
      });
      if (args && args[0] && byId.has(String(args[0]))) {
        history.replaceState(null, '', '#/clubnamen');
        edit(ctx, byId.get(String(args[0])));
      }
    },
  },
};
