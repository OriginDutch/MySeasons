// Handwerk: wedstrijd aanvullen, API-data corrigeren en het Afwijkingen-scherm.

import { esc, icons, toast } from './ui.js';
import { getMatch, getAllMatches, getNotes, getAllNotes, saveNotes, saveCorrections, attachDetails } from './store.js';
import {
  EVENT_FIELDS, KIND_LABEL, FILTER_OF, kindOf, keyOf, indexEvents, fieldValue, applyCorrections,
  buildChanges, display, looksLikeTypo,
} from './corrections.js';
import { sortByDate, dayShort } from './season.js';
import { MAIN_CLUB } from './config.js';

// ---------- Sheet (onderkant op mobiel, midden op desktop) ----------

/** Opent een formulier-sheet. Resolvet met FormData bij Opslaan, of null bij Annuleren. */
export function openSheet({ title, body, validate, submitLabel = 'Opslaan' }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = `
      <form method="dialog" class="sheet__form" novalidate>
        <div class="sheet__head"><span class="sheet__title">${esc(title)}</span></div>
        <div class="sheet__body">${body}</div>
        <p class="sheet__error" role="alert" hidden></p>
        <div class="sheet__actions">
          <button class="btn" type="button" value="cancel" data-cancel>Annuleren</button>
          <button class="btn btn--primary" type="submit" value="ok">${esc(submitLabel)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    const err = dlg.querySelector('.sheet__error');
    let result = null;
    form.addEventListener('submit', (e) => {
      const data = new FormData(form);
      const problem = validate ? validate(data) : null;
      if (problem) {
        e.preventDefault();
        err.textContent = problem;
        err.hidden = false;
        return;
      }
      result = data;
    });
    dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea');
    if (first) first.focus();
  });
}

const intIn = (v, min, max) => {
  if (v === '' || v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
};

// ---------- Spelerslijsten ----------

function squads(m) {
  const d = m.detail || {};
  const teams = new Map();
  const add = (teamId, p) => {
    if (!teamId || !p || !p.id) return;
    if (!teams.has(teamId)) teams.set(teamId, new Map());
    if (!teams.get(teamId).has(p.id)) teams.get(teamId).set(p.id, p.name);
  };
  ['home', 'away'].forEach((side) => {
    const l = d.lineups && d.lineups[side];
    if (l) [...l.starters, ...l.subs].forEach((p) => add(l.teamId, p));
  });
  Object.entries(d.players || {}).forEach(([tid, list]) => list.forEach((p) => add(Number(tid), p)));
  return teams;
}

function personSelect(name, label, m, teamId, current, { allowNone = false } = {}) {
  const teams = squads(m);
  const order = [m.homeTeam, m.awayTeam].filter(Boolean).sort((a, b) => (b.id === teamId) - (a.id === teamId));
  const curVal = current ? (current.id ? `i:${current.id}` : `n:${current.name}`) : '';
  let found = !current;
  const groups = order.map((t) => {
    const ps = [...(teams.get(t.id) || new Map())].sort((a, b) => a[1].localeCompare(b[1]));
    if (!ps.length) return '';
    return `<optgroup label="${esc(t.name)}">${ps.map(([id, n]) => {
      const v = `i:${id}`;
      if (v === curVal) found = true;
      return `<option value="${esc(v)}" ${v === curVal ? 'selected' : ''}>${esc(n)}</option>`;
    }).join('')}</optgroup>`;
  }).join('');
  const extra = !found ? `<option value="${esc(curVal)}" selected>${esc(current.name || '?')}</option>` : '';
  return `<label class="field"><span>${esc(label)}</span>
    <select name="${name}">${allowNone ? `<option value="" ${curVal ? '' : 'selected'}>Geen</option>` : ''}${extra}${groups}</select></label>`;
}

function readPerson(v, m) {
  if (!v) return null;
  if (v.startsWith('n:')) return { id: null, name: v.slice(2) };
  const id = Number(v.slice(2));
  for (const team of squads(m).values()) if (team.has(id)) return { id, name: team.get(id) };
  return { id, name: null };
}

// ---------- Bewerken vanaf de wedstrijdpagina ----------

/** Corrigeer één event. `shown` is het event zoals nu getoond (met correcties). */
export async function editEvent(apiMatch, notes, sig, refresh) {
  const shownMatch = applyCorrections(apiMatch, notes).match;
  const shown = shownMatch.detail.events.find((e) => e._sig === sig);
  const apiEv = indexEvents(apiMatch.detail.events).get(sig);
  if (!shown || !apiEv) return false;
  const kind = kindOf(apiEv.type);
  const fields = EVENT_FIELDS[kind];
  if (!fields) { toast('Dit soort moment kun je (nog) niet corrigeren'); return false; }

  const body = fields.map(([f, label]) => {
    if (f === 'extra') return '';
    if (f === 'minute') {
      return `<div class="field-row field-row--min">
        <label class="field"><span>Minuut</span><input name="minute" type="number" inputmode="numeric" min="0" max="130" value="${shown.minute ?? ''}"></label>
        <label class="field"><span>+ blessuretijd</span><input name="extra" type="number" inputmode="numeric" min="1" max="30" placeholder="—" value="${shown.extra ?? ''}"></label>
      </div>`;
    }
    return personSelect(f, label[0].toUpperCase() + label.slice(1), shownMatch, shown.teamId, fieldValue(shown, f), { allowNone: f === 'assist' });
  }).join('') + `<p class="muted sheet__note">Highlightly: ${fields.filter(([f]) => f !== 'extra' || apiEv.extra).map(([f, l]) => `${esc(l)} ${esc(display(fieldValue(apiEv, f), f))}`).join(' · ')}</p>`;

  const data = await openSheet({
    title: `${KIND_LABEL[kind]} corrigeren`,
    body,
    validate: (fd) => {
      if (fd.has('minute') && Number.isNaN(intIn(fd.get('minute'), 0, 130))) return 'Minuut moet een heel getal tussen 0 en 130 zijn.';
      if (fd.has('extra') && Number.isNaN(intIn(fd.get('extra'), 1, 30))) return 'Blessuretijd moet tussen 1 en 30 minuten zijn, of leeg.';
      if (fd.get('extra') && !fd.get('minute')) return 'Vul ook de minuut in, bijvoorbeeld 45 of 90.';
      if (fd.has('player') && !fd.get('player')) return 'Kies een speler.';
      if (kind === 'sub' && fd.get('in') && fd.get('in') === fd.get('out')) return 'Erin en eruit kunnen niet dezelfde speler zijn.';
      if (kind === 'goal' && fd.get('assist') && fd.get('assist') === fd.get('player')) return 'Schutter en assist zijn dezelfde speler.';
      return null;
    },
  });
  if (!data) return false;

  const entries = fields.map(([f]) => ({
    key: keyOf(sig, f),
    value: f === 'minute' ? intIn(data.get('minute'), 0, 130) : f === 'extra' ? intIn(data.get('extra'), 1, 30) : readPerson(data.get(f), shownMatch),
  }));
  return commit(apiMatch, notes, entries, refresh);
}

export async function editScore(apiMatch, notes, refresh) {
  const shown = applyCorrections(apiMatch, notes).match;
  const s = shown.score || { home: '', away: '' };
  const data = await openSheet({
    title: 'Uitslag corrigeren',
    body: `<div class="field-row">
        <label class="field"><span>${esc(apiMatch.homeTeam.name)}</span><input name="home" type="number" inputmode="numeric" min="0" max="30" value="${s.home}"></label>
        <label class="field"><span>${esc(apiMatch.awayTeam.name)}</span><input name="away" type="number" inputmode="numeric" min="0" max="30" value="${s.away}"></label>
      </div>
      <p class="muted sheet__note">Highlightly: ${esc(display(apiMatch.score))}</p>`,
    validate: (fd) => {
      const h = intIn(fd.get('home'), 0, 30); const a = intIn(fd.get('away'), 0, 30);
      return h === null || a === null || Number.isNaN(h) || Number.isNaN(a) ? 'Vul voor beide teams een heel getal in (0 t/m 30).' : null;
    },
  });
  if (!data) return false;
  return commit(apiMatch, notes, [{ key: 'score', value: { home: Number(data.get('home')), away: Number(data.get('away')) } }], refresh);
}

async function commit(apiMatch, notes, entries, refresh) {
  const changes = buildChanges(apiMatch, notes, entries);
  if (!Object.keys(changes).length) { toast('Niets veranderd'); return false; }
  const before = {};
  Object.keys(changes).forEach((k) => { before[k] = (notes && notes.corrections && notes.corrections[k]) || null; });
  await saveCorrections(apiMatch.id, changes);
  const removed = Object.values(changes).every((v) => v === null);
  toast(removed ? 'Terug naar de Highlightly-waarde' : 'Correctie opgeslagen', {
    action: 'Ongedaan maken',
    onAction: async () => { await saveCorrections(apiMatch.id, before); refresh(); },
  });
  return true;
}

function motmOptions(m, n) {
  const list = (m.detail && m.detail.players && m.detail.players[MAIN_CLUB.id]) || [];
  const played = list.filter((p) => p.minutes > 0).sort((a, b) => a.name.localeCompare(b.name));
  if (!played.length && !(n.motm)) return '';
  const cur = n.motm && n.motm.playerId ? String(n.motm.playerId) : '';
  const extra = n.motm && !played.some((p) => String(p.id) === cur) ? `<option value="${esc(cur || 'x')}" selected>${esc(n.motm.name || '?')}</option>` : '';
  return `<label class="field"><span>Man van de wedstrijd (jouw keuze)</span><select name="motm"><option value="">Geen</option>${extra}${played.map((p) => `<option value="${p.id}" ${String(p.id) === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
}

export async function editNotes(m, notes) {
  const n = notes || {};
  const awayIsMe = m.awayTeam && m.awayTeam.id === MAIN_CLUB.id;
  const awayLabel = awayIsMe ? `Waarvan ${MAIN_CLUB.name}-fans (uitvak)` : `Waarvan ${m.awayTeam ? m.awayTeam.name : 'uit'}-fans (uitvak)`;
  const data = await openSheet({
    title: 'Wedstrijd aanvullen',
    body: `<label class="field"><span>Toeschouwers (totaal)</span><input name="attendance" type="number" inputmode="numeric" min="0" max="100000" placeholder="bijv. 10250" value="${n.attendance ?? ''}"></label>
      <label class="field"><span>${esc(awayLabel)}</span><input name="awayFans" type="number" inputmode="numeric" min="0" max="100000" placeholder="leeg = onbekend" value="${n.awayFans ?? ''}"></label>
      ${motmOptions(m, n)}
      ${m.league && !/friendl/i.test(m.league.name) && !(m.round && /regular season/i.test(m.round)) ? `<label class="field field--check"><input type="checkbox" name="neutral" ${n.neutral ? 'checked' : ''}> <span>Op neutraal terrein (telt niet als thuis of uit)</span></label>` : ''}
      <label class="field"><span>Notitie</span><textarea name="note" rows="4" maxlength="2000" placeholder="Sfeer, opvallende momenten, waar je zat…">${esc(n.note || '')}</textarea></label>`,
    validate: (fd) => {
      const t = intIn(fd.get('attendance'), 0, 100000);
      const a = intIn(fd.get('awayFans'), 0, 100000);
      if (Number.isNaN(t)) return 'Toeschouwers moet een heel getal zijn (0 t/m 100.000).';
      if (Number.isNaN(a)) return 'Uitvak moet een heel getal zijn (0 t/m 100.000).';
      if (t !== null && a !== null && a > t) return 'Het uitvak kan niet groter zijn dan het totaal.';
      return null;
    },
  });
  if (!data) return false;
  const next = {
    attendance: intIn(data.get('attendance'), 0, 100000),
    awayFans: intIn(data.get('awayFans'), 0, 100000),
    motm: (() => {
      if (!data.has('motm')) return n.motm || null;
      const v = data.get('motm');
      if (!v) return null;
      if (n.motm && String(n.motm.playerId || 'x') === v) return n.motm;
      const p = ((m.detail && m.detail.players && m.detail.players[MAIN_CLUB.id]) || []).find((x) => String(x.id) === v);
      return p ? { playerId: p.id, name: p.name } : null;
    })(),
    note: String(data.get('note') || '').trim() || null,
    neutral: data.get('neutral') ? true : null,
  };
  const sameMotm = JSON.stringify(next.motm || null) === JSON.stringify(n.motm || null);
  if (next.attendance === (n.attendance ?? null) && next.awayFans === (n.awayFans ?? null) && next.note === (n.note || null) && !!next.neutral === !!n.neutral && sameMotm) { toast('Niets veranderd'); return false; }
  await saveNotes(m.id, next);
  toast('Opgeslagen');
  return true;
}

// ---------- Afwijkingen-scherm ----------

const STATUS_LABEL = { conflict: 'Conflict', active: 'Eigen waarde', redundant: 'Overbodig' };
const TYPE_FILTERS = [['all', 'Alles'], ['goals', 'Goals'], ['kaarten', 'Kaarten'], ['wissels', 'Wissels'], ['uitslag', 'Uitslag']];
const STATUS_FILTERS = [['all', 'Alle'], ['conflict', 'Conflict'], ['active', 'Eigen'], ['redundant', 'Overbodig']];

async function collect(onlyId) {
  const [base, notes] = await Promise.all([onlyId ? getMatch(onlyId).then((m) => (m ? [m] : [])) : getAllMatches(), onlyId ? getNotes(onlyId).then((n) => ({ [onlyId]: n })) : getAllNotes()]);
  const matches = onlyId ? base : await attachDetails(base.filter((m) => notes[m.id]));
  const out = [];
  sortByDate(matches).reverse().forEach((m) => {
    const n = notes[m.id];
    if (!n || !n.corrections || !Object.keys(n.corrections).length) return;
    const { statuses } = applyCorrections(m, n);
    out.push({ match: m, notes: n, items: statuses });
  });
  return out;
}

function itemHtml(m, s) {
  const typo = looksLikeTypo(s.now ?? s.api, s.mine);
  const values = s.status === 'conflict'
    ? (s.now === undefined
      ? `<span>Highlightly heeft dit moment niet meer</span><span>Jij: <strong>${esc(display(s.mine, s.field))}</strong></span>`
      : `<span>Highlightly toen: ${esc(display(s.api, s.field))} · nu: <strong>${esc(display(s.now, s.field))}</strong></span><span>Jij: <strong>${esc(display(s.mine, s.field))}</strong></span>`)
    : s.status === 'redundant'
      ? `<span>Highlightly is het nu met je eens: <strong>${esc(display(s.mine, s.field))}</strong></span>`
      : `<span>Highlightly: ${esc(display(s.api, s.field))}</span><span>Jij: <strong>${esc(display(s.mine, s.field))}</strong></span>`;
  return `<label class="dev" data-type="${FILTER_OF[s.kind] || 'overig'}" data-status="${s.status}">
    <input type="checkbox" name="pick" value="${esc(m.id + '|' + s.key)}">
    <span class="dev__main">
      <span class="dev__what">${esc(s.what)} <span class="dev__badge dev__badge--${s.status}">${STATUS_LABEL[s.status]}</span></span>
      <span class="dev__vals muted">${values}</span>
      ${typo ? '<span class="dev__hint">Lijkt op een typfout, bedoelde je de Highlightly-waarde?</span>' : ''}
    </span>
  </label>`;
}

export const editorViews = {
  afwijkingen: {
    title: 'Afwijkingen',
    navKey: 'meer',
    async render(ctx, args) {
      const onlyId = args && args[0];
      const groups = await collect(onlyId);
      const all = groups.flatMap((g) => g.items);
      const back = onlyId ? `wedstrijd/${onlyId}` : 'meer';
      const head = `<header class="page-head"><div class="page-head__titles">
        <a class="back-btn" href="#/${esc(back)}" aria-label="Terug">${icons.back}</a>
        <span class="page-head__kicker">${onlyId ? 'Wedstrijd / Afwijkingen' : 'Meer / Afwijkingen'}</span>
        <h1 class="page-head__title">Afwijkingen</h1></div></header>`;
      if (!all.length) {
        return `${head}<section class="section"><div class="empty"><span class="empty__title">Alles klopt met Highlightly</span>
          <p class="muted">Pas je op een wedstrijdpagina een goal, kaart, wissel of uitslag aan, dan zie je dat hier terug. Bij een sync wordt jouw waarde nooit stil overschreven.</p></div></section>`;
      }
      const conflicts = all.filter((s) => s.status === 'conflict').length;
      const chips = (name, list) => `<div class="chips" role="radiogroup">${list.map(([v, l], i) => {
        const n = v === 'all' ? all.length : all.filter((s) => (name === 'type' ? FILTER_OF[s.kind] : s.status) === v).length;
        return `<label class="chip"><input type="radio" name="f-${name}" value="${v}" ${i === 0 ? 'checked' : ''}><span>${esc(l)} <span class="mono">${n}</span></span></label>`;
      }).join('')}</div>`;
      return `${head}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">${all.length} ${all.length === 1 ? 'veld wijkt' : 'velden wijken'} af van Highlightly${conflicts ? `, waarvan <strong class="accent-text">${conflicts} met een conflict</strong>: Highlightly heeft die waarde sinds jouw aanpassing veranderd` : ''}. Tot je kiest, geldt jouw waarde.</p>
          ${chips('type', TYPE_FILTERS)}
          ${chips('status', STATUS_FILTERS)}
        </section>
        <form class="dev-form" data-dev-form>
          ${groups.map((g) => `<section class="section dev-group">
            <div class="section__label"><a href="#/wedstrijd/${g.match.id}">${esc(g.match.homeTeam.name)} – ${esc(g.match.awayTeam.name)}</a><span>${esc(dayShort(g.match.date))}</span></div>
            <div class="list">${g.items.map((s) => itemHtml(g.match, s)).join('')}</div>
          </section>`).join('')}
          <div class="dev-bar">
            <label class="dev-bar__all"><input type="checkbox" data-pick-all> <span><span data-picked>0</span> gekozen</span></label>
            <button class="btn" type="button" data-resolve="keep" disabled>Mijn waarde houden</button>
            <button class="btn btn--primary" type="button" data-resolve="api" disabled>Highlightly overnemen</button>
          </div>
        </form>`;
    },
    mount(root, ctx) {
      const form = root.querySelector('[data-dev-form]');
      if (!form) return;
      const items = [...form.querySelectorAll('.dev')];
      const visible = () => items.filter((el) => !el.hidden);
      const update = () => {
        const n = items.filter((el) => el.querySelector('input').checked).length;
        root.querySelector('[data-picked]').textContent = n;
        form.querySelectorAll('[data-resolve]').forEach((b) => { b.disabled = !n; });
        const vis = visible();
        const all = form.querySelector('[data-pick-all]');
        all.checked = vis.length > 0 && vis.every((el) => el.querySelector('input').checked);
      };
      const filter = () => {
        const t = root.querySelector('input[name="f-type"]:checked').value;
        const s = root.querySelector('input[name="f-status"]:checked').value;
        items.forEach((el) => {
          el.hidden = !((t === 'all' || el.dataset.type === t) && (s === 'all' || el.dataset.status === s));
          if (el.hidden) el.querySelector('input').checked = false;
        });
        form.querySelectorAll('.dev-group').forEach((g) => { g.hidden = ![...g.querySelectorAll('.dev')].some((el) => !el.hidden); });
        update();
      };
      root.querySelectorAll('input[name^="f-"]').forEach((i) => i.addEventListener('change', filter));
      form.addEventListener('change', (e) => { if (e.target.name === 'pick') update(); });
      form.querySelector('[data-pick-all]').addEventListener('change', (e) => {
        visible().forEach((el) => { el.querySelector('input').checked = e.target.checked; });
        update();
      });

      form.querySelectorAll('[data-resolve]').forEach((btn) => btn.addEventListener('click', async () => {
        const mode = btn.dataset.resolve;
        const picked = items.filter((el) => el.querySelector('input').checked).map((el) => el.querySelector('input').value.split('|'));
        const byMatch = new Map();
        picked.forEach(([id, key]) => { if (!byMatch.has(id)) byMatch.set(id, []); byMatch.get(id).push(key); });
        const groups = await collect(null);
        const undo = [];
        let skipped = 0;
        btn.disabled = true;
        for (const [id, keys] of byMatch) {
          const g = groups.find((x) => String(x.match.id) === id);
          if (!g) continue;
          const changes = {}; const before = {};
          keys.forEach((key) => {
            const c = g.notes.corrections[key];
            const st = g.items.find((s) => s.key === key);
            if (!c || !st) return;
            before[key] = c;
            if (mode === 'api') changes[key] = null;
            else if (st.now === undefined) skipped++; // event bestaat niet meer bij Highlightly
            else if (st.status === 'redundant') changes[key] = null; // zelfde waarde: correctie niet meer nodig
            else changes[key] = { ...c, api: st.now, at: new Date().toISOString() };
          });
          Object.keys(changes).length && (await saveCorrections(id, changes), undo.push([id, before]));
        }
        const n = picked.length - skipped;
        toast(`${n} ${n === 1 ? 'veld' : 'velden'} ${mode === 'api' ? 'teruggezet naar Highlightly' : 'bevestigd'}${skipped ? ` · ${skipped} overgeslagen (moment bestaat niet meer, kies Highlightly overnemen)` : ''}`, {
          action: 'Ongedaan maken',
          duration: 8000,
          onAction: async () => {
            for (const [id, before] of undo) await saveCorrections(id, before);
            ctx.refresh();
          },
        });
        ctx.refresh();
      }));
    },
  },
};
