// Meer → Foto's: overzicht (opgeslagen / alleen link / niets), alle links in één keer binnenhalen,
// en de controle op nieuwe versies meteen draaien.

import { esc, icons, toast } from './ui.js';
import { getPlayers, getCoaches, getMeta, getClubMarks } from './store.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import { correctedList } from './matchviews.js';
import { buildSquad } from './players.js';
import { loadPhotos, importFromLink, importableLink, checkLinks } from './photos.js';
import { coachName } from './coaches.js';

let RUNNING = false;
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : null);

function head() {
  return `<header class="page-head"><div class="page-head__titles">
    <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
    <span class="page-head__kicker">Meer / Foto's</span><h1 class="page-head__title">Foto's</h1></div></header>`;
}

/** Alle eigenaren met hun fotostatus. */
async function owners() {
  const [players, coaches, marks, { list }] = await Promise.all([getPlayers().catch(() => ({})), getCoaches().catch(() => []), getClubMarks().catch(() => ({})), correctedList().catch(() => ({ list: [] }))]);
  const squadNames = new Map(buildSquad(list, MAIN_CLUB.id, players).players.map((p) => [String(p.id), p.name]));
  const status = (gal, url) => (gal && gal.main ? 'stored' : url ? (importableLink(url) ? 'link' : 'linkOther') : 'none');
  const ps = Object.entries(players).filter(([, pr]) => pr && !pr.linkedTo).map(([id, pr]) => ({
    kind: 'player', id, gallery: pr.gallery || null, url: pr.photoUrl || null, status: status(pr.gallery, pr.photoUrl),
    name: pr.fullName || pr.legacyName || pr.apiName || squadNames.get(id) || `speler ${id}`, inSquad: squadNames.has(id), href: `#/speler/${encodeURIComponent(id)}`,
  }));
  // Spelers uit de selectie zonder profiel: geen foto, geen link.
  squadNames.forEach((name, id) => { if (!players[id]) ps.push({ kind: 'player', id, gallery: null, url: null, status: 'none', name, inSquad: true, href: `#/speler/${encodeURIComponent(id)}` }); });
  const cs = coaches.map((c) => ({ kind: 'coach', id: String(c.id), gallery: c.gallery || null, url: c.photoUrl || null, status: status(c.gallery, c.photoUrl), name: coachName(c) || 'trainer', href: `#/trainer/${encodeURIComponent(c.id)}` }));
  const stadiums = Object.values(marks).filter((m) => m && m.stadiumGallery && m.stadiumGallery.main).length;
  return { ps, cs, stadiums };
}

const count = (arr, st) => arr.filter((o) => o.status === st).length;

async function bulkImport(root, ctx, targets) {
  if (RUNNING) return;
  RUNNING = true;
  const btn = root.querySelector('[data-ph-bulk]'); const out = root.querySelector('[data-ph-bulk-out]');
  btn.disabled = true;
  const res = { ok: 0, dup: 0, fail: [] };
  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      btn.textContent = `Bezig… ${i + 1} van ${targets.length}`;
      try {
        const o = await loadPhotos(t.kind, t.id, t.gallery, { linkUrl: t.url });
        const r = await importFromLink(o, { season: CURRENT_SEASON, asMain: true });
        if (r.dup) res.dup++; else res.ok++;
      } catch (err) { res.fail.push({ t, why: err.message || String(err) }); }
    }
    toast(`${res.ok} foto's binnengehaald${res.fail.length ? `, ${res.fail.length} mislukt` : ''}`);
    if (res.fail.length) {
      out.innerHTML = `<p class="warn-line">Niet gelukt:</p><div class="list">${res.fail.map(({ t, why }) => `<a class="list-row" href="${t.href}"><span class="list-row__main"><span class="list-row__title">${esc(t.name)}</span><span class="list-row__sub">${esc(why)}</span></span></a>`).join('')}</div>`;
    } else ctx.refresh();
  } finally { RUNNING = false; btn.disabled = false; btn.textContent = 'Alle links binnenhalen'; }
}

export const photosViews = {
  fotos: {
    title: "Foto's",
    navKey: 'meer',
    async render() {
      const [{ ps, cs, stadiums }, run] = await Promise.all([owners(), getMeta('linkCheckRun').catch(() => null)]);
      const all = [...ps, ...cs];
      const targets = all.filter((o) => o.status === 'link');
      this._targets = targets;
      const missing = ps.filter((o) => o.inSquad && o.status === 'none');
      const row = (label, arr) => `<tr><td>${label}</td><td class="mono">${count(arr, 'stored')}</td><td class="mono">${count(arr, 'link') + count(arr, 'linkOther')}</td><td class="mono">${count(arr, 'none')}</td></tr>`;
      return `${head()}
        <section class="section">
          <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Opgeslagen</th><th>Alleen link</th><th>Niets</th></tr></thead>
            <tbody>${row('Spelers', ps)}${row('Trainers', cs)}<tr><td>Stadions</td><td class="mono">${stadiums}</td><td class="mono">–</td><td class="mono">–</td></tr></tbody></table></div>
          <p class="muted" style="font-size:var(--fs-sm);margin:0">Spelers: iedereen met een profiel plus de huidige selectie.${count(all, 'linkOther') ? ` ${count(all, 'linkOther')} met een link van een andere site dan Transfermarkt of cambuur.nl: die kan de app niet binnenhalen.` : ''}</p>
        </section>
        <section class="section">
          <div class="section__label"><span>Links binnenhalen</span><span>${targets.length}</span></div>
          <p class="muted" style="font-size:var(--fs-md)">${targets.length ? `${targets.length} ${targets.length === 1 ? 'speler of trainer heeft' : 'spelers en trainers hebben'} alleen een link. Binnenhalen slaat de foto op als hoofdfoto met seizoen ${CURRENT_SEASON}–${String(CURRENT_SEASON + 1).slice(2)} (later aan te passen). Wie al een opgeslagen foto heeft, wordt overgeslagen. Kost geen Highlightly-calls.` : 'Niemand met alleen een link: alles wat binnen te halen valt, staat er al in.'}</p>
          ${targets.length ? '<div><button class="btn btn--primary" type="button" data-ph-bulk>Alle links binnenhalen</button></div>' : ''}
          <div data-ph-bulk-out></div>
        </section>
        <section class="section">
          <div class="section__label"><span>Nieuwe versies</span><span>${run && run.at ? `laatst ${esc(dmy(run.at))}` : 'nog nooit'}</span></div>
          <p class="muted" style="font-size:var(--fs-md)">Eens per week kijkt de app vanzelf of het plaatje achter een link veranderd is.${run && run.at ? ` Vorige keer: ${run.checked || 0} gecontroleerd, ${run.changed || 0} nieuw${run.failed ? `, ${run.failed} niet bereikbaar` : ''}.` : ''}</p>
          <div><button class="btn" type="button" data-ph-check>Nu controleren</button></div>
        </section>
        ${missing.length ? `<section class="section"><details class="fold"><summary class="section__label"><span>Selectie zonder foto of link</span><span>${missing.length}</span></summary>
          <div class="list">${missing.sort((a, b) => a.name.localeCompare(b.name, 'nl')).map((o) => `<a class="list-row" href="${o.href}"><span class="list-row__main"><span class="list-row__title">${esc(o.name)}</span></span></a>`).join('')}</div></details></section>` : ''}`;
    },
    mount(root, ctx) {
      const view = this;
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-ph-bulk]')) { bulkImport(root, ctx, view._targets || []); return; }
        const c = e.target.closest('[data-ph-check]');
        if (!c) return;
        c.disabled = true; c.textContent = 'Controleren…';
        try {
          const r = await checkLinks({ force: true });
          toast(r ? `${r.checked} gecontroleerd · ${r.changed} nieuw${r.failed ? ` · ${r.failed} niet bereikbaar` : ''}` : 'Er loopt al een controle');
          ctx.refresh();
        } catch (err) { toast(`Lukte niet: ${err.message || err}`); c.disabled = false; c.textContent = 'Nu controleren'; }
      });
    },
  },
};
