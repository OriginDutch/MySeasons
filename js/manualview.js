// #/invullen/{id}: wedstrijddetails zelf invullen in vier stappen (opstelling, wissels, goals, kaarten + extra).
// Alleen de eigen club. Opslag en omzetting: manual.js. Een concept blijft per wedstrijd in deze sessie bewaard.

import { esc, toast } from './ui.js';
import { getMatch, getNotes, saveManual, saveCorrections } from './store.js';
import { MAIN_CLUB } from './config.js';
import { applyCorrections, buildChanges } from './corrections.js';
import { correctedList, head } from './matchviews.js';
import { buildSquad, LINES } from './players.js';
import { statusIn, seasonWindow } from './membership.js';
import { seasonOf, seasonLabel } from './seasonstate.js';
import { levelFor, shirtFor } from './shirts.js';
import { roleFor, lineOfRole } from './roles.js';
import { opponentOf, dayShort } from './season.js';
import { openSheet } from './editor.js';
import { FORMATIONS, idv, manualScore, manualWarnings } from './manual.js';

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
    // Uitslag: wijken de goals af van wat er staat, dan eerst vragen.
    const shown = applyCorrections(S.match, S.notes).match;
    const mine = manualScore(manual, S.match, TEAM);
    if (shown.score && (shown.score.home !== mine.home || shown.score.away !== mine.away)) {
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

export const manualViews = {
  invullen: {
    title: 'Details invullen',
    navKey: 'wedstrijden',
    async render(ctx, args) {
      const id = args[0];
      const [m, notes] = await Promise.all([getMatch(id), getNotes(id)]);
      if (!m) return `${head({ kicker: 'Wedstrijden', title: 'Niet gevonden', back: 'wedstrijden' })}<section class="section"><p class="muted">Deze wedstrijd staat niet in je data.</p></section>`;
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
