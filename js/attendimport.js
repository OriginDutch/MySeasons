// Toeschouwers importeren: plak regels met een datum en een aantal (bijv. uit Wikipedia), de app zoekt het
// Cambuur-duel op die dag en laat eerst zien wat hij gaat doen. Jouw eigen getallen gaan voor: een duel waar al
// een aantal staat, wordt alleen overschreven als je dat per regel aanvinkt.

import { esc, icons, toast } from './ui.js';
import { MAIN_CLUB } from './config.js';
import { getAllMatches, getAllNotes, saveNotesBatch } from './store.js';
import { dayShort } from './season.js';

const nl = (n) => Number(n).toLocaleString('nl-NL');
const pad = (n) => String(n).padStart(2, '0');
/** Datum zoals in Nederland (de app toont duels in NL-tijd). */
const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Eén regel → { day, n } of null. Datum: 2025-08-15, 15-08-2025 of 15/08/2025. Aantal: het laatste getal (12.236, 12,236 of 12236). */
export function parseLine(line) {
  let s = String(line).trim();
  if (!s) return null;
  let day = null;
  const iso = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const eu = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (iso) { day = `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`; s = s.replace(iso[0], ' '); } else if (eu) { day = `${eu[3]}-${pad(eu[2])}-${pad(eu[1])}`; s = s.replace(eu[0], ' '); }
  const nums = s.match(/\d{1,3}(?:[.,]\d{3})+|\d+/g);
  if (!day || !nums) return { error: !day ? 'geen datum' : 'geen aantal', raw: line.trim() };
  const n = Number(nums[nums.length - 1].replace(/[.,]/g, ''));
  if (!(n >= 0 && n <= 100000)) return { error: 'aantal klopt niet', raw: line.trim() };
  return { day, n, raw: line.trim() };
}

/** Plan per regel: welk duel, wat staat er nu, wat gebeurt er. */
export function planImport(text, matches, notes) {
  const own = matches.filter((m) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === MAIN_CLUB.id));
  const byDay = new Map();
  own.forEach((m) => { const k = localDay(m.date); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(m); });
  return String(text).split(/\r?\n/).map(parseLine).filter(Boolean).map((p) => {
    if (p.error) return { ...p, status: 'fout' };
    const hits = byDay.get(p.day) || [];
    if (hits.length !== 1) return { ...p, status: 'fout', error: hits.length ? 'meerdere duels op die dag' : 'geen Cambuur-duel op die dag' };
    const m = hits[0]; const cur = notes[m.id] && notes[m.id].attendance != null ? notes[m.id].attendance : null;
    return { ...p, m, cur, status: cur == null ? 'nieuw' : cur === p.n ? 'gelijk' : 'anders' };
  });
}

const STATUS = { nieuw: 'nieuw', gelijk: 'staat er al', anders: 'wijkt af', fout: 'overgeslagen' };

function rowHtml(r, i) {
  const opp = r.m ? (r.m.homeTeam.id === MAIN_CLUB.id ? `${esc(r.m.awayTeam.name)} (thuis)` : `${esc(r.m.homeTeam.name)} (uit)`) : esc(r.raw);
  const check = r.status === 'nieuw' || r.status === 'anders'
    ? `<input type="checkbox" name="ai" value="${i}" ${r.status === 'nieuw' ? 'checked' : ''} aria-label="Overnemen">` : '<span aria-hidden="true"></span>';
  const val = r.status === 'anders' ? `<span class="mono">${nl(r.cur)}</span> → <span class="mono">${nl(r.n)}</span>` : r.n != null ? `<span class="mono">${nl(r.n)}</span>` : '';
  return `<label class="ai-row ai-row--${r.status}">${check}
    <span class="ai-main"><span class="ai-title">${r.m ? esc(dayShort(r.m.date)) + ' · ' : ''}${opp}</span>
    <span class="ai-sub">${STATUS[r.status]}${r.error ? `: ${esc(r.error)}` : ''}${r.status === 'anders' ? ' · jouw getal blijft, tenzij je dit aanvinkt' : ''}</span></span>
    <span class="ai-val">${val}</span></label>`;
}

export const attendImportViews = {
  toeschouwers: {
    title: 'Toeschouwers importeren',
    navKey: 'meer',
    async render() {
      return `<header class="page-head"><div class="page-head__titles">
          <a class="back-btn" href="#/nachtploeg" aria-label="Terug">${icons.back}</a>
          <span class="page-head__kicker">Nachtploeg / Compleetheid</span>
          <h1 class="page-head__title">Toeschouwers importeren</h1></div></header>
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">Plak per regel een datum en een aantal, bijvoorbeeld <span class="mono">2025-08-15 12.236</span> of <span class="mono">15-08-2025 Cambuur – TOP Oss 12236</span>. De app zoekt het Cambuur-duel op die dag. Wat je zelf al hebt ingevuld, blijft staan, tenzij je het per regel aanvinkt.</p>
          <textarea class="ai-input" data-ai-text rows="10" spellcheck="false" placeholder="2025-08-08 2.544&#10;2025-08-25 850"></textarea>
          <div style="margin-top:12px"><button class="btn" type="button" data-ai-check>Controleren</button></div>
        </section>
        <section class="section" data-ai-plan hidden></section>`;
    },
    mount(root, ctx) {
      let plan = [];
      const box = root.querySelector('[data-ai-plan]');
      root.querySelector('[data-ai-check]').addEventListener('click', async () => {
        const [matches, notes] = await Promise.all([getAllMatches(), getAllNotes().catch(() => ({}))]);
        plan = planImport(root.querySelector('[data-ai-text]').value, matches, notes);
        const count = (s) => plan.filter((r) => r.status === s).length;
        box.hidden = false;
        box.innerHTML = plan.length ? `<div class="section__label"><span>Voorbeeld</span><span>${count('nieuw')} nieuw · ${count('gelijk')} gelijk · ${count('anders')} anders · ${count('fout')} overgeslagen</span></div>
          <div class="ai-list">${plan.map(rowHtml).join('')}</div>
          <div style="margin-top:12px"><button class="btn btn--primary" type="button" data-ai-save>Aangevinkte opslaan</button></div>` : '<p class="muted">Geen regels gevonden.</p>';
      });
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-ai-save]');
        if (!b) return;
        const picked = [...box.querySelectorAll('input[name="ai"]:checked')].map((x) => plan[Number(x.value)]);
        if (!picked.length) { toast('Niets aangevinkt'); return; }
        b.disabled = true;
        try {
          await saveNotesBatch(picked.map((r) => [r.m.id, { attendance: r.n, attendanceSrc: 'import' }]));
          toast(`${picked.length} ${picked.length === 1 ? 'aantal' : 'aantallen'} opgeslagen`);
          root.querySelector('[data-ai-text]').value = '';
          box.hidden = true; plan = [];
        } catch (err) { toast(err.message || String(err)); b.disabled = false; }
      });
    },
  },
};
