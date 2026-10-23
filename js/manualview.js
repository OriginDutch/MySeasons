// #/invullen/{id}: wedstrijddetails zelf invullen in vier stappen (opstelling, wissels, goals, kaarten + extra).
// Alleen de eigen club. Opslag en omzetting: manual.js. Een concept blijft per wedstrijd in deze sessie bewaard.

import { esc, toast } from './ui.js';
import { getMatch, getNotes, saveManual, saveCorrections, getAllMatches, getAllNotes, attachDetails, saveMatches, deleteMatch, saveNotesBatch } from './store.js';
import { MAIN_CLUB } from './config.js';
import { applyCorrections, buildChanges } from './corrections.js';
import { correctedList, head } from './matchviews.js';
import { buildSquad, LINES } from './players.js';
import { statusIn, seasonWindow } from './membership.js';
import { seasonOf, seasonLabel, getSeason } from './seasonstate.js';
import { clubField, knownTeams, matchTeam } from './clubpick.js';
import { LEAGUES } from './leagues.js';
import { seasonOfDate } from './shirts.js';
import { levelFor, shirtFor } from './shirts.js';
import { roleFor, lineOfRole } from './roles.js';
import { opponentOf, dayShort, twinOf, stateWord } from './season.js';
import { openSheet } from './editor.js';
import { FORMATIONS, idv, manualScore, manualWarnings, compareManual } from './manual.js';

const TEAM = MAIN_CLUB.id;
const LINE_ORDER = Object.fromEntries(LINES.map(([k], i) => [k, i]));
const LINE_ABBR = { Goalkeeper: 'K', Defender: 'V', Midfielder: 'M', Forward: 'A' };
const isOfficial = (m) => m.league && !/friendl/i.test(m.league.name);
const draftKey = (id) => `ms-manual-draft-${id}`;
const at = (e) => (e.minute ?? 0) + (e.extra ?? 0) / 100;
const minLabel = (e) => `${e.minute ?? '?'}${e.extra ? '+' + e.extra : ''}'`;

let S = null; // { id, match, notes, cands: Map, draft, step, form, filter, official, opp }

const emptyDraft = () => ({ formation: null, venue: null, referee: null, source: null, starters: [], subs: [], goals: [], cards: [] });

function loadDraft(id, saved) {
  try { const d = JSON.parse(sessionStorage.getItem(draftKey(id)) || 'null'); if (d) return { ...emptyDraft(), ...d }; } catch { /* geen concept */ }
  return saved ? JSON.parse(JSON.stringify({ ...emptyDraft(), ...saved })) : emptyDraft();
}
const keepDraft = () => { try { sessionStorage.setItem(draftKey(S.id), JSON.stringify(S.draft)); } catch { /* niet erg */ } };
const dropDraft = (id) => { try { sessionStorage.removeItem(draftKey(id)); } catch { /* niet erg */ } };

/** Kandidaten: wie in dat seizoen bij de club hoorde (opstellingen + profielen met een periode), plus eerder ingevulde namen. */
async function candidates(m, manual) {
  const season = seasonOf(m);
  const { list, profiles } = await correctedList(season);
  const out = new Map();
  const add = (c) => { const k = String(c.id); if (!out.has(k)) out.set(k, c); };
  const lineOf = (pr, fallback) => lineOfRole(roleFor(pr, season)) || (pr && ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'].includes(pr.position) && pr.position) || fallback || '';
  buildSquad(list, TEAM, profiles).players.forEach((p) => add({ id: p.id, name: p.name, number: p.number, line: p.position || '', youth: levelFor(p.profile, season) === 'o21' }));
  const win = seasonWindow(season, list.filter(isOfficial));
  Object.entries(profiles).forEach(([k, pr]) => {
    if (!pr || pr.linkedTo) return;
    const st = statusIn(pr, win, win.end);
    if (!st.member) return;
    add({ id: idv(k), name: pr.fullName || pr.legacyName || pr.apiName || `speler ${k}`, number: shirtFor(pr, season), line: lineOf(pr), youth: levelFor(pr, season) === 'o21' });
  });
  const extra = (id, name) => { if (id != null && !out.has(String(id))) add({ id, name: name || '?', number: null, line: '', youth: false, extra: true }); };
  (manual.starters || []).forEach((p) => extra(p.id, p.name));
  (manual.subs || []).forEach((s) => { extra(s.inId, s.inName); extra(s.outId, s.outName); });
  return out;
}

const cand = (id) => S.cands.get(String(id));
const nameOf = (id) => (cand(id) ? cand(id).name : '?');
const sortC = (a, b) => (a.youth - b.youth) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0) || (LINE_ORDER[a.line] ?? 9) - (LINE_ORDER[b.line] ?? 9) || (a.number ?? 99) - (b.number ?? 99) || a.name.localeCompare(b.name, 'nl');
const starterIds = () => new Set(S.draft.starters.map((p) => String(p.id)));
/** Iedereen die in het veld stond (basis + invallers). */
const played = () => {
  const ids = [...S.draft.starters.map((p) => String(p.id))];
  S.draft.subs.forEach((s) => { if (s.inId != null && !ids.includes(String(s.inId))) ids.push(String(s.inId)); });
  return ids.map((id) => cand(id)).filter(Boolean);
};
const opts = (list, sel, empty = '—') => `<option value="">${esc(empty)}</option>${list.map((c) => `<option value="${esc(String(c.id))}" ${String(sel ?? '') === String(c.id) ? 'selected' : ''}>${c.number != null ? c.number + ' · ' : ''}${esc(c.name)}</option>`).join('')}`;
const numIn = (name, v, ph = 'min', max = 130) => `<input name="${name}" type="number" inputmode="numeric" min="0" max="${max}" placeholder="${ph}" value="${v ?? ''}" data-f="${name}">`;

const minRow = (F) => `<div class="field-row"><label class="field"><span>Minuut</span>${numIn('minute', F.minute)}</label><label class="field"><span>Blessuretijd (+)</span>${numIn('extra', F.extra, 'mag leeg', 20)}</label></div>`;

const STEPS = ['Basiself', 'Wissels', 'Goals', 'Kaarten en extra'];

function stepBar() {
  return `<div class="mv-steps">${STEPS.map((_, i) => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('')}</div>
    <div class="page-head__kicker" style="margin-bottom:4px">Stap ${S.step + 1} van 4</div><h2 class="mv-title">${STEPS[S.step]}</h2>`;
}

function step1() {
  const chosen = starterIds();
  const f = (S.filter || '').toLowerCase();
  const all = [...S.cands.values()].sort(sortC).filter((c) => !f || c.name.toLowerCase().includes(f) || String(c.number ?? '') === f);
  const groups = [['Selectie', all.filter((c) => !c.youth && !c.extra)], ['O21', all.filter((c) => c.youth && !c.extra)], ['Zelf toegevoegd', all.filter((c) => c.extra)]];
  return `${stepBar()}
    <div class="field-row"><label class="field"><span>Formatie</span><select data-formation><option value="">onbekend</option>${FORMATIONS.map((x) => `<option ${S.draft.formation === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field"><span>Zoeken</span><input type="search" data-filter placeholder="naam of nummer" value="${esc(S.filter || '')}"></label></div>
    <div class="section__label"><span>Gekozen</span><span data-count class="${chosen.size === 11 ? '' : 'mv-warn'}">${chosen.size} / 11</span></div>
    ${groups.filter(([, l]) => l.length).map(([title, l]) => `${title !== 'Selectie' ? `<div class="section__label"><span>${title}</span><span>${l.length}</span></div>` : ''}
      <div class="list">${l.map((c) => `<label class="list-row mv-pick"><input type="checkbox" data-start="${esc(String(c.id))}" ${chosen.has(String(c.id)) ? 'checked' : ''}>
        <span class="mono muted mv-nr">${c.number ?? ''}</span><span class="list-row__title">${esc(c.name)}</span><span class="muted mv-line">${LINE_ABBR[c.line] || ''}</span></label>`).join('')}</div>`).join('')}
    ${!all.length ? '<p class="muted">Niemand gevonden.</p>' : ''}
    <div class="mv-add"><input data-trial placeholder="Proefspeler: naam" maxlength="60"><button class="btn btn--sm" type="button" data-add-trial>+ Proefspeler</button></div>`;
}

function step2() {
  const F = S.form;
  const onField = played();
  // Erin: wie niet in het veld staat. Bij een oefenduel mag een gewisselde speler terug.
  const onIds = new Set(starterIds()); const outIds = new Set();
  S.draft.subs.slice().sort((a, b) => at(a) - at(b)).forEach((x) => { if (x.outId != null) { onIds.delete(String(x.outId)); outIds.add(String(x.outId)); } if (x.inId != null) onIds.add(String(x.inId)); });
  const ins = [...S.cands.values()].sort(sortC).filter((c) => !onIds.has(String(c.id)) && (!S.official || !outIds.has(String(c.id))));
  const subs = S.draft.subs.slice().sort((a, b) => at(a) - at(b));
  return `${stepBar()}
    ${subs.length ? `<div class="list">${subs.map((s) => `<div class="list-row mv-item"><span class="mono mv-min">${minLabel(s)}</span>
      <span class="list-row__main"><span class="list-row__title">↑ ${esc(s.inName || '?')} <span class="muted">voor</span> ${esc(s.outName || '?')}</span></span>
      <button class="btn btn--sm" type="button" data-del="subs" data-i="${S.draft.subs.indexOf(s)}" aria-label="Weghalen">×</button></div>`).join('')}</div>` : '<p class="muted">Nog geen wissels.</p>'}
    <div class="section__label"><span>Nieuwe wissel</span></div>
    <label class="field"><span>Erin</span><select data-f="in">${opts(ins, F.in)}</select></label>
    <label class="field"><span>Eruit</span><select data-f="out">${opts(onField, F.out)}</select></label>
    ${minRow(F)}
    <div><button class="btn btn--sm" type="button" data-add="subs">+ Toevoegen</button></div>
    <p class="muted" style="font-size:var(--fs-sm)">${S.official ? 'Officieel duel: de app waarschuwt bij meer dan 5 wissels (6 met verlenging) of een speler die terugkomt, maar blokkeert niets.' : 'Oefenduel: wissels onbeperkt, en een gewisselde speler mag terugkomen.'}</p>`;
}

function scorerField(F) {
  const ours = (F.for || 'us') === 'us' ? F.kind !== 'own' : F.kind === 'own';
  return ours
    ? `<label class="field"><span>Schutter</span><select data-f="player">${opts(played(), F.player)}</select></label>`
    : `<label class="field"><span>Schutter${F.kind === 'own' ? ' (eigen goal)' : ''}</span><input data-f="playerName" maxlength="60" placeholder="naam, mag leeg" value="${esc(F.playerName || '')}"></label>`;
}

function tallyLine() {
  const mine = manualScore(S.draft, S.match, TEAM);
  const sc = S.match.score;
  if (!sc) return `<p class="muted">Goals: ${mine.home}–${mine.away}</p>`;
  const ok = sc.home === mine.home && sc.away === mine.away;
  return `<p class="${ok ? 'muted' : 'warn-line'}">Goals tellen op tot ${mine.home}–${mine.away}${ok ? ', dat klopt met de uitslag ✓' : `, de uitslag is ${sc.home}–${sc.away}. Bij opslaan vraagt de app of de uitslag mee moet.`}</p>`;
}

function step3() {
  const F = S.form;
  const goals = S.draft.goals.slice().sort((a, b) => at(a) - at(b));
  const us = (F.for || 'us') === 'us';
  return `${stepBar()}
    ${goals.length ? `<div class="list">${goals.map((g) => `<div class="list-row mv-item"><span class="mono mv-min">${minLabel(g)}</span>
      <span class="list-row__main"><span class="list-row__title">${g.for === 'them' ? `<span class="muted">${esc(S.opp)}</span> · ` : ''}${esc(g.player || 'onbekend')}${g.kind === 'penalty' ? ' <span class="muted">· penalty</span>' : g.kind === 'own' ? ' <span class="muted">· eigen goal</span>' : ''}${g.assist ? ` <span class="muted">· assist ${esc(g.assist)}</span>` : ''}</span></span>
      <button class="btn btn--sm" type="button" data-del="goals" data-i="${S.draft.goals.indexOf(g)}" aria-label="Weghalen">×</button></div>`).join('')}</div>` : '<p class="muted">Nog geen goals.</p>'}
    ${tallyLine()}
    <div class="section__label"><span>Nieuwe goal</span></div>
    <div class="field-row"><label class="field"><span>Voor</span><select data-f="for" data-rerender><option value="us" ${us ? 'selected' : ''}>${esc(MAIN_CLUB.name)}</option><option value="them" ${us ? '' : 'selected'}>${esc(S.opp)}</option></select></label>
      <label class="field"><span>Soort</span><select data-f="kind" data-rerender>${[['goal', 'Normaal'], ['penalty', 'Penalty'], ['own', 'Eigen goal']].map(([v, l]) => `<option value="${v}" ${(F.kind || 'goal') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${scorerField(F)}
    ${minRow(F)}
    ${us && F.kind !== 'own' ? `<label class="field"><span>Assist</span><select data-f="assist">${opts(played(), F.assist, 'geen / onbekend')}</select></label>` : ''}
    <div><button class="btn btn--sm" type="button" data-add="goals">+ Toevoegen</button></div>`;
}

function step4() {
  const F = S.form;
  const cards = S.draft.cards.slice().sort((a, b) => at(a) - at(b));
  const warn = manualWarnings(S.draft, { official: S.official });
  const K = { yellow: '🟨 Geel', second: '🟨🟥 Tweede geel', red: '🟥 Rood' };
  return `${stepBar()}
    ${cards.length ? `<div class="list">${cards.map((c) => `<div class="list-row mv-item"><span class="mono mv-min">${minLabel(c)}</span>
      <span class="list-row__main"><span class="list-row__title">${K[c.kind]} · ${esc(c.player || '?')}</span></span>
      <button class="btn btn--sm" type="button" data-del="cards" data-i="${S.draft.cards.indexOf(c)}" aria-label="Weghalen">×</button></div>`).join('')}</div>` : '<p class="muted">Geen kaarten.</p>'}
    <label class="field"><span>Speler</span><select data-f="player">${opts(played(), F.player)}</select></label>
    ${minRow(F)}
    <label class="field"><span>Kaart</span><select data-f="kind">${Object.entries(K).map(([v, l]) => `<option value="${v}" ${(F.kind || 'yellow') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="muted" style="font-size:var(--fs-sm);margin:0">Tweede geel: vul de eerste gele kaart ook in.</p>
    <div><button class="btn btn--sm" type="button" data-add="cards">+ Toevoegen</button></div>
    <div class="section__label"><span>Extra (mag leeg)</span></div>
    <label class="field"><span>Stadion</span><input data-x="venue" maxlength="80" value="${esc(S.draft.venue || '')}"></label>
    <label class="field"><span>Scheidsrechter</span><input data-x="referee" maxlength="60" value="${esc(S.draft.referee || '')}"></label>
    <label class="field"><span>Bron</span><input data-x="source" maxlength="120" placeholder="bijv. verslag op cambuur.nl" value="${esc(S.draft.source || '')}"></label>
    ${warn.length ? warn.map((w) => `<p class="warn-line">${esc(w)}</p>`).join('') : ''}
    ${tallyLine()}`;
}

function draw(root) {
  const box = root.querySelector('[data-mv]');
  box.innerHTML = `${[step1, step2, step3, step4][S.step]()}
    <div class="mv-foot">${S.step ? '<button class="btn" type="button" data-back>← Terug</button>' : `<a class="btn" href="#/wedstrijd/${S.id}">Annuleren</a>`}
      ${S.step < 3 ? '<button class="btn btn--primary" type="button" data-next>Verder →</button>' : '<button class="btn btn--primary" type="button" data-save>Opslaan</button>'}</div>
    ${S.notes && S.notes.manual && S.step === 0 ? '<p style="margin-top:16px"><button class="link-btn" type="button" data-remove>Handmatige details verwijderen</button></p>' : ''}`;
}

function readForm(root) {
  root.querySelectorAll('[data-f]').forEach((el) => { S.form[el.dataset.f] = el.value === '' ? null : el.value; });
}

const num = (v) => (v == null || v === '' ? null : Number(v));

function addItem(kind) {
  const F = S.form;
  const minute = num(F.minute); const extra = num(F.extra);
  if (minute == null || Number.isNaN(minute)) return 'Vul een minuut in.';
  if (kind === 'subs') {
    if (!F.in || !F.out) return 'Kies wie erin en wie eruit gaat.';
    if (String(F.in) === String(F.out)) return 'Erin en eruit is dezelfde speler.';
    S.draft.subs.push({ minute, extra, inId: idv(F.in), inName: nameOf(F.in), inNumber: cand(F.in) ? cand(F.in).number ?? null : null, outId: idv(F.out), outName: nameOf(F.out) });
  }
  if (kind === 'goals') {
    const us = (F.for || 'us') === 'us'; const k = F.kind || 'goal';
    const ours = us ? k !== 'own' : k === 'own';
    const g = { minute, extra, for: us ? 'us' : 'them', kind: k, playerId: null, player: null, assistId: null, assist: null };
    if (ours) { g.playerId = idv(F.player); g.player = F.player ? nameOf(F.player) : null; } else g.player = (F.playerName || '').trim() || null;
    if (us && k !== 'own' && F.assist) { g.assistId = idv(F.assist); g.assist = nameOf(F.assist); }
    S.draft.goals.push(g);
  }
  if (kind === 'cards') {
    if (!F.player) return 'Kies een speler.';
    S.draft.cards.push({ minute, extra, playerId: idv(F.player), player: nameOf(F.player), kind: F.kind || 'yellow' });
  }
  S.form = kind === 'goals' ? { for: F.for, kind: 'goal' } : kind === 'cards' ? { kind: F.kind } : {};
  return null;
}

async function save(root) {
  const btn = root.querySelector('[data-save]'); if (btn) btn.disabled = true;
  const order = [...S.cands.values()].sort(sortC).map((c) => String(c.id));
  const manual = { ...S.draft, starters: S.draft.starters.slice().sort((a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id))), at: new Date().toISOString() };
  const before = S.notes && S.notes.manual ? S.notes.manual : null;
  try {
    // Uitslag: wijken de goals af van wat er staat, dan eerst vragen. Zelf toegevoegd duel: geen Highlightly, dus direct.
    const shown = applyCorrections(S.match, S.notes).match;
    const mine = manualScore(manual, S.match, TEAM);
    if (!S.match.manual && S.match.status !== 'finished') {
      // Highlightly: nog niet gespeeld / datum onbekend. Alleen als jij het bevestigt, telt hij als gespeeld.
      if (!manual.played) {
        const ok = await openSheet({
          title: 'Opslaan als gespeeld?',
          body: `<p>Highlightly heeft deze wedstrijd niet als gespeeld${S.match.stateText ? ` (${esc(S.match.stateText)})` : ''} en geen uitslag. Opslaan als gespeeld, <strong>${mine.home}–${mine.away}</strong>?</p>
            <p class="muted sheet__note">Ja = hij telt mee zoals elke gespeelde wedstrijd${S.official ? '' : ' (oefenduels apart)'}. Komt er later bij Highlightly een gespeelde versie of uitslag, dan gaat die voor. Nee = je details worden bewaard, maar hij telt niet mee.</p>`,
          submitLabel: `Ja, gespeeld ${mine.home}–${mine.away}`, cancelLabel: 'Nee',
        });
        manual.played = !!ok;
      }
    } else if (S.match.manual) {
      if (!S.match.score || S.match.score.home !== mine.home || S.match.score.away !== mine.away) {
        const ok = !S.match.score || await openSheet({ title: 'Uitslag aanpassen?', body: `<p>Jouw goals maken <strong>${mine.home}–${mine.away}</strong>, je had <strong>${S.match.score.home}–${S.match.score.away}</strong> ingevuld.</p>`, submitLabel: `Ja, ${mine.home}–${mine.away}`, cancelLabel: 'Nee, laten staan' });
        if (ok) await saveMatches([{ ...S.match, score: mine, status: 'finished' }]);
      }
    } else if (shown.score && (shown.score.home !== mine.home || shown.score.away !== mine.away)) {
      const ok = await openSheet({
        title: 'Uitslag aanpassen?',
        body: `<p>Jouw goals maken <strong>${mine.home}–${mine.away}</strong>, de uitslag is nu <strong>${shown.score.home}–${shown.score.away}</strong>${S.match.score && (S.match.score.home !== shown.score.home || S.match.score.away !== shown.score.away) ? ` (Highlightly: ${S.match.score.home}–${S.match.score.away})` : ' (Highlightly)'}.</p>
          <p class="muted sheet__note">Ja = de uitslag wordt een correctie, terug te draaien via Afwijkingen. Nee = de uitslag blijft; je details worden wel opgeslagen.</p>`,
        submitLabel: `Ja, ${mine.home}–${mine.away}`, cancelLabel: 'Nee, laten staan',
      });
      if (ok) {
        const changes = buildChanges(S.match, S.notes, [{ key: 'score', value: mine }]);
        if (Object.keys(changes).length) await saveCorrections(S.id, changes);
      }
    }
    await saveManual(S.id, manual);
    dropDraft(S.id);
    toast('Details opgeslagen', { action: 'Ongedaan maken', onAction: async () => { await saveManual(S.id, before); location.hash = `#/wedstrijd/${S.id}`; } });
    location.hash = `#/wedstrijd/${S.id}`;
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); if (btn) btn.disabled = false; }
}

/** Wedstrijden met eigen details én Highlightly-details, met het aantal open verschillen. */
export async function manualDiffSummary() {
  const [all, notes] = await Promise.all([getAllMatches(), getAllNotes()]);
  const cand = all.filter((m) => notes[m.id] && notes[m.id].manual && m.hasDetail);
  if (!cand.length) return [];
  const withD = await attachDetails(cand);
  return withD.map((m) => {
    const shown = applyCorrections(m, notes[m.id]).match;
    const items = compareManual(notes[m.id].manual, shown.apiDetail, shown, TEAM);
    return { match: m, open: items.filter((i) => !i.kept).length, total: items.length };
  }).filter((x) => x.open);
}

function compareHtml(m, items) {
  const open = items.filter((i) => !i.kept); const kept = items.filter((i) => i.kept);
  const row = (it) => `<div class="mv-cmp" data-key="${esc(it.key)}">
      <div class="section__label"><span>${esc(it.what)}</span><span>${esc(it.note || it.kind)}</span></div>
      <div class="mv-cmp__vals"><div><span class="muted">Jij</span><br>${esc(it.mine)}</div><div><span class="muted">Highlightly</span><br>${esc(it.api)}</div></div>
      ${it.kept ? '<p class="muted" style="font-size:var(--fs-sm);margin:0">Jouw waarde gehouden.</p>' : `<div class="btn-row"><button class="btn btn--sm" type="button" data-keep="${esc(it.key)}">Mijne houden</button><button class="btn btn--sm" type="button" data-adopt="${esc(it.key)}">Highlightly</button></div>`}
    </div>`;
  return `<section class="section">
      <p class="muted" style="font-size:var(--fs-md)">Highlightly heeft nu ook details voor dit duel. Jouw invoer blijft gelden; hieronder wat verschilt. ${open.length ? `${open.length} open` : 'Alles is bekeken.'}</p>
      ${open.map(row).join('') || '<p class="muted">Geen open verschillen.</p>'}
      ${kept.length ? `<details class="fold"><summary class="section__label"><span>Gehouden</span><span>${kept.length}</span></summary>${kept.map(row).join('')}</details>` : ''}
      <div class="mv-foot"><button class="btn" type="button" data-all-api>Alles Highlightly</button><a class="btn btn--primary" href="#/wedstrijd/${m.id}">Klaar</a></div>
      <p class="muted" style="font-size:var(--fs-sm)">Alles Highlightly = je eigen invoer voor dit duel gaat weg en de wedstrijd toont weer de Highlightly-details.</p>
    </section>`;
}

export const manualViews = {
  vergelijk: {
    title: 'Vergelijken',
    navKey: 'wedstrijden',
    async render(ctx, args) {
      const id = args[0];
      const [m, notes] = await Promise.all([getMatch(id), getNotes(id)]);
      const back = `wedstrijd/${id}`;
      if (!m || !notes || !notes.manual) return `${head({ kicker: 'Wedstrijd', title: 'Vergelijken', back })}<section class="section"><p class="muted">Geen eigen details bij deze wedstrijd.</p></section>`;
      const shown = applyCorrections(m, notes).match;
      if (!shown.apiDetail) return `${head({ kicker: 'Wedstrijd', title: 'Vergelijken', back })}<section class="section"><p class="muted">Highlightly heeft (nog) geen details voor dit duel.</p></section>`;
      this._ctx = { id, m, notes, items: compareManual(notes.manual, shown.apiDetail, shown, TEAM) };
      return `${head({ kicker: `${m.homeTeam.name} – ${m.awayTeam.name} · ${dayShort(m.date)}`, title: 'Jij vs Highlightly', back })}${compareHtml(m, this._ctx.items)}`;
    },
    mount(root, ctx) {
      const view = this;
      root.addEventListener('click', async (e) => {
        const c = view._ctx; if (!c) return;
        const keep = e.target.closest('[data-keep]'); const adopt = e.target.closest('[data-adopt]');
        try {
          if (keep) {
            const it = c.items.find((i) => i.key === keep.dataset.keep);
            await saveManual(c.id, { ...c.notes.manual, kept: { ...(c.notes.manual.kept || {}), [it.key]: it.sig } });
            ctx.refresh(); return;
          }
          if (adopt) {
            const it = c.items.find((i) => i.key === adopt.dataset.adopt);
            const before = c.notes.manual;
            await saveManual(c.id, it.adopt(before));
            toast('Highlightly overgenomen', { action: 'Ongedaan maken', onAction: async () => { await saveManual(c.id, before); ctx.refresh(); } });
            ctx.refresh(); return;
          }
          if (e.target.closest('[data-all-api]')) {
            const ok = await openSheet({ title: 'Alles van Highlightly?', body: '<p>Je eigen opstelling, wissels, goals en kaarten voor dit duel gaan weg. De wedstrijd toont dan de Highlightly-details.</p>', submitLabel: 'Ja, Highlightly' });
            if (!ok) return;
            const before = c.notes.manual;
            await saveManual(c.id, null);
            toast('Eigen details weg', { action: 'Ongedaan maken', onAction: async () => { await saveManual(c.id, before); location.hash = `#/vergelijk/${c.id}`; } });
            location.hash = `#/wedstrijd/${c.id}`;
          }
        } catch (err) { toast(`Lukte niet: ${err.message || err}`); }
      });
    },
  },

  invullen: {
    title: 'Details invullen',
    navKey: 'wedstrijden',
    async render(ctx, args) {
      const id = args[0];
      const [m, notes, allBase] = await Promise.all([getMatch(id), getNotes(id), getAllMatches().catch(() => [])]);
      if (!m) return `${head({ kicker: 'Wedstrijden', title: 'Niet gevonden', back: 'wedstrijden' })}<section class="section"><p class="muted">Deze wedstrijd staat niet in je data.</p></section>`;
      const twin = twinOf(m, allBase);
      if (twin || m.status === 'postponed') {
        S = null;
        return `${head({ kicker: 'Wedstrijden', title: 'Details invullen', back: `wedstrijd/${id}` })}<section class="section">
          ${twin ? `<p>Deze wedstrijd staat er dubbel in. Vul de details in bij de gespeelde versie:</p><div><a class="btn btn--primary" href="#/invullen/${twin.id}">${esc(twin.homeTeam.name)} – ${esc(twin.awayTeam.name)}, ${esc(dayShort(twin.date))}</a></div>`
            : `<p class="muted">Deze wedstrijd is ${esc(stateWord(m))}. Daar vul je geen details bij in.</p>`}</section>`;
      }
      const draft = loadDraft(id, notes && notes.manual);
      S = { id, match: m, notes: notes || null, draft, step: S && S.id === id ? S.step : 0, form: {}, filter: '', official: isOfficial(m), opp: (opponentOf(m, TEAM) || {}).name || 'Tegenstander' };
      S.cands = await candidates(m, draft);
      return `${head({ kicker: `${S.official ? (m.league && m.league.name) || 'Wedstrijd' : 'Oefenduel'} · ${dayShort(m.date)} · ${seasonLabel(seasonOf(m))}`, title: `${m.homeTeam.name} – ${m.awayTeam.name}`, back: `wedstrijd/${id}` })}
        <section class="section mv" data-mv></section>`;
    },
    mount(root) {
      if (!S || !root.querySelector('[data-mv]')) return;
      draw(root);
      // Weg van dit scherm = volgende keer weer bij stap 1 (het concept blijft wel bewaard).
      const leave = () => { if (!location.hash.startsWith('#/invullen/')) { S = null; window.removeEventListener('hashchange', leave); } };
      window.addEventListener('hashchange', leave);
      root.addEventListener('input', (e) => {
        if (e.target.matches('[data-filter]')) { S.filter = e.target.value; const pos = e.target.selectionStart; draw(root); const f = root.querySelector('[data-filter]'); f.focus(); f.setSelectionRange(pos, pos); return; }
        if (e.target.matches('[data-x]')) { S.draft[e.target.dataset.x] = e.target.value.trim() || null; keepDraft(); }
      });
      root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.matches('[data-start]')) {
          const id = t.dataset.start;
          if (t.checked) { const c = cand(id); S.draft.starters.push({ id: idv(id), name: c ? c.name : '?', number: c ? c.number ?? null : null }); } else S.draft.starters = S.draft.starters.filter((p) => String(p.id) !== String(id));
          keepDraft();
          const n = S.draft.starters.length; const lab = root.querySelector('[data-count]');
          if (lab) { lab.textContent = `${n} / 11`; lab.classList.toggle('mv-warn', n !== 11); }
          return;
        }
        if (t.matches('[data-formation]')) { S.draft.formation = t.value || null; keepDraft(); return; }
        if (t.matches('[data-rerender]')) { readForm(root); draw(root); }
      });
      root.addEventListener('click', async (e) => {
        const t = e.target;
        if (t.closest('[data-add-trial]')) {
          const inp = root.querySelector('[data-trial]'); const name = (inp.value || '').trim();
          if (!name) { toast('Vul een naam in'); return; }
          const id = `manual-${Date.now().toString(36)}`;
          S.cands.set(id, { id, name, number: null, line: '', youth: false, extra: true });
          S.draft.starters.push({ id, name, number: null }); keepDraft(); draw(root); return;
        }
        const add = t.closest('[data-add]');
        if (add) { readForm(root); const err = addItem(add.dataset.add); if (err) { toast(err); return; } keepDraft(); draw(root); return; }
        const del = t.closest('[data-del]');
        if (del) { S.draft[del.dataset.del].splice(Number(del.dataset.i), 1); keepDraft(); draw(root); return; }
        if (t.closest('[data-next]')) {
          if (S.step === 0 && !S.draft.starters.length) { toast('Kies eerst de basisspelers'); return; }
          S.step++; S.form = {}; draw(root); window.scrollTo(0, 0); return;
        }
        if (t.closest('[data-back]')) { S.step--; S.form = {}; draw(root); window.scrollTo(0, 0); return; }
        if (t.closest('[data-save]')) { save(root); return; }
        if (t.closest('[data-remove]')) {
          const ok = await openSheet({ title: 'Handmatige details verwijderen?', body: '<p>De opstelling, wissels, goals en kaarten die je zelf invulde gaan weg. Een aangepaste uitslag blijft staan (die staat bij Afwijkingen).</p>', submitLabel: 'Verwijderen' });
          if (!ok) return;
          const before = S.notes.manual;
          await saveManual(S.id, null); dropDraft(S.id);
          toast('Handmatige details verwijderd', { action: 'Ongedaan maken', onAction: async () => { await saveManual(S.id, before); location.hash = `#/wedstrijd/${S.id}`; } });
          location.hash = `#/wedstrijd/${S.id}`;
        }
      });
    },
  },
};

// ---------- Zelf een wedstrijd toevoegen ----------
const slug = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function competitions() {
  const all = await getAllMatches().catch(() => []);
  const seen = new Map();
  all.forEach((m) => { if (m.league && m.league.id != null) { const k = String(m.league.id); const e = seen.get(k) || { id: m.league.id, name: m.league.name, n: 0 }; e.n++; seen.set(k, e); } });
  LEAGUES.forEach((l) => { if (!seen.has(String(l.id))) seen.set(String(l.id), { id: l.id, name: l.name, n: 0 }); });
  const list = [...seen.values()];
  const friendly = list.filter((l) => /friendl/i.test(l.name)).sort((a, b) => b.n - a.n)[0] || { id: 568401, name: 'Friendlies Clubs' };
  return { friendly, others: list.filter((l) => !/friendl/i.test(l.name)).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)), all };
}

export async function addManualMatch(pre = {}) {
  const { friendly, others, all } = await competitions();
  const own = all.map((m) => [m.homeTeam, m.awayTeam]).flat().find((t) => t && t.id === TEAM) || { id: TEAM, name: MAIN_CLUB.name, logo: null };
  const today = new Date().toISOString().slice(0, 10);
  const data = await openSheet({
    title: 'Wedstrijd toevoegen',
    body: `<div class="field-row"><label class="field"><span>Datum</span><input name="date" type="date" required value="${esc(pre.date || today)}"></label>
        <label class="field"><span>Aftrap</span><input name="time" type="time" value="${esc(pre.time || '14:30')}"></label></div>
      ${clubField('opp', 'Tegenstander', {})}
      <div class="field-row"><label class="field"><span>Waar</span><select name="where"><option value="home">Thuis</option><option value="away">Uit</option></select></label>
        <label class="field"><span>Competitie</span><select name="league"><option value="${esc(String(friendly.id))}">Oefenduel</option>${others.map((l) => `<option value="${esc(String(l.id))}">${esc(l.name)}</option>`).join('')}</select></label></div>
      <div class="field-row"><label class="field"><span>Goals ${esc(MAIN_CLUB.name)}</span><input name="us" type="number" inputmode="numeric" min="0" max="30" placeholder="leeg = uit de goals"></label>
        <label class="field"><span>Goals tegenstander</span><input name="them" type="number" inputmode="numeric" min="0" max="30" placeholder="leeg = uit de goals"></label></div>
      <p class="muted sheet__note">De app haalt voor deze wedstrijd niets bij Highlightly op. Daarna vul je de opstelling, wissels, goals en kaarten in.</p>`,
    submitLabel: 'Toevoegen',
    validate: (fd) => (!fd.get('date') ? 'Kies een datum.' : !String(fd.get('opp') || '').trim() ? 'Vul de tegenstander in.' : (fd.get('us') === '') !== (fd.get('them') === '') ? 'Vul beide goals in, of allebei leeg.' : null),
  });
  if (!data) return null;
  const date = new Date(`${data.get('date')}T${data.get('time') || '14:30'}:00`).toISOString();
  const name = String(data.get('opp')).trim();
  let oppId = data.get('oppId') || null; let logo = data.get('oppLogo') || null; let oppName = name;
  if (!oppId) { const hit = matchTeam(await knownTeams(), name); if (hit) { oppId = hit.id; logo = hit.logo || null; oppName = hit.name; } }
  const opp = { id: oppId ? (/^\d+$/.test(String(oppId)) ? Number(oppId) : oppId) : `name:${slug(name)}`, name: oppName, logo };
  const lg = [friendly, ...others].find((l) => String(l.id) === String(data.get('league'))) || friendly;
  const season = seasonOfDate(data.get('date'));
  const home = data.get('where') !== 'away';
  const ownT = { id: own.id, name: own.name, logo: own.logo || null };
  const sc = data.get('us') === '' ? null : { us: Number(data.get('us')), them: Number(data.get('them')) };
  const m = {
    id: `manual-${Date.now().toString(36)}`, manual: true, date, round: null,
    league: { id: lg.id, name: lg.name, season }, homeTeam: home ? ownT : opp, awayTeam: home ? opp : ownT,
    status: Date.parse(date) < Date.now() ? 'finished' : 'scheduled', stateText: null,
    score: sc ? (home ? { home: sc.us, away: sc.them } : { home: sc.them, away: sc.us }) : null, penalties: null,
    createdAt: new Date().toISOString(),
  };
  await saveMatches([m]);
  if (season !== getSeason()) toast(`Toegevoegd aan ${seasonLabel(season)}. Kies dat seizoen op Home om hem in de lijst te zien.`, { duration: 6000 });
  else toast('Wedstrijd toegevoegd');
  location.hash = m.status === 'finished' ? `#/invullen/${m.id}` : `#/wedstrijd/${m.id}`;
  return m;
}

export async function editManualScore(m) {
  const sc = m.score || { home: '', away: '' };
  const data = await openSheet({
    title: 'Uitslag',
    body: `<div class="field-row"><label class="field"><span>${esc(m.homeTeam.name)}</span><input name="home" type="number" inputmode="numeric" min="0" max="30" value="${sc.home}"></label>
      <label class="field"><span>${esc(m.awayTeam.name)}</span><input name="away" type="number" inputmode="numeric" min="0" max="30" value="${sc.away}"></label></div>
      <p class="muted sheet__note">Zelf toegevoegde wedstrijd: dit is de uitslag, er is geen Highlightly-waarde.</p>`,
    validate: (fd) => (fd.get('home') === '' || fd.get('away') === '' ? 'Vul beide in.' : null),
  });
  if (!data) return false;
  const before = m.score || null;
  await saveMatches([{ ...m, score: { home: Number(data.get('home')), away: Number(data.get('away')) }, status: 'finished' }]);
  toast('Uitslag opgeslagen', { action: 'Ongedaan maken', onAction: async () => { await saveMatches([{ ...m, score: before }]); } });
  return true;
}

export async function deleteManualMatch(m, notes) {
  const ok = await openSheet({ title: 'Wedstrijd verwijderen?', body: `<p>${esc(m.homeTeam.name)} – ${esc(m.awayTeam.name)} gaat weg, met alles wat je erbij invulde.</p>`, submitLabel: 'Verwijderen' });
  if (!ok) return false;
  await deleteMatch(m.id);
  dropDraft(m.id);
  toast('Wedstrijd verwijderd', { action: 'Ongedaan maken', onAction: async () => { await saveMatches([m]); if (notes) await saveNotesBatch([[m.id, notes]]); location.hash = `#/wedstrijd/${m.id}`; } });
  return true;
}

// ---------- Zelf toegevoegd duel bij Highlightly zoeken ----------
/** Zoekt het duel bij Highlightly (1 call). Gevonden: de Highlightly-wedstrijd vervangt deze, met je invoer erbij. */
export async function searchManualOnHighlightly(m, notes) {
  const { searchOnHighlightly } = await import('./sync.js');
  const { match: found, seen } = await searchOnHighlightly(m);
  const at = new Date().toISOString();
  if (!found) {
    await saveMatches([{ ...m, hlSearch: { at, found: false, seen: seen.length } }]);
    toast(seen.length ? `Highlightly kent op die dag wel ${seen.length} duel(s) van ${MAIN_CLUB.name}, maar niet als gespeeld (${seen.map((x) => x.stateText || x.status).join(", ")}).` : `Highlightly kent dit duel niet (gezocht op ${dayShort(m.date)} + ${MAIN_CLUB.name}). Details vul je zelf in.`, { duration: 7000 });
    return null;
  }
  // Gevonden: Highlightly-versie opslaan, je eigen invoer (notities, details) meeverhuizen, dit duel weg.
  await saveMatches([found]);
  if (notes) await saveNotesBatch([[found.id, notes]]);
  await deleteMatch(m.id);
  dropDraft(m.id);
  const same = found.score && m.score && found.score.home === m.score.home && found.score.away === m.score.away;
  toast(`Gevonden bij Highlightly${same ? '' : ` (uitslag daar: ${found.score ? `${found.score.home}–${found.score.away}` : 'onbekend'}, RSSSF: ${m.score ? `${m.score.home}–${m.score.away}` : '?'})`}. Je kunt nu de details ophalen.`, { duration: 7000 });
  return found;
}
