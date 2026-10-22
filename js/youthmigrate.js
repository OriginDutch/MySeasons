// Omzetting naar de jeugdregels van v0.47 (zie shirts.js). Vroeger gold een O21-keuze ook voor alle seizoenen
// erna; nu alleen voor dat ene seizoen (uitzondering). Deze pagina laat zien wat er per speler verandert en
// zet pas iets om als jij het aanvinkt. Doorstroom-transfers maakt de app hier NIET; dat doe je zelf.

import { esc, toast } from './ui.js';
import { getPlayers, savePlayersBatch, getMeta, setMeta } from './store.js';
import { CURRENT_SEASON } from './config.js';
import { levelsOf, levelFor, oldLevelFor, promotedSeason } from './shirts.js';
import { head } from './matchviews.js';

const yLab = (y) => `${y}–${String(Number(y) + 1).slice(2)}`;
const L = { o21: 'O21', first: 'eerste' };
const nameOf = (id, pr) => pr.fullName || pr.legacyName || pr.apiName || `speler ${id}`;

/** Per speler met oude O21-keuzes: { id, name, flag (vinkje Jeugdspeler voorstellen), diffs: [{year, was, wordt}] }. */
export function youthProposals(players) {
  const out = [];
  Object.entries(players || {}).forEach(([id, pr]) => {
    if (!pr || pr.linkedTo) return;
    const lv = levelsOf(pr);
    const years = Object.keys(lv).map(Number);
    if (!years.length || !Object.values(lv).includes('o21')) return;
    const flag = !pr.youth && promotedSeason(pr) == null && oldLevelFor(pr, CURRENT_SEASON) === 'o21';
    const diffsOf = (after) => {
      const d = [];
      for (let y = Math.min(...years); y <= CURRENT_SEASON; y++) { const was = oldLevelFor(pr, y); const wordt = levelFor(after, y); if (was !== wordt) d.push({ year: y, was, wordt }); }
      return d;
    };
    const diffs = diffsOf(flag ? { ...pr, youth: true } : pr);
    const diffsNoFlag = flag ? diffsOf(pr) : diffs;
    if (flag || diffs.length) out.push({ id, name: nameOf(id, pr), flag, diffs, diffsNoFlag, pr });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

export async function youthPending() {
  const done = await getMeta('youthMigration').catch(() => null);
  if (done && done.done) return 0;
  return youthProposals(await getPlayers().catch(() => ({}))).length;
}

export const youthViews = {
  jeugdregels: {
    title: 'Jeugdregels omzetten',
    navKey: 'selectie',
    async render() {
      const rows = youthProposals(await getPlayers().catch(() => ({})));
      this._rows = rows;
      return `${head({ kicker: 'Selectie', title: 'Jeugdregels omzetten', back: 'selectie' })}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">Nieuw: een doorstroom-transfer bepaalt eerste elftal of O21 (seizoenen ervoor = O21). Zonder doorstroom telt het vinkje <strong>Jeugdspeler</strong>. Een keuze per seizoen is nu een uitzondering voor alleen dat seizoen.</p>
          <p class="muted" style="font-size:var(--fs-md)">Hieronder wat er verandert. Niets wordt omgezet zonder vinkje. Doorstroom-transfers maak je zelf op de spelerspagina.</p>
        </section>
        ${rows.length ? `<section class="section"><div class="list">${rows.map((r, i) => `<div class="list-row dup-row" style="grid-template-columns:minmax(0,1fr)">
            <span class="list-row__main"><a class="list-row__title" href="#/speler/${encodeURIComponent(r.id)}">${esc(r.name)}</a>
              ${r.flag ? `<label class="field--check" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" data-yf="${i}" checked> <span>Vinkje Jeugdspeler aanzetten <span class="muted">(stond als laatste op O21)</span></span></label>` : ''}
              ${r.diffs.length ? `<span class="list-row__sub">${r.flag ? 'Ook dan nog anders' : 'Wordt anders'}: ${r.diffs.map((d) => `${yLab(d.year)} ${L[d.was]} → ${L[d.wordt]}`).join(', ')}</span>
                <label class="field--check" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" data-yx="${i}"> <span>Zo laten als het was (uitzondering per seizoen)</span></label>
                <span class="list-row__sub">Of voeg op zijn pagina een doorstroom toe.</span>` : ''}
            </span></div>`).join('')}</div>
          <div class="btn-row"><button class="btn btn--primary" type="button" data-y-go>Aangevinkte omzetten</button><button class="btn" type="button" data-y-done>Klaar, melding weg</button></div></section>`
        : `<section class="section"><p class="muted">Niets om om te zetten: alles klopt met de nieuwe regels.</p><div><button class="btn" type="button" data-y-done>Melding weg</button></div></section>`}`;
    },
    mount(root, ctx) {
      const view = this;
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-y-done]')) { await setMeta('youthMigration', { done: true, at: new Date().toISOString() }); toast('Melding weg'); location.hash = '#/selectie'; return; }
        const go = e.target.closest('[data-y-go]');
        if (!go) return;
        const writes = new Map();
        root.querySelectorAll('[data-yf]:checked').forEach((c) => { const r = view._rows[Number(c.dataset.yf)]; writes.set(r.id, { ...(writes.get(r.id) || {}), youth: true }); });
        root.querySelectorAll('[data-yx]:checked').forEach((c) => {
          const r = view._rows[Number(c.dataset.yx)];
          const w = writes.get(r.id) || {};
          const levels = { ...(r.pr.levels || levelsOf(r.pr)) };
          (w.youth ? r.diffs : r.diffsNoFlag).forEach((d) => { levels[d.year] = d.was; });
          writes.set(r.id, { ...w, levels, squadLevel: null });
        });
        if (!writes.size) { toast('Niets aangevinkt'); return; }
        go.disabled = true;
        try { await savePlayersBatch([...writes.entries()]); toast(`${writes.size} ${writes.size === 1 ? 'speler' : 'spelers'} omgezet`); ctx.refresh(); } catch (err) { toast(`Lukte niet: ${err.message || err}`); go.disabled = false; }
      });
    },
  },
};
