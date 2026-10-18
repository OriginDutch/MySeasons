// Oude export importeren (cambuur_tracker_data.json). Het bestand wordt alleen in je browser gelezen.
// Spelers worden gekoppeld aan hun Highlightly-id; wie (nog) niet in Highlightly-data staat,
// wordt bewaard als oud-speler (legacy-<id>) en kan later alsnog gekoppeld worden.
// Wedstrijdnotities, MOTM en trainer koppelen op datum (±1 dag) + tegenstander. Alles is opnieuw
// te draaien: dezelfde documenten worden bijgewerkt, jouw eigen notities worden nooit overschreven.

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getAllMatches, getPlayers, getNotes, getAllNotes, savePlayersBatch, saveNotesBatch, saveCoachesBatch, saveClubMarksBatch, getAllLeagueTeams } from './store.js';
import { applyCorrections } from './corrections.js';
import { buildSquad } from './players.js';
import { tokens } from './rsssf.js';
import { coachOn } from './coaches.js';

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
    squadLevel: clean(p.squadLevel),
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
  ['coaches', 'Trainers en aanstellingen', 'voor de trainer per wedstrijd', true],
  ['notes', 'Wedstrijdnotities, MOTM en trainer', 'koppelen op datum + tegenstander', true],
  ['clubs', 'Rivalen en clubmarkeringen', 'rivaal, interessant, notitie', true],
];

const sameClub = (a, b) => {
  const x = tokens(a); const y = tokens(b);
  if (!x.length || !y.length) return false;
  return x.every((t) => y.includes(t)) || y.every((t) => x.includes(t));
};
const dayDiff = (a, b) => Math.abs((Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 864e5);

/** Oude Cambuur-wedstrijden met MOTM, notitie of trainer → matchNotes van de bijbehorende app-wedstrijd. */
export function planNotes(data, matches, legacyToHl, existingNotes, coaches = []) {
  const clubName = Object.fromEntries((data.clubs || []).map((c) => [c.id, c.name]));
  const own = (data.clubs || []).find((c) => c.isOwnClub);
  const ownId = own ? own.id : null;
  const players = Object.fromEntries((data.players || []).map((p) => [p.id, `${p.firstname || ''} ${p.lastname || ''}`.trim()]));
  const old = (data.matches || []).filter((m) => ownId && [m.homeClubId, m.awayClubId].includes(ownId) && (m.motm || m.notes || m.coachId || m.captain));
  const writes = []; const unmatched = []; let keptNote = 0; let coachSkipped = 0;
  old.forEach((m) => {
    const home = m.homeClubId === ownId;
    const opp = home ? (m.awayName || clubName[m.awayClubId]) : (m.homeName || clubName[m.homeClubId]);
    const hit = matches.find((x) => dayDiff(x.date, m.date) <= 1 && sameClub(((x.homeTeam.id === MAIN_CLUB.id) ? x.awayTeam : x.homeTeam).name, opp));
    if (!hit) { unmatched.push(`${m.date} ${opp}`); return; }
    const ex = existingNotes[hit.id] || {};
    const w = { legacyMatchId: m.id };
    // Aanstellingen (met datums) zijn leidend; een trainer per wedstrijd nemen we alleen over als die er niets over zeggen.
    if (m.coachId) { if (coachOn(coaches, hit.date)) coachSkipped++; else w.coachId = m.coachId; }
    if (m.motm) w.motm = { legacyId: m.motm, playerId: legacyToHl[m.motm] ? Number(legacyToHl[m.motm]) : null, name: players[m.motm] || null };
    if (m.captain) w.legacyCaptain = m.captain;
    if (m.notes) { if (ex.note && ex.note !== m.notes) keptNote++; else w.note = m.notes; }
    writes.push([hit.id, w]);
  });
  return { writes, unmatched, keptNote, coachSkipped, total: old.length };
}

export function planCoaches(data) {
  return (data.coaches || []).map((c) => ({
    id: c.id, legacyId: c.id, firstname: clean(c.firstname), lastname: clean(c.lastname), dob: clean(c.dob),
    nationality: clean(c.nationality), photoUrl: clean(c.photo),
    appointments: (c.appointments || []).map((a) => ({ role: a.role || null, from: clean(a.from), to: clean(a.to), order: a.order ?? null })),
  }));
}

/** Rivaal/interessant/notitie → Highlightly-team-id, op naam. */
export function planClubs(data, teams) {
  const marks = (data.clubs || []).filter((c) => !c.isOwnClub && (c.highlight || c.note));
  const writes = []; const unmatched = [];
  marks.forEach((c) => {
    const t = teams.find((x) => sameClub(x.name, c.name));
    if (!t) { unmatched.push(c.name); return; }
    writes.push([t.id, { mark: c.highlight || null, note: c.note || null, legacyName: c.name, stadium: null }]);
  });
  return { writes, unmatched };
}

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
          const cats = new Set([...root.querySelectorAll('input[name="cat"]:checked')].map((i) => i.value));
          const report = [];
          if (cats.has('players')) {
            await savePlayersBatch(writes);
            const linked = writes.filter(([id]) => !String(id).startsWith('legacy-')).length;
            report.push(`${byOld.size} spelers (${linked} gekoppeld)`);
          }
          if (cats.has('coaches')) {
            const cs = planCoaches(loaded.data);
            if (cs.length) await saveCoachesBatch(cs);
            report.push(`${cs.length} trainers`);
          }
          if (cats.has('notes')) {
            const legacyToHl = {};
            root.querySelectorAll('[data-link]').forEach((s) => { if (s.value) legacyToHl[s.dataset.link] = s.value; });
            const [matches, notes] = await Promise.all([getAllMatches(), getAllNotes()]);
            const plan = planNotes(loaded.data, matches, legacyToHl, notes, planCoaches(loaded.data));
            if (plan.writes.length) await saveNotesBatch(plan.writes);
            report.push(`${plan.writes.length}/${plan.total} wedstrijden aangevuld${plan.unmatched.length ? ` (${plan.unmatched.length} niet gevonden: seizoen nog niet opgehaald?)` : ''}${plan.keptNote ? `, ${plan.keptNote} eigen notitie behouden` : ''}`);
          }
          if (cats.has('clubs')) {
            const teams = await getAllLeagueTeams();
            const plan = planClubs(loaded.data, teams);
            if (plan.writes.length) await saveClubMarksBatch(plan.writes);
            report.push(`${plan.writes.length} clubmarkeringen${plan.unmatched.length ? ` (${plan.unmatched.length} clubs niet herkend)` : ''}`);
          }
          toast(`Geïmporteerd: ${report.join(' · ')}`, { duration: 9000 });
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
