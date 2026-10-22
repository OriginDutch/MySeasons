// Foto's: eigen opgeslagen foto's (Firestore, privé) per speler, trainer en stadion, met een hoofdfoto
// en optioneel een foto per seizoen. Volgorde bij tonen: opgeslagen foto → link → initialen.
//
// Opslag: photos/{id} met drie formaten (thumb voor lijsten, small voor de strook, large om te bekijken).
// Bij de eigenaar staat een verwijzing { main: { id, thumb }, seasons: { 2025: { id, thumb } }, count }.
// Galerijsectie pas vanaf 2 foto's, inklapbaar; open/dicht geldt voor alle galerijen, per apparaat.

import { esc, toast } from './ui.js';
import { getPhotos, addPhoto, updatePhoto, deletePhoto, setOwnerGallery, setOwnerLinkCheck, setMeta, getMeta, getPlayers, getCoaches } from './store.js';
import { fetchImage } from './api.js';
import { CURRENT_SEASON } from './config.js';

export const ownerKey = (kind, id) => `${kind}:${id}`;
const yLabel = (y) => `${y}–${String(Number(y) + 1).slice(2)}`;
const FIRST_YEAR = 2010;

// ---------- Verkleinen ----------
const SIZES = { thumb: 128, small: 360, large: 960 };

async function bitmapOf(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* oudere browser */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode(); return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function encode(src, max, quality) {
  const w0 = src.width; const h0 = src.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)); const h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
  let url = c.toDataURL('image/webp', quality);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', quality); // Safari: geen webp-encoder
  return { url, w, h };
}

async function sha(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Afbeelding (File/Blob) → drie formaten + vingerafdruk van het origineel. */
export async function prepareImage(blob) {
  if (!blob || !/^image\//.test(blob.type || 'image/')) throw new Error('Dit is geen afbeelding');
  const bmp = await bitmapOf(blob);
  const large = encode(bmp, SIZES.large, 0.82);
  const small = encode(bmp, SIZES.small, 0.8);
  const thumb = encode(bmp, SIZES.thumb, 0.72);
  if (bmp.close) bmp.close();
  const hash = await sha(await blob.arrayBuffer());
  return { thumb: thumb.url, small: small.url, large: large.url, w: large.w, h: large.h, bytes: thumb.url.length + small.url.length + large.url.length, hash };
}

// ---------- Verwijzing bij de eigenaar ----------

/** Welke foto toon je voor dit seizoen: lopend seizoen = hoofdfoto; oud seizoen = die van dat seizoen, anders hoofdfoto. */
export function shownRef(gallery, season) {
  if (!gallery) return null;
  const y = Number(season);
  if (y && y !== CURRENT_SEASON && gallery.seasons && gallery.seasons[y]) return gallery.seasons[y];
  return gallery.main || null;
}
export const shownThumb = (gallery, season) => (shownRef(gallery, season) || {}).thumb || null;

/** Verwijzing opnieuw opbouwen uit de foto's (bron van waarheid) en de gekozen hoofdfoto. */
function buildGallery(photos, mainId) {
  const sorted = photos.slice().sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
  const main = sorted.find((p) => p.id === mainId) || null;
  const seasons = {};
  sorted.forEach((p) => { if (p.season != null && !seasons[p.season]) seasons[p.season] = { id: p.id, thumb: p.thumb }; });
  if (main && main.season != null) seasons[main.season] = { id: main.id, thumb: main.thumb }; // hoofdfoto wint in zijn eigen seizoen
  return { main: main ? { id: main.id, thumb: main.thumb } : null, seasons, count: photos.length, updatedAt: new Date().toISOString() };
}

async function writeGallery(kind, id, photos, mainId) {
  await setOwnerGallery(kind, id, buildGallery(photos, mainId));
  await setMeta('photos', { lastChange: new Date().toISOString() }).catch(() => {}); // voor de export-herinnering
}

// ---------- Weergave ----------

const OPEN_KEY = 'ms-gallery-open';
const isOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } };
document.addEventListener('toggle', (e) => {
  if (!e.target.matches || !e.target.matches('details[data-gallery]')) return;
  try { localStorage.setItem(OPEN_KEY, e.target.open ? '1' : '0'); } catch { /* niet erg */ }
}, true);

/** Grote foto bovenaan: opgeslagen foto (small), anders de link, anders niets. */
export function heroImg(photos, gallery, season, linkUrl, cls = 'player-hero__photo') {
  const ref = shownRef(gallery, season);
  const p = ref && photos.find((x) => x.id === ref.id);
  if (p) return `<img class="${cls}" src="${p.small}" alt="" data-photo-open="${esc(p.id)}">`;
  if (linkUrl) return `<img class="${cls}" src="${esc(linkUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
  return '';
}

/** Galerijstrook (alleen vanaf 2 foto's). */
export function galleryHtml(photos, gallery, { title = "Foto's", linkUrl = null } = {}) {
  if ((photos || []).length < 2) return '';
  const mainId = gallery && gallery.main ? gallery.main.id : null;
  const order = photos.slice().sort((a, b) => (b.id === mainId) - (a.id === mainId) || (Number(b.season) || 0) - (Number(a.season) || 0) || String(b.addedAt).localeCompare(String(a.addedAt)));
  return `<section class="section"><details class="fold gal" data-gallery ${isOpen() ? 'open' : ''}>
      <summary class="section__label"><span>${esc(title)}</span><span>${photos.length}</span></summary>
      <div class="gal__strip">${order.map((p) => `<button type="button" class="gal__t" data-photo-open="${esc(p.id)}">
          <img src="${p.thumb}" alt="" loading="lazy">${p.id === mainId ? '<span class="gal__star">★</span>' : ''}${p.source === 'link' ? '<span class="gal__src mono">link</span>' : ''}
          <span class="gal__lab mono">${p.season != null ? yLabel(p.season) : 'geen seizoen'}</span></button>`).join('')}
        <button type="button" class="gal__t gal__add" data-photo-add><span>+</span><span class="gal__lab mono">toevoegen</span></button>
      </div>
      <p class="muted" style="font-size:var(--fs-sm);margin:0">★ = hoofdfoto. In een oud seizoen toont de app de foto van dat seizoen.${linkUrl ? ' Zonder opgeslagen foto valt hij terug op je link.' : ''}</p>
    </details></section>`;
}

const seasonOptions = (sel) => {
  const out = ['<option value="">geen seizoen</option>'];
  for (let y = CURRENT_SEASON; y >= FIRST_YEAR; y--) out.push(`<option value="${y}" ${Number(sel) === y ? 'selected' : ''}>${yLabel(y)}</option>`);
  return out.join('');
};

function dialog(html) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet ph-sheet';
  dlg.innerHTML = `<div class="sheet__form">${html}</div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  dlg.showModal();
  return dlg;
}

/** Foto toevoegen: van je telefoon (meerdere tegelijk mag). */
function addSheet(ctx, o) {
  const dlg = dialog(`<div class="sheet__head"><span class="sheet__title">Foto toevoegen</span></div>
    <div class="btn-row"><label class="btn btn--primary" style="cursor:pointer">Kies van je telefoon<input type="file" accept="image/*" multiple data-ph-file hidden></label>
      ${o.linkUrl ? '<button class="btn" type="button" data-ph-link>Van de link binnenhalen</button>' : ''}</div>
    <div class="field-row"><label class="field"><span>Seizoen</span><select data-ph-season>${seasonOptions(CURRENT_SEASON)}</select></label></div>
    <label class="field field--check"><input type="checkbox" data-ph-main ${o.photos.length ? '' : 'checked'}> <span>Als hoofdfoto gebruiken</span></label>
    <p class="muted sheet__note">Wordt verkleind en privé opgeslagen in je eigen database. Een link (bijv. Transfermarkt) blijft de terugval als er geen opgeslagen foto is.</p>
    <p class="muted sheet__note" data-ph-msg></p>
    <div class="sheet__actions"><button class="btn" type="button" data-close>Sluiten</button></div>`);
  dlg.querySelector('[data-ph-link]')?.addEventListener('click', async (e) => {
    const msg = dlg.querySelector('[data-ph-msg]');
    e.currentTarget.disabled = true; msg.textContent = 'Binnenhalen via de Worker…';
    try {
      const r = await importFromLink(o, { season: dlg.querySelector('[data-ph-season]').value, asMain: dlg.querySelector('[data-ph-main]').checked });
      dlg.close(); toast(r.dup ? 'Deze foto staat er al in' : 'Foto van de link opgeslagen'); ctx.refresh();
    } catch (err) { msg.textContent = `Lukte niet: ${err.message || err}`; e.currentTarget.disabled = false; }
  });
  dlg.querySelector('[data-ph-file]').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const msg = dlg.querySelector('[data-ph-msg]');
    const season = dlg.querySelector('[data-ph-season]').value;
    const asMain = dlg.querySelector('[data-ph-main]').checked;
    let mainId = o.gallery && o.gallery.main ? o.gallery.main.id : null;
    const photos = o.photos.slice();
    try {
      for (let i = 0; i < files.length; i++) {
        msg.textContent = `Verkleinen en opslaan… ${i + 1} van ${files.length}`;
        const img = await prepareImage(files[i]);
        if (photos.some((p) => p.hash === img.hash)) { toast('Deze foto staat er al in'); continue; }
        const data = { owner: o.owner, season: season ? Number(season) : null, ...img, source: 'upload', sourceUrl: null, addedAt: new Date().toISOString() };
        const id = await addPhoto(data);
        photos.push({ id, ...data });
        if ((asMain && i === 0) || !mainId) mainId = id;
      }
      await writeGallery(o.kind, o.id, photos, mainId);
      dlg.close();
      toast(files.length > 1 ? `${files.length} foto's opgeslagen` : 'Foto opgeslagen');
      ctx.refresh();
    } catch (err) { msg.textContent = `Lukte niet: ${err.message || err}`; }
  });
}

/** Foto bekijken: seizoen aanpassen, hoofdfoto maken, verwijderen. */
function viewSheet(ctx, o, photoId) {
  const p = o.photos.find((x) => x.id === photoId);
  if (!p) return;
  const isMain = o.gallery && o.gallery.main && o.gallery.main.id === p.id;
  const dlg = dialog(`<img class="ph-big" src="${p.large}" alt="">
    <p class="muted sheet__note">${p.source === 'link' ? 'Binnengehaald van een link' : 'Zelf toegevoegd'} · ${esc(new Date(p.addedAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }))} · ${p.w}×${p.h}${isMain ? ' · ★ hoofdfoto' : ''}</p>
    <div class="field-row"><label class="field"><span>Seizoen</span><select data-ph-season>${seasonOptions(p.season)}</select></label></div>
    <div class="btn-row">${isMain ? '' : '<button class="btn btn--primary btn--sm" type="button" data-ph="main">★ Hoofdfoto maken</button>'}
      <button class="btn btn--sm btn--danger" type="button" data-ph="delete">Verwijderen</button>
      <button class="btn btn--sm" type="button" data-close>Sluiten</button></div>`);
  const mainId = () => (o.gallery && o.gallery.main ? o.gallery.main.id : null);
  dlg.querySelector('[data-ph-season]').addEventListener('change', async (e) => {
    const season = e.target.value ? Number(e.target.value) : null;
    try {
      await updatePhoto(p.id, { season });
      await writeGallery(o.kind, o.id, o.photos.map((x) => (x.id === p.id ? { ...x, season } : x)), mainId());
      toast('Seizoen aangepast'); dlg.close(); ctx.refresh();
    } catch (err) { toast(`Lukte niet: ${err.message || err}`); }
  });
  dlg.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ph]');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.ph === 'main') {
        await writeGallery(o.kind, o.id, o.photos, p.id);
        toast('Hoofdfoto ingesteld');
      } else {
        await deletePhoto(p.id);
        const rest = o.photos.filter((x) => x.id !== p.id);
        const nextMain = mainId() === p.id ? (rest[rest.length - 1] || {}).id || null : mainId();
        await writeGallery(o.kind, o.id, rest, nextMain);
        toast('Foto verwijderd');
      }
      dlg.close(); ctx.refresh();
    } catch (err) { toast(`Lukte niet: ${err.message || err}`); b.disabled = false; }
  });
}

/**
 * Laden voor een detailpagina. kind: 'player' | 'coach' | 'stadium'; gallery = verwijzing uit het eigenaar-document.
 * Geeft { owner, kind, id, photos, gallery } terug om aan heroImg/galleryHtml/mountPhotos te geven.
 */
export async function loadPhotos(kind, id, gallery, { linkUrl = null, linkCheck = null } = {}) {
  const owner = ownerKey(kind, id);
  const photos = await getPhotos(owner).catch(() => []);
  return { owner, kind, id: String(id), photos, gallery: gallery || null, linkUrl: linkUrl || null, linkCheck: linkCheck || null };
}

/** Knoppen: [data-photo-add] (toevoegen) en [data-photo-open] (bekijken). getO: () => object uit loadPhotos. */
export function mountPhotos(root, ctx, getO) {
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-photo-add]');
    const open = e.target.closest('[data-photo-open]');
    const la = e.target.closest('[data-link-act]');
    if (!add && !open && !la) return;
    const o = getO();
    if (!o) return;
    if (la) { linkAction(ctx, o, la.dataset.linkAct, la); return; }
    if (add) addSheet(ctx, o);
    else viewSheet(ctx, o, open.dataset.photoOpen);
  });
}

// ---------- Links binnenhalen en nieuwe versies volgen ----------

const LINK_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(transfermarkt\.(technology|nl|com|de|co\.uk|be)|tmssl\.akamaized\.net|cambuur\.nl)\//i;
export const importableLink = (url) => LINK_HOSTS.test(String(url || ''));
const bigTm = (url) => String(url || '').replace(/\/portrait\/(header|small|medium)\//, '/portrait/big/');

/** Plaatje achter de link ophalen (grote Transfermarkt-versie eerst). */
async function linkBlob(url) {
  const big = bigTm(url);
  try { return await fetchImage(big); } catch (err) { if (big === url) throw err; }
  return fetchImage(url);
}

/** Link binnenhalen als foto. Geeft { dup } terug. */
export async function importFromLink(o, { season = null, asMain = false } = {}) {
  if (!o.linkUrl) throw new Error('Geen link ingevuld');
  if (!importableLink(o.linkUrl)) throw new Error('Van deze site kan de app niet binnenhalen (alleen Transfermarkt en de clubsite)');
  const blob = await linkBlob(o.linkUrl);
  const img = await prepareImage(blob);
  await setOwnerLinkCheck(o.kind, o.id, { url: o.linkUrl, hash: img.hash, at: new Date().toISOString(), pending: null });
  if (o.photos.some((p) => p.hash === img.hash)) return { dup: true };
  const data = { owner: o.owner, season: season ? Number(season) : null, ...img, source: 'link', sourceUrl: o.linkUrl, addedAt: new Date().toISOString() };
  const id = await addPhoto(data);
  const mainId = asMain || !(o.gallery && o.gallery.main) ? id : o.gallery.main.id;
  await writeGallery(o.kind, o.id, [...o.photos, { id, ...data }], mainId);
  return { dup: false, id };
}

/** Banner als de foto achter de link veranderd is (gevonden door de wekelijkse controle). */
export function linkBanner(o) {
  const lc = o && o.linkCheck;
  if (!lc || !lc.pending || lc.url !== o.linkUrl) return '';
  const cur = o.gallery && o.gallery.main;
  return `<section class="section"><div class="ph-new">
      <div class="ph-new__imgs"><figure>${cur ? `<img src="${cur.thumb}" alt="">` : '<span class="ph-new__none">geen</span>'}<figcaption class="mono">huidige hoofdfoto</figcaption></figure>
        <figure><img src="${esc(bigTm(o.linkUrl))}" alt="" referrerpolicy="no-referrer" onerror="if(this.src!=='${esc(o.linkUrl)}')this.src='${esc(o.linkUrl)}'"><figcaption class="mono">nieuw · link</figcaption></figure></div>
      <p style="margin:0;font-size:var(--fs-md)"><strong>Nieuwe versie</strong> van de foto achter je link (gezien ${esc(new Date(lc.pending.at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }))}).</p>
      <div class="btn-row"><button class="btn btn--primary btn--sm" type="button" data-link-act="main">Als hoofdfoto</button>
        <button class="btn btn--sm" type="button" data-link-act="add">Alleen toevoegen</button>
        <button class="btn btn--sm" type="button" data-link-act="ignore">Negeren</button></div>
    </div></section>`;
}

async function linkAction(ctx, o, act, btn) {
  btn.disabled = true;
  try {
    if (act === 'ignore') {
      await setOwnerLinkCheck(o.kind, o.id, { ...o.linkCheck, hash: o.linkCheck.pending.hash, pending: null, at: new Date().toISOString() });
      toast('Genegeerd: deze versie meldt de app niet opnieuw');
    } else {
      const r = await importFromLink(o, { season: CURRENT_SEASON, asMain: act === 'main' });
      toast(r.dup ? 'Deze foto stond er al in' : act === 'main' ? 'Nieuwe hoofdfoto' : 'Toegevoegd aan de galerij');
    }
    ctx.refresh();
  } catch (err) { toast(`Lukte niet: ${err.message || err}`); btn.disabled = false; }
}

const WEEK = 7 * 864e5;
let checking = false;
/**
 * Hooguit eens per week (bij het openen van de app): per speler en trainer met een link kijken of het
 * plaatje veranderd is. Eerste keer: alleen onthouden. Veranderd: melding in de inbox + banner op de pagina.
 */
export async function checkLinks({ force = false, max = 80 } = {}) {
  if (checking) return null;
  const last = await getMeta('linkCheckRun').catch(() => null);
  if (!force && last && last.at && Date.now() - Date.parse(last.at) < WEEK) return null;
  checking = true;
  const out = { checked: 0, changed: 0, failed: 0 };
  try {
    const [players, coaches] = await Promise.all([getPlayers().catch(() => ({})), getCoaches().catch(() => [])]);
    const owners = [
      ...Object.entries(players).filter(([, pr]) => pr && !pr.linkedTo && importableLink(pr.photoUrl)).map(([id, pr]) => ({ kind: 'player', id, url: pr.photoUrl, lc: pr.photoLinkCheck, name: pr.fullName || pr.legacyName || pr.apiName || 'speler', href: `#/speler/${encodeURIComponent(id)}` })),
      ...coaches.filter((c) => importableLink(c.photoUrl)).map((c) => ({ kind: 'coach', id: c.id, url: c.photoUrl, lc: c.photoLinkCheck, name: `${c.firstname || ''} ${c.lastname || ''}`.trim(), href: `#/trainer/${encodeURIComponent(c.id)}` })),
    ].sort((a, b) => String((a.lc || {}).at || '').localeCompare(String((b.lc || {}).at || ''))).slice(0, max); // langst niet gecontroleerd eerst
    for (const o of owners) {
      try {
        const blob = await linkBlob(o.url);
        const hash = await sha(await blob.arrayBuffer());
        const now = new Date().toISOString();
        const lc = o.lc && o.lc.url === o.url ? o.lc : null;
        if (!lc) await setOwnerLinkCheck(o.kind, o.id, { url: o.url, hash, at: now, pending: null });
        else if (hash !== lc.hash && !(lc.pending && lc.pending.hash === hash)) {
          await setOwnerLinkCheck(o.kind, o.id, { ...lc, at: now, pending: { hash, at: now } });
          const { addMessage } = await import('./inbox.js');
          await addMessage({ id: `newphoto:${o.kind}:${o.id}:${hash}`, kind: 'info', title: `Nieuwe foto voor ${o.name}`, text: 'Het plaatje achter je foto-link is veranderd. Kies op de pagina: als hoofdfoto, alleen toevoegen of negeren.', href: o.href });
          out.changed++;
        } else await setOwnerLinkCheck(o.kind, o.id, { ...lc, at: now });
        out.checked++;
      } catch { out.failed++; }
    }
    await setMeta('linkCheckRun', { at: new Date().toISOString(), ...out });
    return out;
  } finally { checking = false; }
}
