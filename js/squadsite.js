// Clubsite-selectie: de Worker haalt de selectiepagina's één keer per dag op; hier vergelijken we met jouw selectie.
// Meer → Clubsite: pagina's instellen (eerste elftal / O21) en zien wat er uitgelezen werd.

import { esc, icons, toast } from './ui.js';
import { squad } from './api.js';
import { getMeta, setMeta } from './store.js';
import { addMessageOnce } from './inbox.js';
import { LINE_SHORT } from './players.js';
import { NAT_TOP, NAT_ALL, nationalities } from './flags.js';

// ---------- Namen vergelijken (ook gebruikt bij "Speler toevoegen") ----------
export const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Lijkt deze naam op iemand die je al hebt? Zelfde achternaam + zelfde eerste letter, of de ene naam zit in de andere. */
export function similarNames(name, known) {
  const n = normName(name); if (n.length < 3) return [];
  const parts = n.split(' '); const last = parts[parts.length - 1]; const first = parts[0][0];
  return known.filter((k) => {
    const m = normName(k.name); if (!m) return false;
    const mp = m.split(' ');
    return m === n || (mp[mp.length - 1] === last && last.length > 2 && mp[0][0] === first) || (n.length > 5 && (m.includes(n) || n.includes(m)));
  }).slice(0, 3);
}

// ---------- Snapshot ophalen (10 minuten in het geheugen) ----------
let cache = null;
export async function siteSnapshot({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.t < 10 * 60e3) return cache.v;
  const v = await squad.get().catch(() => null);
  cache = { t: Date.now(), v };
  return v;
}
export const dropSiteCache = () => { cache = null; };

/** Na het inloggen: nieuwe wijziging op de clubsite → één inboxmelding. */
export async function checkSquadSite() {
  const s = await siteSnapshot();
  if (!s || !s.snap || !s.snap.changedAt || !(s.pages || []).length) return;
  const seen = await getMeta('sqSeen').catch(() => null);
  if (seen && seen.changedAt === s.snap.changedAt) return;
  await setMeta('sqSeen', { changedAt: s.snap.changedAt });
  if (!seen) return; // eerste keer: niets te melden, dit is het beginpunt
  await addMessageOnce({ id: `squad:${s.snap.changedAt}`, kind: 'info', title: 'Clubsite: selectie gewijzigd', text: 'Er staat iets anders op de selectiepagina dan gisteren. Bekijk de verschillen op Selectie.', href: '#/selectie' });
}

// ---------- Vergelijken ----------
const LEVEL_TXT = { first: 'eerste elftal', o21: 'O21' };
const LAG_DAYS = 14; // zo lang mag de site achterlopen na een vertrek

/** "Nederlandse / Marokkaanse" → ['Nederlands', 'Marokkaans'] (alleen bekende nationaliteiten). */
const KNOWN_NATS = [...new Set([...NAT_TOP, ...NAT_ALL])];
export function natsFromSite(v) {
  return String(v || '').split(/\s*(?:\/|,|&|\ben\b|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean).map((x) => {
    const tries = [x, x.replace(/e$/i, ''), x.replace(/ese$/i, 'ees'), x.replace(/sche$/i, 'sch')];
    return KNOWN_NATS.find((n) => tries.some((t) => t.toLowerCase() === n.toLowerCase())) || null;
  }).filter(Boolean);
}

const dmyShort = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
function lastOut(pr) {
  return ((pr && pr.transfers) || []).filter((t) => (t.type === 'transfer-uit' || t.type === 'huur-uit') && t.date).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

/**
 * members: seasonMembers().members van het huidige seizoen; profiles: alle profielen (archief).
 * Geeft verschillen: { key, kind, id?, name, site?, app?, date? }
 * kind: missing | number | to-o21 | to-first | line | gone | left-listed
 */
export function compareSquad(snap, members, profiles = {}) {
  if (!snap || !snap.pages) return [];
  const byId = new Map(members.map((m) => [String(m.id), m]));
  // Iedereen die je kent: huidige selectie, vertrokken, verhuurd én het archief (zodat een oud-speler niet als "nieuw" verschijnt).
  const known = members.map((m) => ({ id: String(m.id), name: m.name }));
  Object.entries(profiles).forEach(([id, pr]) => {
    if (byId.has(id) || !pr || pr.linkedTo) return;
    const name = pr.fullName || pr.legacyName; if (name) known.push({ id, name, archived: true });
  });
  const today = Date.now();
  const out = []; const matched = new Set();
  snap.pages.forEach((page) => (page.players || []).forEach((sp) => {
    const hit = similarNames(sp.name, known)[0];
    if (!hit) { out.push({ key: `missing:${normName(sp.name)}`, kind: 'missing', name: sp.name, site: { ...sp, level: page.level } }); return; }
    matched.add(hit.id);
    const m = byId.get(hit.id);
    const pr = (m && m.profile) || profiles[hit.id] || null;
    // Volgens jou weg (of verhuurd), maar nog op de site
    if (!m || m.status === 'left' || m.status === 'loaned') {
      if (m && m.status === 'loaned') return; // verhuurde spelers laten clubs vaak gewoon staan
      const out1 = lastOut(pr);
      if (out1 && (today - Date.parse(`${out1.date}T12:00:00`)) / 864e5 < LAG_DAYS) return; // site loopt nog achter, normaal
      out.push({ key: `left-listed:${hit.id}`, kind: 'left-listed', id: hit.id, name: (m && m.name) || hit.name, date: out1 ? out1.date : null });
      return;
    }
    if (m.status === 'future') return;
    if (sp.number != null && m.number !== sp.number) out.push({ key: `number:${hit.id}:${sp.number}`, kind: 'number', id: hit.id, name: m.name, site: sp.number, app: m.number });
    if (page.level === 'o21' && m.status !== 'youth') out.push({ key: `to-o21:${hit.id}`, kind: 'to-o21', id: hit.id, name: m.name });
    if (page.level === 'first' && m.status === 'youth') out.push({ key: `to-first:${hit.id}`, kind: 'to-first', id: hit.id, name: m.name });
    if (sp.line && m.position && sp.line !== m.position) out.push({ key: `line:${hit.id}:${sp.line}`, kind: 'line', id: hit.id, name: m.name, site: sp.line, app: m.position });
    // Profiel van zijn spelerspagina: lege velden aanvullen, afwijkingen tonen
    const sprof = sp.url && snap.profiles && snap.profiles[sp.url];
    if (sprof) {
      const fill = {};
      const own = pr || {};
      if (sprof.dob) {
        if (!own.dob) fill.dob = sprof.dob;
        else if (own.dob !== sprof.dob) out.push({ key: `dob:${hit.id}:${sprof.dob}`, kind: 'dob', id: hit.id, name: m.name, site: sprof.dob, app: own.dob });
      }
      const sn = natsFromSite(sprof.nat);
      if (sn.length) {
        const mine = nationalities(own.nationality);
        if (!mine.length) fill.nationality = sn.join(' / ');
        else if (!sn.every((n) => mine.includes(n))) out.push({ key: `nat:${hit.id}:${sn.join('/')}`, kind: 'nat', id: hit.id, name: m.name, site: sn.join(' / '), app: mine.join(' / ') });
      }
      if (Object.keys(fill).length) out.push({ key: `fill:${hit.id}:${Object.entries(fill).map(([k, v]) => `${k}=${v}`).join(',')}`, kind: 'fill', id: hit.id, name: m.name, fill });
    }
  }));
  // Wie staat er niet (meer) op? Alleen als die pagina goed uitgelezen is.
  const okLevels = new Set(snap.pages.filter((p) => !p.error && (p.players || []).length >= 8).map((p) => p.level));
  members.forEach((m) => {
    if (matched.has(String(m.id)) || !['active', 'youth'].includes(m.status)) return;
    const lvl = m.status === 'youth' ? 'o21' : 'first';
    if (!okLevels.has(lvl)) return;
    out.push({ key: `gone:${m.id}`, kind: 'gone', id: String(m.id), name: m.name, app: lvl });
  });
  return out;
}

export async function ignoredKeys() {
  const m = await getMeta('sqIgnore').catch(() => null);
  return new Set((m && m.keys) || []);
}
export async function ignoreKey(key) {
  const keys = [...(await ignoredKeys()), key].slice(-300);
  await setMeta('sqIgnore', { keys });
}

// Per soort: uitleg + knoppen [label, actie]. Actie 'ignore' = deze ene afwijking verbergen.
const ACTION = {
  missing: (d) => [`Niet in je app${d.site.number != null ? ` · nr. ${d.site.number}` : ''}${d.site.line ? ` · ${LINE_SHORT[d.site.line]}` : ''} · ${LEVEL_TXT[d.site.level]}`, [['+ Toevoegen', 'add'], ['Negeren', 'ignore']]],
  number: (d) => [`Site: nr. ${d.site} · app: ${d.app ?? '–'}`, [[`Nr. ${d.site} overnemen`, 'number'], ['Negeren', 'ignore']]],
  'to-o21': () => ['Staat op de O21-pagina', [['Naar O21', 'level'], ['Mijn keuze houden', 'ignore']]],
  'to-first': () => ['Staat op de pagina van het eerste elftal', [['Naar eerste elftal', 'level'], ['Mijn keuze houden', 'ignore']]],
  line: (d) => [`Site: ${LINE_SHORT[d.site]} · app: ${LINE_SHORT[d.app] || '–'}`, [['Positie overnemen', 'line'], ['Negeren', 'ignore']]],
  gone: (d) => [`Niet (meer) op de ${LEVEL_TXT[d.app]}-pagina`, [['Vertrokken', 'out'], ['Verhuurd', 'loan'], ['Is er nog', 'ignore']]],
  fill: (d) => [`Profiel aanvullen: ${[d.fill.dob ? `geboren ${dmyShort(d.fill.dob)}` : '', d.fill.nationality || ''].filter(Boolean).join(', ')}`, [['Aanvullen', 'fill'], ['Negeren', 'ignore']]],
  dob: (d) => [`Geboortedatum site: ${dmyShort(d.site)} · app: ${dmyShort(d.app)}`, [['Overnemen', 'dob'], ['Mijn waarde houden', 'ignore']]],
  nat: (d) => [`Nationaliteit site: ${d.site} · app: ${d.app}`, [['Overnemen', 'nat'], ['Mijn waarde houden', 'ignore']]],
  'left-listed': (d) => [`Volgens jou vertrokken${d.date ? ` op ${dmyShort(d.date)}` : ''}, staat nog op de site`, [['Site loopt achter', 'ignore'], ['Toch nog bij de club', 'open']]],
};

/** Blok voor Selectie. */
export function siteBlock(diffs, snap) {
  if (!snap) return '';
  const when = snap.at ? new Date(snap.at).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  if (!diffs.length) {
    return `<section class="section"><div class="section__label"><span>Volgens de clubsite</span><span>${esc(when)}</span></div>
      <p class="muted" style="font-size:13px;margin:0">Alles klopt met de selectiepagina's. <a href="#/clubsite">Pagina's</a></p></section>`;
  }
  const fills = diffs.filter((d) => d.kind === 'fill').length;
  return `<section class="section"><div class="section__label"><span>Volgens de clubsite</span><span>${diffs.length} · ${esc(when)}</span></div>
    ${fills > 1 ? `<div><button class="btn btn--sm btn--primary" type="button" data-sq-fillall>Alle lege profielvelden aanvullen (${fills} spelers)</button></div>` : ''}
    <div class="list">${diffs.map((d) => {
      const [txt, btns] = ACTION[d.kind](d);
      return `<div class="list-row site-row"><span class="list-row__main"><span class="list-row__title">${d.id ? `<a href="#/speler/${encodeURIComponent(d.id)}">${esc(d.name)}</a>` : esc(d.name)}</span><span class="list-row__sub">${esc(txt)}</span></span>
        <span class="site-row__btns">${btns.map(([l, a], i) => `<button class="btn btn--sm ${i ? 'btn--ghost' : ''}" type="button" data-sq-fix="${esc(d.key)}" data-sq-act="${a}">${esc(l)}</button>`).join('')}</span></div>`;
    }).join('')}</div>
    <p class="muted" style="font-size:12px">De site heeft niet altijd gelijk: jij beslist. Verbergen geldt alleen voor die ene afwijking; verandert de site iets aan die speler, dan zie je het weer. <a href="#/clubsite">Pagina's</a></p></section>`;
}

// ---------- Meer → Clubsite ----------
function head() {
  return `<header class="page-head"><div class="page-head__titles"><a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
    <span class="page-head__kicker">Meer / Clubsite</span><h1 class="page-head__title">Selectiepagina's</h1></div></header>`;
}

export const squadSiteViews = {
  clubsite: {
    title: 'Clubsite',
    navKey: 'meer',
    async render() {
      const s = await siteSnapshot({ fresh: true });
      if (!s) return `${head()}<section class="section"><p class="muted">De Worker is niet bereikbaar. Probeer het straks opnieuw.</p></section>`;
      const pages = s.pages.length ? s.pages : [];
      const res = (url) => ((s.snap && s.snap.pages) || []).find((p) => p.url === url);
      return `${head()}
        <section class="section">
          <p class="muted" style="font-size:13px">De Worker leest deze pagina's elke ochtend om 07:00. Geen Highlightly-calls. Verschillen met je selectie zie je op Selectie; jij beslist wat je overneemt.</p>
          <div class="list" data-sq-pages>${pages.map((p, i) => pageRow(p, i, res(p.url))).join('')}</div>
          <div class="btn-row"><button class="btn btn--sm" type="button" data-sq-add>+ Pagina</button>
          <button class="btn btn--sm btn--primary" type="button" data-sq-save>Opslaan en nu ophalen</button></div>
        </section>
        ${s.snap ? `<section class="section"><div class="section__label"><span>Laatst opgehaald</span><span>${esc(new Date(s.snap.at).toLocaleString('nl-NL'))}</span></div>
          ${(s.snap.pages || []).map((p) => `<details class="fold"><summary><span>${esc(LEVEL_TXT[p.level])} · ${p.error ? esc(p.error) : `${p.players.length} ${p.players.length === 1 ? 'speler' : 'spelers'}`}</span></summary>
            <p class="muted" style="font-size:12px;word-break:break-all">${esc(p.url)}</p>
            <div class="list">${(p.players || []).map((x) => `<div class="kv-line"><span>${esc(x.name)}</span><span class="mono muted">${x.number ?? '–'}${x.line ? ` · ${esc(LINE_SHORT[x.line])}` : ''}</span></div>`).join('')}</div></details>`).join('')}
        </section>` : ''}`;
    },
    mount(root, ctx) {
      const list = root.querySelector('[data-sq-pages]');
      root.querySelector('[data-sq-add]').addEventListener('click', () => {
        list.insertAdjacentHTML('beforeend', pageRow({ url: '', level: 'first' }, list.children.length, null));
      });
      list.addEventListener('click', (e) => { const b = e.target.closest('[data-sq-del]'); if (b) b.closest('.sq-page').remove(); });
      root.querySelector('[data-sq-save]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const pages = [...list.querySelectorAll('.sq-page')].map((r) => ({ url: r.querySelector('input').value.trim(), level: r.querySelector('select').value })).filter((p) => p.url);
        if (pages.some((p) => !/^https:\/\/\S+$/.test(p.url))) { toast('Elke link moet met https:// beginnen.'); return; }
        btn.disabled = true; btn.textContent = 'Ophalen…';
        try {
          await squad.setPages(pages);
          const r = await squad.refresh();
          dropSiteCache();
          const n = (r.snap.pages || []).reduce((t, p) => t + (p.players || []).length, 0);
          toast(`${n} spelers gevonden op ${pages.length} ${pages.length === 1 ? 'pagina' : "pagina's"}`);
          ctx.refresh();
        } catch (err) { toast(`Lukte niet: ${err.message || err}`); btn.disabled = false; btn.textContent = 'Opslaan en nu ophalen'; }
      });
    },
  },
};

function pageRow(p, i, res) {
  return `<div class="sq-page"><input type="url" inputmode="url" placeholder="https://club.nl/selectie/" value="${esc(p.url)}" aria-label="Link">
    <select aria-label="Selectie"><option value="first" ${p.level === 'first' ? 'selected' : ''}>Eerste elftal</option><option value="o21" ${p.level === 'o21' ? 'selected' : ''}>O21</option></select>
    <button class="btn btn--sm btn--ghost" type="button" data-sq-del aria-label="Verwijderen">✕</button>
    ${res ? `<span class="muted sq-page__res">${res.error ? esc(res.error) : `${res.players.length} ${res.players.length === 1 ? 'speler' : 'spelers'}`}</span>` : ''}</div>`;
}
