// TIJDELIJK: test of Highlightly's spelersprofiel (/players/{id}) in het gratis abonnement zit. 1 call per tik.
// Weg te halen zodra we het antwoord weten.

import { esc, toast } from './ui.js';
import { hl } from './api.js';
import { countCalls } from './store.js';

export const hlTestBlock = (id) => `<section class="section hltest">
  <div class="section__label"><span>Highlightly-profiel (test)</span><span>1 call</span></div>
  <p class="muted" style="font-size:12px;margin:0">Eenmalige test: zit het spelersprofiel (geboortedatum, contract, transfers, marktwaarde) in je abonnement?</p>
  <div><button class="btn btn--sm" type="button" data-hltest="${esc(String(id))}">Highlightly-profiel testen · 1 call</button></div>
  <div data-hltest-out></div></section>`;

const INTEREST = /birth|age|height|weight|foot|citizen|nation|countr|position|contract|join|expir|extension|transfer|market|value|team|club|number|photo|image|logo|name/i;

function walk(obj, path, out, depth = 0) {
  if (obj == null || depth > 4 || out.length > 60) return;
  if (Array.isArray(obj)) {
    out.push([path, `lijst · ${obj.length} items`]);
    if (obj.length) walk(obj[0], `${path}[0]`, out, depth + 1);
    return;
  }
  if (typeof obj === 'object') {
    Object.entries(obj).forEach(([k, v]) => {
      const p = path ? `${path}.${k}` : k;
      if (v != null && typeof v === 'object') walk(v, p, out, depth + 1);
      else if (INTEREST.test(k)) out.push([p, String(v).slice(0, 60)]);
    });
  }
}

export function mountHlTest(root) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hltest]');
    if (!b) return;
    const outBox = root.querySelector('[data-hltest-out]');
    b.disabled = true; b.textContent = 'Bezig…';
    let res; let err = null;
    try { res = await hl(`/players/${b.dataset.hltest}`); } catch (x) { err = x; }
    countCalls(1).catch(() => {});
    b.disabled = false; b.textContent = 'Nog een keer testen · 1 call';
    if (err) {
      outBox.innerHTML = `<p class="warn-line">Mislukt${err.status ? ` (HTTP ${esc(String(err.status))})` : ''}: ${esc(err.message || String(err))}${err.detail ? ` · ${esc(typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail).slice(0, 300))}` : ""}</p>
        <p class="muted" style="font-size:12px">Stuur dit door: dan weten we of het aan het abonnement ligt.</p>`;
      return;
    }
    const rows = []; walk(res, '', rows);
    const json = JSON.stringify(res, null, 1);
    outBox.innerHTML = `<p style="font-size:13px;margin:8px 0"><strong>Gelukt.</strong> ${rows.length} velden gevonden.</p>
      <div class="list">${rows.map(([k, v]) => `<div class="kv-line"><span class="mono" style="font-size:11px;word-break:break-all">${esc(k)}</span><span style="text-align:right">${esc(v)}</span></div>`).join('')}</div>
      <div class="btn-row" style="margin-top:8px"><button class="btn btn--sm btn--primary" type="button" data-hltest-copy>Kopieer het hele antwoord</button></div>
      <details class="fold"><summary><span>Ruw antwoord (${json.length} tekens)</span></summary><pre class="hltest__raw">${esc(json.slice(0, 20000))}</pre></details>`;
    outBox.querySelector('[data-hltest-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(json.slice(0, 60000)); toast('Gekopieerd: plak het in de chat met Claude'); } catch { toast('Kopiëren lukte niet: maak een screenshot'); }
    });
  });
}
