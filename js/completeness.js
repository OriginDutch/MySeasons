// Meer → Nachtploeg → Compleetheid: per seizoen hoeveel er binnen is. Alles uit wat er al ligt (de competitie-index
// en je eigen wedstrijden), dus geen Highlightly-calls. Alleen de knop "Lijst opnieuw ophalen" kost calls (±4).

import { esc, toast } from './ui.js';
import { MAIN_CLUB, CURRENT_SEASON } from './config.js';
import { getLeagueIndexes, getAllMatches, getAllNotes, hasDetail } from './store.js';
import { seasonLabel } from './seasonstate.js';

const TABS = [['75672', 'ED'], ['76523', 'KKD'], ['77374', 'Beker'], ['own', 'Cambuur']];
// Wat een volledig seizoen minstens heeft (zonder play-offs). Minder = de lijst is waarschijnlijk niet compleet.
const EXPECTED = { 75672: 306, 76523: 380 };
const KEY = 'ms-complete-tab';
const official = (m) => m.league && !/friendl/i.test(m.league.name || '');
const isOwn = (m) => [m.homeTeam, m.awayTeam].some((t) => t && t.id === MAIN_CLUB.id);
const pct = (a, b) => (b ? Math.floor((a / b) * 100) : null);

function bar(a, b) {
  const p = pct(a, b);
  if (p == null) return '<span class="cp-cell muted">—</span>';
  const tone = p >= 100 ? 'full' : p >= 50 ? 'half' : 'low';
  return `<span class="cp-cell"><span class="mono">${p}%</span><span class="cp-bar"><span class="cp-bar__fill cp-bar__fill--${tone}" style="width:${p}%"></span></span></span>`;
}

const left = (a, b, what) => (b - a > 0 ? `<li>${what}: <span class="mono">${a}</span> van <span class="mono">${b}</span> · nog <span class="mono">${b - a}</span></li>` : `<li>${what}: alles binnen (<span class="mono">${b}</span>)</li>`);

/** Eén competitie: per seizoen events, opstellingen en volledig verloop van de gespeelde duels zonder Cambuur. */
function leagueRows(indexes, leagueId, ownIds) {
  const rows = indexes.filter((i) => Number(i.leagueId) === Number(leagueId)).sort((a, b) => b.season - a.season);
  if (!rows.length) return '<p class="muted" style="font-size:var(--fs-md)">Nog niets van deze competitie opgehaald.</p>';
  let tf = 0; let tn = 0;
  const html = rows.map((i) => {
    const fin = (i.finished || []).filter((id) => !ownIds.has(String(id)));
    const has = (k) => { const s = new Set((i[k] || []).map(String)); return fin.filter((id) => s.has(String(id))).length; };
    const ev = has('withEvents'); const lu = has('withLineups'); const fu = has('withFull');
    tf += fu; tn += fin.length;
    const ids = (i.ids || []).length;
    const exp = EXPECTED[leagueId];
    const short = exp && Number(i.season) !== CURRENT_SEASON && ids < exp;
    return `<details class="cp-row">
      <summary class="cp-grid"><span class="cp-season">${esc(seasonLabel(i.season))}${short ? ' <span class="cp-warn" title="Lijst lijkt niet compleet">⚠</span>' : ''}</span>${bar(ev, fin.length)}${bar(lu, fin.length)}${bar(fu, fin.length)}</summary>
      <div class="cp-more">
        <ul>
          <li>Lijst: <span class="mono">${ids}</span> duels, <span class="mono">${(i.finished || []).length}</span> gespeeld${fin.length !== (i.finished || []).length ? ` (waarvan <span class="mono">${(i.finished || []).length - fin.length}</span> van Cambuur, die tellen hieronder niet mee)` : ''}${short ? `. Een volledig seizoen heeft er minstens <span class="mono">${exp}</span>: de lijst is waarschijnlijk niet compleet.` : ''}</li>
          ${left(ev, fin.length, 'Schutters en kaarten')}
          ${left(lu, fin.length, 'Opstellingen')}
          ${left(fu, fin.length, 'Volledig verloop')}
        </ul>
        <button class="btn btn--sm" type="button" data-cp-sync="${esc(leagueId)}" data-season="${esc(i.season)}">Lijst opnieuw ophalen · ±4 calls</button>
      </div>
    </details>`;
  }).join('');
  return `<p class="muted" style="font-size:var(--fs-sm)">Gespeelde duels zonder Cambuur. Volledig verloop over alle seizoenen: <span class="mono">${tf}</span> van <span class="mono">${tn}</span> (<span class="mono">${pct(tf, tn) ?? 0}%</span>). Tik op een seizoen voor de aantallen.</p>
    <div class="cp-grid cp-head"><span>Seizoen</span><span>Events</span><span>Opst.</span><span>Verloop</span></div>${html}`;
}

/** Cambuur zelf: officiële gespeelde duels, details en ingevoerd publiek. */
function ownRows(matches, notes) {
  const by = new Map();
  matches.filter((m) => isOwn(m) && official(m) && m.status === 'finished' && m.league && m.league.season != null).forEach((m) => {
    const y = Number(m.league.season);
    if (!by.has(y)) by.set(y, []);
    by.get(y).push(m);
  });
  if (!by.size) return '<p class="muted" style="font-size:var(--fs-md)">Nog geen wedstrijden.</p>';
  const html = [...by.entries()].sort((a, b) => b[0] - a[0]).map(([y, list]) => {
    const n = list.length;
    const det = list.filter((m) => hasDetail(m) || (notes[m.id] && notes[m.id].manual)).length;
    const pub = list.filter((m) => notes[m.id] && notes[m.id].attendance != null).length;
    const home = list.filter((m) => m.homeTeam && m.homeTeam.id === MAIN_CLUB.id);
    const homePub = home.filter((m) => notes[m.id] && notes[m.id].attendance != null).length;
    const rsssf = list.filter((m) => String(m.id).startsWith('manual-')).length;
    return `<details class="cp-row">
      <summary class="cp-grid cp-grid--3"><span class="cp-season">${esc(seasonLabel(y))}</span><span class="cp-cell"><span class="mono">${n}</span></span>${bar(det, n)}${bar(pub, n)}</summary>
      <div class="cp-more"><ul>
        <li>Officieel gespeeld: <span class="mono">${n}</span>${rsssf ? ` (waarvan <span class="mono">${rsssf}</span> zelf toegevoegd, bijv. uit RSSSF)` : ''}</li>
        ${left(det, n, 'Details (opstellingen, events)')}
        ${left(pub, n, 'Toeschouwers ingevuld')}
        <li>Daarvan thuis: <span class="mono">${homePub}</span> van <span class="mono">${home.length}</span></li>
      </ul></div>
    </details>`;
  }).join('');
  return `<p class="muted" style="font-size:var(--fs-sm)">Officiële duels (geen oefenduels). Toeschouwers vul je zelf in; dat haalt geen API op. Een lijst uit bijv. Wikipedia? <a href="#/toeschouwers">Toeschouwers importeren →</a></p>
    <div class="cp-grid cp-grid--3 cp-head"><span>Seizoen</span><span>Duels</span><span>Details</span><span>Publiek</span></div>${html}`;
}

function savedTab() { try { return localStorage.getItem(KEY) || '75672'; } catch { return '75672'; } }

/** Het blok onder de wachtrij. Wordt pas na het tekenen van de pagina gevuld (een paar Firestore-reads). */
export async function completenessHtml() {
  const [indexes, matches, notes] = await Promise.all([getLeagueIndexes().catch(() => []), getAllMatches().catch(() => []), getAllNotes().catch(() => ({}))]);
  const ownIds = new Set(matches.filter(isOwn).map((m) => String(m.id)));
  const tab = TABS.some(([k]) => k === savedTab()) ? savedTab() : '75672';
  return `<fieldset class="segmented segmented--4" style="margin:0;padding:0"><legend class="visually-hidden">Competitie</legend>
      ${TABS.map(([k, l]) => `<input type="radio" name="cp-tab" id="cp-${k}" value="${k}" ${tab === k ? 'checked' : ''}><label for="cp-${k}">${l}</label>`).join('')}
    </fieldset>
    ${TABS.map(([k]) => `<div data-cp-panel="${k}" ${tab === k ? '' : 'hidden'}>${k === 'own' ? ownRows(matches, notes) : leagueRows(indexes, Number(k), ownIds)}</div>`).join('')}`;
}

export async function mountCompleteness(root, ctx) {
  const box = root.querySelector('[data-complete]');
  if (!box) return;
  try { box.innerHTML = await completenessHtml(); } catch (err) { box.innerHTML = `<p class="warn-line">${esc(err.message || String(err))}</p>`; return; }
  box.querySelectorAll('input[name="cp-tab"]').forEach((r) => r.addEventListener('change', () => {
    box.querySelectorAll('[data-cp-panel]').forEach((el) => { el.hidden = el.dataset.cpPanel !== r.value; });
    try { localStorage.setItem(KEY, r.value); } catch { /* niet erg */ }
  }));
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cp-sync]');
    if (!b) return;
    b.disabled = true; const label = b.textContent; b.textContent = 'Ophalen…';
    try {
      const { syncLeague } = await import('./sync.js');
      const r = await syncLeague(Number(b.dataset.cpSync), Number(b.dataset.season));
      toast(`${r.count} duels in de lijst · ${r.calls} ${r.calls === 1 ? 'call' : 'calls'}. Bouw daarna de wachtrij opnieuw op.`, { duration: 6000 });
      ctx.refresh();
    } catch (err) { toast(err.message || String(err)); b.disabled = false; b.textContent = label; }
  });
}
