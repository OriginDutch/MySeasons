// Oude export importeren (cambuur_tracker_data.json). Het bestand wordt alleen in je browser gelezen.
// Nu: spelers. Ze worden gekoppeld aan hun Highlightly-id; wie (nog) niet in Highlightly-data staat,
// wordt bewaard als oud-speler (legacy-<id>) en kan later alsnog gekoppeld worden.

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getAllMatches, getPlayers, getNotes, savePlayersBatch } from './store.js';
import { applyCorrections } from './corrections.js';
import { buildSquad } from './players.js';
import { tokens } from './rsssf.js';

let loaded = null; // { fileName, data } — alleen in het geheugen

const POS = { Keeper: 'Goalkeeper', Verdediger: 'Defender', Middenvelder: 'Midfielder', Aanvaller: 'Forward' };

const clean = (v) => (v === '' || v === undefined ? null : v);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Oude speler → profielvelden. Namen laten we bij Highlightly/jouw naamkeuze; de oude naam bewaren we. */
export function legacyProfile(p) {
  return {
    legacyId: p.id,
    legacyName: `${p.firstname || ''} ${p.lastname || ''}`.trim(),
    firstName: clean(p.firstname), lastName: clean(p.lastname),
    shirt: num(p.number),
    dob: clean(p.dob), nationality: clean(p.nationality),
    position: POS[p.position] || clean(p.position), subPositions: p.subpos || [],
    foot: clean(p.foot), height: num(p.height),
    joined: clean(p.joined), contractUntil: clean(p.contract),
    photoUrl: clean(p.photo),
    note: clean(p.note),
    valueHistory: (p.valueHistory || []).map((v) => ({ date: v.date, amount: num(v.amount), note: clean(v.note) })).filter((v) => v.date)
      .sort((a, b) => b.date.localeCompare(a.date)),
    transfers: (p.transfers || []).map((t) => ({ type: t.type, club: clean(t.club), date: clean(t.date), dateTo: clean(t.dateTo), amount: num(t.amount), note: clean(t.note) })),
    injuries: (p.injuries || []).map((i) => ({ ...i })),
    importedAt: new Date().toISOString(),
  };
}

/** Beste Highlightly-kandidaat voor een oude speler: achternaam moet kloppen, voornaam/initiaal en rugnummer helpen. */
export function suggest(p, squad) {
  const last = tokens(p.lastname).filter((t) => !['van', 'der', 'de', 'den', 'het', 'ter', 'te'].includes(t));
  const first = tokens(p.firstname)[0] || '';
  if (!last.length) return null;
  const scored = squad.map((s) => {
    const t = tokens(s.apiName || s.name);
    if (!last.every((x) => t.includes(x))) return { s, score: 0 };
    let score = 2;
    if (first && t.includes(first)) score += 2;
    else if (first && t.some((x) => x.length === 1 && x === first[0])) score += 1;
    if (num(p.number) != null && s.number === num(p.number)) score += 1;
    return { s, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored[1] && scored[1].score === scored[0].score) return null; // twijfel: jij kiest
  return scored[0].s.id;
}

async function currentSquad() {
  const all = await getAllMatches();
  const withNotes = await Promise.all(all.map(async (m) => (m.detail ? applyCorrections(m, await getNotes(m.id).catch(() => null)).match : m)));
  const seasons = [...new Set(withNotes.map((m) => m.league && m.league.season).filter((x) => x != null))];
  const byId = new Map();
  seasons.forEach((y) => buildSquad(withNotes.filter((m) => m.league && m.league.season === y), MAIN_CLUB.id).players.forEach((p) => {
    if (!byId.has(p.id)) byId.set(p.id, { ...p, seasons: [y] }); else byId.get(p.id).seasons.push(y);
  }));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(String(r.result).replace(/^﻿/, ''))); } catch (e) { reject(new Error('Dit is geen geldig JSON-bestand')); } };
    r.onerror = () => reject(new Error('Bestand lezen lukte niet'));
    r.readAsText(file);
  });
}

const CATS = [
  ['players', 'Spelers', 'profiel, contract, marktwaarde, transfers, blessures', true],
  ['notes', 'Wedstrijdnotities, MOTM en trainer', 'koppelen op datum + tegenstander', false],
  ['coaches', 'Trainers en aanstellingen', '', false],
  ['clubs', 'Rivalen en clubgegevens', '', false],
];

function head() {
  return `<header class="page-head"><div class="page-head__titles">
    <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
    <span class="page-head__kicker">Meer / Importeren</span><h1 class="page-head__title">Importeren</h1></div></header>`;
}

export const importViews = {
  importeren: {
    title: 'Importeren',
    navKey: 'meer',
    async render() {
      if (!loaded) {
        return `${head()}
          <section class="section">
            <p class="muted" style="font-size:13px">Kies de JSON-export van je oude Cambuur Tracker. Het bestand wordt alleen hier in je browser gelezen; er gaat niets naar een server behalve wat je straks zelf importeert naar je eigen Firestore.</p>
            <label class="btn btn--primary" style="align-self:flex-start;cursor:pointer">Export kiezen<input type="file" accept=".json,application/json" data-file hidden></label>
          </section>`;
      }
      const d = loaded.data;
      const squad = await currentSquad();
      const profiles = await getPlayers().catch(() => ({}));
      const linkedLegacy = new Map(Object.entries(profiles).filter(([, p]) => p.legacyId).map(([id, p]) => [p.legacyId, id]));
      const players = (d.players || []).slice().sort((a, b) => (a.lastname || '').localeCompare(b.lastname || ''));
      const options = (sel) => `<option value="">Oud-speler (niet koppelen)</option>${squad.map((s) => `<option value="${s.id}" ${String(sel) === String(s.id) ? 'selected' : ''}>${esc(s.name)}${s.number != null ? ' #' + s.number : ''}</option>`).join('')}`;
      return `${head()}
        <section class="section">
          <div class="section__label"><span>${esc(loaded.fileName)}</span><span>export ${esc(String(d.exported || '').slice(0, 10))}</span></div>
          <div class="list">${CATS.map(([k, l, sub, ready]) => `<label class="dev" style="cursor:${ready ? 'pointer' : 'default'}">
            <input type="checkbox" name="cat" value="${k}" ${ready ? 'checked' : 'disabled'}>
            <span class="dev__main"><span class="dev__what">${esc(l)} ${ready ? '' : '<span class="dev__badge">komt</span>'}</span>
            <span class="dev__vals muted">${esc(sub)}${k === 'players' ? ` · ${players.length} spelers` : ''}</span></span></label>`).join('')}</div>
        </section>
        <section class="section">
          <div class="section__label"><span>Spelers koppelen</span><span>${squad.length} Highlightly-spelers bekend</span></div>
          <p class="muted" style="font-size:12px">De app stelt per speler een koppeling voor op naam en rugnummer. Klopt iets niet, kies dan zelf. "Oud-speler" bewaart alles zonder koppeling; dat kan later alsnog, als hij in een opgehaald seizoen voorkomt.${squad.length ? '' : ' Er zijn nog geen wedstrijddetails opgehaald, dus koppelen kan nog niet: alles wordt eerst oud-speler.'}</p>
          <div class="link-list">${players.map((p) => {
            const pre = linkedLegacy.get(p.id) || suggest(p, squad) || '';
            const out = (p.transfers || []).find((t) => /uit/.test(t.type || ''));
            return `<div class="link-row">
              <span class="link-row__old"><b>${esc(`${p.firstname || ''} ${p.lastname || ''}`.trim())}</b>
                <small class="muted">${p.number ? '#' + esc(String(p.number)) + ' · ' : ''}${esc(p.position || '')}${out ? ` · vertrokken ${esc(String(out.date || '').slice(0, 7))}` : ''}</small></span>
              <select data-link="${esc(p.id)}" aria-label="Koppelen">${options(pre)}</select>
            </div>`;
          }).join('')}</div>
        </section>
        <div class="dev-bar">
          <span class="dev-bar__all" data-link-count></span>
          <button class="btn" type="button" data-cancel-import>Ander bestand</button>
          <button class="btn btn--primary" type="button" data-do-import>Importeren</button>
        </div>`;
    },
    mount(root, ctx) {
      const file = root.querySelector('[data-file]');
      if (file) {
        file.addEventListener('change', async () => {
          try {
            const data = await readFile(file.files[0]);
            if (!Array.isArray(data.players)) throw new Error('Geen spelers gevonden; is dit de export van de Cambuur Tracker?');
            loaded = { fileName: file.files[0].name, data };
            ctx.refresh();
          } catch (err) { toast(err.message); }
        });
        return;
      }
      const count = () => {
        const sel = [...root.querySelectorAll('[data-link]')];
        const n = sel.filter((s) => s.value).length;
        root.querySelector('[data-link-count]').textContent = `${n} gekoppeld · ${sel.length - n} oud-speler`;
      };
      root.addEventListener('change', (e) => { if (e.target.matches('[data-link]')) count(); });
      count();
      root.querySelector('[data-cancel-import]').addEventListener('click', () => { loaded = null; ctx.refresh(); });
      root.querySelector('[data-do-import]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const byOld = new Map(loaded.data.players.map((p) => [p.id, p]));
          const writes = [];
          root.querySelectorAll('[data-link]').forEach((s) => {
            const p = byOld.get(s.dataset.link);
            if (!p) return;
            const prof = legacyProfile(p);
            if (s.value) {
              writes.push([s.value, prof]);
              writes.push([`legacy-${p.id}`, { ...prof, linkedTo: Number(s.value) }]);
            } else {
              writes.push([`legacy-${p.id}`, { ...prof, linkedTo: null }]);
            }
          });
          await savePlayersBatch(writes);
          const linked = writes.filter(([id]) => !String(id).startsWith('legacy-')).length;
          toast(`${byOld.size} spelers geïmporteerd · ${linked} gekoppeld aan Highlightly`, { duration: 6000 });
          loaded = null;
          location.hash = '#/selectie';
        } catch (err) {
          toast(`Importeren lukte niet: ${err.message || err}`);
          btn.disabled = false;
        }
      });
    },
  },
};
