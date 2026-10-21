// Back-up: alles uit je Firestore als één JSON-bestand, en weer terugzetten.
// Terugzetten voegt samen (overschrijft per document), het verwijdert nooit iets.

import { esc, icons, toast } from './ui.js';
import { dumpCollection, restoreCollection, setMeta, getMeta } from './store.js';
import { APP_VERSION } from './version.js';
import { backups } from './api.js';
import { dayShort, timeOf } from './season.js';

// Volgorde = belangrijkste eerst. 'raw' is groot en optioneel.
export const COLLECTIONS = [
  ['matchNotes', 'Jouw aanvullingen en correcties', 'core'],
  ['players', 'Spelersprofielen, transfers, namen', 'core'],
  ['coaches', 'Trainers', 'core'],
  ['clubs', 'Clubmarkeringen', 'core'],
  ['seasons', 'Seizoenen', 'core'],
  ['matches', 'Cambuur-wedstrijden met details', 'core'],
  ['standings', 'Standen', 'core'],
  ['leagueMatches', 'Competitiewedstrijden', 'core'],
  ['leagueIndex', 'Competitie-index', 'core'],
  ['rsssf', 'RSSSF-seizoenen', 'core'],
  ['news', 'Bewaard nieuws', 'core'],
  ['meta', 'Instellingen en synchronisatie', 'core'],
  ['rawMatches', 'Ruwe Highlightly-data (groot)', 'raw'],
];
const LABEL = Object.fromEntries(COLLECTIONS.map(([k, l]) => [k, l]));
const WRITE_WARN = 15000; // Firestore gratis: 20.000 writes per dag
// Tellers die bij vandaag horen: nooit terugzetten, anders klopt je quotum niet meer.
const SKIP_META = new Set(['quota', 'nsWrites', 'backup', 'autoBackup']);
const docsFor = (b, k) => (b.collections[k] || []).filter((d) => !(k === 'meta' && SKIP_META.has(d.id)));
const docWord = (n) => `${n} ${n === 1 ? 'document' : 'documenten'}`;

export async function buildBackup({ raw = false } = {}, onProgress) {
  const out = { app: 'MySeasons', format: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), collections: {} };
  for (const [name, , kind] of COLLECTIONS) {
    if (kind === 'raw' && !raw) continue;
    out.collections[name] = await dumpCollection(name);
    if (onProgress) onProgress(name);
  }
  return out;
}

function download(obj) {
  const stamp = obj.exportedAt.slice(0, 16).replace(/[:T]/g, '-');
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const name = `myseasons-backup-${stamp}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  return { blob, name, file };
}

let pending = null; // ingelezen backup die op terugzetten wacht

// ---------- Automatisch (wekelijks, gzip, laatste 4 in de Worker-KV) ----------
const AUTO_KEY = 'ms-autobackup';
const WEEK = 7 * 864e5;
export const autoEnabled = () => { try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; } };
const setAuto = (on) => { try { localStorage.setItem(AUTO_KEY, on ? 'on' : 'off'); } catch { /* niet erg */ } };
const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Back-up maken en bij de Worker opslaan. why: 'auto' | 'manual'. */
export async function cloudBackup(why = 'manual', onProgress) {
  if (!canZip()) throw new Error('Deze browser kan niet comprimeren');
  const b = await buildBackup({ raw: false }, onProgress);
  const bytes = await gzip(JSON.stringify(b));
  const r = await backups.upload(bytes, { docs: count(b), version: APP_VERSION, why });
  await setMeta('autoBackup', { at: r.at, size: bytes.length, docs: count(b), why });
  return { ...r, docs: count(b) };
}

let autoRunning = false;
/** Bij het openen van de app: hooguit eens per week, op de achtergrond. */
export async function autoBackup() {
  if (autoRunning || !autoEnabled() || !canZip()) return null;
  const last = await getMeta('autoBackup').catch(() => null);
  if (last && last.at && Date.now() - Date.parse(last.at) < WEEK) return null;
  autoRunning = true;
  try { return await cloudBackup('auto'); } catch (err) { return { error: err }; } finally { autoRunning = false; }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(String(r.result))); } catch { reject(new Error('Dit is geen geldig JSON-bestand')); } };
    r.onerror = () => reject(new Error('Bestand lezen lukte niet'));
    r.readAsText(file);
  });
}

const count = (b) => Object.values(b.collections || {}).reduce((t, a) => t + a.length, 0);
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} kB`);

export const backupViews = {
  backup: {
    title: 'Back-up',
    navKey: 'meer',
    async render() {
      const last = await getMeta('backup').catch(() => null);
      const head = `<header class="page-head"><div class="page-head__titles">
        <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
        <span class="page-head__kicker">Meer / Back-up</span><h1 class="page-head__title">Back-up</h1></div></header>`;
      if (pending) {
        const cols = Object.entries(pending.collections || {});
        return `${head}
          <section class="section">
            <div class="section__label"><span>Terugzetten</span><span>${esc(dayShort(pending.exportedAt))} ${esc(timeOf(pending.exportedAt))}</span></div>
            <p class="muted" style="font-size:var(--fs-md)">Back-up van MySeasons ${esc(pending.version || '?')}. Terugzetten <strong>voegt samen</strong>: documenten uit de back-up overschrijven die met hetzelfde id, niets wordt verwijderd.</p>
            <div class="list">${cols.map(([k, docs]) => `<label class="dev"><input type="checkbox" name="rc" value="${esc(k)}" ${docsFor(pending, k).length ? 'checked' : ''}>
              <span class="dev__main"><span class="dev__what">${esc(LABEL[k] || k)}</span><span class="dev__vals muted">${docWord(docsFor(pending, k).length)}</span></span></label>`).join('')}</div>
            <p class="muted" style="font-size:var(--fs-sm)" data-rc-total></p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" type="button" data-bk="cancel">Annuleren</button>
              <button class="btn btn--primary" type="button" data-bk="restore">Terugzetten</button>
            </div>
          </section>
`;
      }
      let cloud = null; let cloudErr = null;
      try { cloud = await backups.list(); } catch (e) { cloudErr = e; }
      const auto = autoEnabled();
      return `${head}
        <section class="section">
          <div class="section__label"><span>Automatisch</span><span>${cloud ? `${cloud.items.length} van ${cloud.keep}` : ''}</span></div>
          <p class="muted" style="font-size:var(--fs-md)">Eens per week maakt de app bij het openen zelf een back-up en bewaart die (gecomprimeerd) bij je Worker. De laatste 4 blijven staan. Zonder de ruwe Highlightly-data.</p>
          <label class="field field--check"><input type="checkbox" data-auto ${auto ? 'checked' : ''}> <span>Wekelijks automatisch</span></label>
          ${cloudErr ? `<p class="warn-line">${esc(cloudErr.status === 404 ? 'De Worker kent back-ups nog niet: de nieuwe versie is nog niet gedeployd.' : (cloudErr.message || 'Worker niet bereikbaar'))}</p>` : ''}
          ${cloud && cloud.items.length ? `<div class="list">${cloud.items.map((it) => `
            <div class="list-row bk-row">
              <span class="list-row__main"><span class="list-row__title">${esc(dayShort(it.at))} ${esc(timeOf(it.at))}${it.why === 'manual' ? ' <span class="muted">· handmatig</span>' : ''}</span>
                <span class="list-row__sub">${it.docs ? `${it.docs} documenten · ` : ''}${esc(kb(it.size || 0))}${it.version ? ` · v${esc(it.version)}` : ''}</span></span>
              <span class="bk-row__btns"><button class="btn btn--sm" type="button" data-cloud-get="${esc(it.key)}">Downloaden</button><button class="btn btn--sm" type="button" data-cloud-restore="${esc(it.key)}">Terugzetten</button></span>
            </div>`).join('')}</div>` : cloud ? '<p class="muted" style="font-size:var(--fs-md)">Nog geen automatische back-ups.</p>' : ''}
          <div><button class="btn" type="button" data-bk="cloud" ${cloudErr ? 'disabled' : ''}>Nu een back-up opslaan</button></div>
        </section>
        <section class="section">
          <div class="section__label"><span>Exporteren</span><span>${last ? `laatst ${esc(dayShort(last.at))}` : 'nog nooit'}</span></div>
          <p class="muted" style="font-size:var(--fs-md)">Alles uit je database als één bestand: wedstrijden, je aanvullingen en correcties, spelers, transfers, trainers, seizoenen en standen. Bewaar het op je telefoon, PC of cloud.</p>
          <label class="field field--check"><input type="checkbox" data-raw> <span>Ook de ruwe Highlightly-data (groter bestand; alleen nodig om later alles opnieuw te verwerken)</span></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn--primary" type="button" data-bk="export">Back-up downloaden</button>
            ${navigator.canShare ? '<button class="btn" type="button" data-bk="share">Delen…</button>' : ''}
          </div>
          ${last ? `<p class="muted" style="font-size:var(--fs-sm)">Vorige: ${esc(dayShort(last.at))} ${esc(timeOf(last.at))} · ${last.docs} documenten · ${esc(last.size)}</p>` : ''}
        </section>
        <section class="section">
          <div class="section__label"><span>Terugzetten</span></div>
          <p class="muted" style="font-size:var(--fs-md)">Kies een eerder gemaakte back-up. Je ziet eerst wat erin zit voordat er iets wordt geschreven.</p>
          <label class="btn" style="align-self:flex-start;cursor:pointer">Back-up kiezen<input type="file" accept=".json,application/json" data-restore-file hidden></label>
        </section>`;
    },
    mount(root, ctx) {
      const totalEl = root.querySelector('[data-rc-total]');
      const updateTotal = () => {
        if (!totalEl || !pending) return;
        const n = [...root.querySelectorAll('input[name="rc"]:checked')].reduce((t, i) => t + docsFor(pending, i.value).length, 0);
        totalEl.textContent = `${docWord(n)} = ${n} writes${n > WRITE_WARN ? `. Let op: dat is veel voor één dag (gratis limiet 20.000). Vink vandaag een deel aan en morgen de rest.` : '.'}`;
      };
      root.addEventListener('change', async (e) => {
        if (e.target.matches('[data-auto]')) { setAuto(e.target.checked); toast(e.target.checked ? 'Wekelijkse back-up staat aan' : 'Wekelijkse back-up staat uit'); }
        if (e.target.matches('input[name="rc"]')) updateTotal();
        if (e.target.matches('[data-restore-file]')) {
          try {
            const b = await readFile(e.target.files[0]);
            if (b.app !== 'MySeasons' || !b.collections) throw new Error('Dit is geen MySeasons-back-up');
            pending = b;
            ctx.refresh();
          } catch (err) { toast(err.message); }
        }
      });
      updateTotal();
      root.addEventListener('click', async (e) => {
        const cg = e.target.closest('[data-cloud-get],[data-cloud-restore]');
        if (cg) {
          const key = cg.dataset.cloudGet || cg.dataset.cloudRestore;
          const label = cg.textContent; cg.disabled = true; cg.textContent = 'Ophalen…';
          try {
            const text = await gunzip(await backups.get(key));
            const obj = JSON.parse(text);
            if (cg.dataset.cloudRestore) { pending = obj; ctx.refresh(); return; }
            const { blob, name } = download(obj);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
          } catch (err) { toast(`Lukte niet: ${err.message || err}`); } finally { cg.disabled = false; cg.textContent = label; }
          return;
        }
        const b = e.target.closest('[data-bk]');
        if (!b) return;
        if (b.dataset.bk === 'cloud') {
          b.disabled = true;
          try {
            const r = await cloudBackup('manual', (name) => { b.textContent = `Lezen: ${LABEL[name] || name}…`; });
            toast(`Opgeslagen: ${r.docs} documenten · ${kb(r.size)}${r.removed ? ` · ${r.removed} oude opgeruimd` : ''}`);
            ctx.refresh();
          } catch (err) { toast(`Back-up mislukt: ${err.message || err}`); b.disabled = false; b.textContent = 'Nu een back-up opslaan'; }
          return;
        }
        const act = b.dataset.bk;
        if (act === 'cancel') { pending = null; ctx.refresh(); return; }
        if (act === 'restore') {
          const picked = [...root.querySelectorAll('input[name="rc"]:checked')].map((i) => i.value);
          if (!picked.length) { toast('Niets gekozen'); return; }
          b.disabled = true;
          try {
            let done = 0;
            for (const k of picked) {
              b.textContent = `Bezig: ${LABEL[k] || k}…`;
              done += await restoreCollection(k, docsFor(pending, k));
            }
            toast(`${docWord(done)} teruggezet`);
            pending = null;
            ctx.refresh();
          } catch (err) { toast(`Terugzetten lukte niet: ${err.message || err}`); b.disabled = false; b.textContent = 'Terugzetten'; }
          return;
        }
        if (act === 'export' || act === 'share') {
          const raw = !!root.querySelector('[data-raw]:checked');
          const label = b.innerHTML; b.disabled = true;
          try {
            const backup = await buildBackup({ raw }, (name) => { b.textContent = `Lezen: ${LABEL[name] || name}…`; });
            const { blob, name, file } = download(backup);
            if (act === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'MySeasons back-up' });
            } else {
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob); a.download = name;
              document.body.append(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 10000);
            }
            await setMeta('backup', { at: backup.exportedAt, docs: count(backup), size: kb(blob.size), raw });
            toast(`Back-up gemaakt: ${count(backup)} documenten · ${kb(blob.size)}`);
            ctx.refresh();
          } catch (err) {
            if (err && err.name === 'AbortError') toast('Delen geannuleerd');
            else toast(`Back-up mislukt: ${err.message || err}`);
          } finally { b.disabled = false; b.innerHTML = label; }
        }
      });
    },
  },
};
