// Meer → Nachtploeg: stand, wachtrij, brievenbus en logboek.

import { esc, icons, toast } from './ui.js';
import { ns } from './api.js';
import { getMeta, noteRateLimit } from './store.js';
import { pushQueue, emptyInbox, getPrefs, setPrefs, FIRST_BACKFILL } from './nightshift.js';
import { runWithButton, explain } from './matchviews.js';
import { dayShort, timeOf } from './season.js';

const MODE_LABEL = {
  off: ['Uit', 'De wekker doet niets.'],
  free: ['Gratis', "Elke avond vanaf 23:00 (in de winter 22:00) elke 10 minuten een ronde van max. 40 calls, tot er nog 15 over zijn."],
  turbo: ['Turbo', 'Elke minuut een ronde van 40 calls, zonder reserve. Alleen voor een betaald Highlightly-abonnement.'],
};
const TYPE_LABEL = { full: 'Cambuur-details', events: 'schutters andere duels', league: 'competitielijsten', program: 'programma', standings: 'standen' };
const when = (iso) => (iso ? `${dayShort(iso)} ${timeOf(iso)}` : '—');

export const nightViews = {
  nachtploeg: {
    title: 'Nachtploeg',
    navKey: 'meer',
    async render() {
      const head = `<header class="page-head"><div class="page-head__titles">
        <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
        <span class="page-head__kicker">Meer / Nachtploeg</span><h1 class="page-head__title">Nachtploeg</h1></div></header>`;
      let st;
      try { st = await ns.state(); } catch (err) {
        return `${head}<section class="section"><div class="empty"><span class="empty__title">Worker nog niet klaar</span>
          <p class="muted">${esc(err.status === 501 ? 'De KV-opslag (MS_KV) is nog niet gekoppeld aan de Worker.' : err.status === 404 || err.status === 405 ? 'De Worker kent de nachtploeg nog niet: de nieuwe code is nog niet gedeployd.' : explain(err))}</p></div></section>`;
      }
      const [prefs, last, q] = await Promise.all([getPrefs(), getMeta('nsLast').catch(() => null), getMeta('nsQueue').catch(() => null)]);
      if (st.state.lastRun) noteRateLimit({ remaining: st.state.remaining, at: st.state.lastRun }).catch(() => {});
      const mode = st.state.mode || 'free';
      const log = st.state.log || [];
      return `${head}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">De Worker haalt met je overgebleven quotum details en schutters op en legt ze in een brievenbus. Open je de app, dan zet hij ze in je database.</p>
          <fieldset class="segmented segmented--3" style="margin:0;padding:0"><legend class="visually-hidden">Stand</legend>
            ${Object.entries(MODE_LABEL).map(([v, [l]]) => `<input type="radio" name="ns-mode" id="ns-${v}" value="${v}" ${mode === v ? 'checked' : ''}><label for="ns-${v}">${l}</label>`).join('')}
          </fieldset>
          <p class="muted" style="font-size:var(--fs-sm)" data-mode-help>${esc(MODE_LABEL[mode][1])}</p>
        </section>
        <section class="section">
          <div class="section__label"><span>Wachtrij</span><span>${st.queue}</span></div>
          ${st.queue ? `<div class="list">${Object.entries(st.byType || {}).map(([t, n]) => `<div class="kv-line"><span>${esc(TYPE_LABEL[t] || t)}</span><span class="mono">${n}</span></div>`).join('')}</div>` : '<p class="muted" style="font-size:var(--fs-md)">Leeg. Alles wat we kennen is binnen.</p>'}
          <p class="muted" style="font-size:var(--fs-sm)">Opgebouwd ${esc(when(q && q.at))}. Highlightly-calls over volgens de laatste ronde: <span class="mono">${st.state.remaining ?? '?'}</span>.</p>
          <label class="field field--check"><input type="checkbox" data-backfill ${prefs.backfill ? 'checked' : ''}> <span>Ook oude seizoenen ophalen (vanaf ${FIRST_BACKFILL}–${String(FIRST_BACKFILL + 1).slice(2)})</span></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" type="button" data-ns="queue">${icons.refresh}<span>Wachtrij opbouwen</span></button>
            <button class="btn" type="button" data-ns="run">Nu een ronde · max 40 calls</button>
          </div>
        </section>
        <section class="section">
          <div class="section__label"><span>Brievenbus</span><span>${(st.inbox || []).length}</span></div>
          <p class="muted" style="font-size:var(--fs-md)">${(st.inbox || []).length ? `${st.inbox.length} ${st.inbox.length === 1 ? 'pakketje wacht' : 'pakketjes wachten'} op verwerking.` : 'Leeg.'}${last ? ` Laatst verwerkt ${esc(when(last.at))}: ${last.items} items.` : ''}</p>
          <div><button class="btn btn--primary" type="button" data-ns="empty" ${(st.inbox || []).length ? '' : 'disabled'}>Brievenbus legen</button></div>
        </section>
        <section class="section">
          <div class="section__label"><span>Logboek</span><span>laatste rondes</span></div>
          ${log.length ? `<div class="list">${log.slice(0, 12).map((l) => `<div class="kv-line"><span>${esc(when(l.at))} <span class="muted">· ${esc(l.why)}</span></span><span class="mono">${l.calls} calls · ${l.items} items${l.stop === 'reserve' ? ' · reserve' : l.stop === 'quota' ? ' · quotum op' : ''}</span></div>`).join('')}</div>` : '<p class="muted" style="font-size:var(--fs-md)">Nog geen rondes gedraaid.</p>'}
        </section>`;
    },
    mount(root, ctx) {
      root.querySelectorAll('input[name="ns-mode"]').forEach((i) => i.addEventListener('change', async () => {
        if (i.value === 'turbo' && !confirmTurbo()) { ctx.refresh(); return; }
        try { await ns.setMode(i.value); toast(`Nachtploeg: ${MODE_LABEL[i.value][0]}`); ctx.refresh(); } catch (err) { toast(explain(err)); }
      }));
      const bf = root.querySelector('[data-backfill]');
      if (bf) bf.addEventListener('change', async () => { await setPrefs({ backfill: bf.checked }); toast(bf.checked ? 'Oude seizoenen gaan mee bij de volgende wachtrij' : 'Alleen opgehaalde seizoenen'); });
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-ns]');
        if (!b) return;
        try {
          if (b.dataset.ns === 'queue') { const n = await runWithButton(b, 'Opbouwen…', () => pushQueue()); toast(`Wachtrij: ${n} items`); }
          if (b.dataset.ns === 'run') { const r = await runWithButton(b, 'Bezig…', () => ns.runNow()); toast(`Ronde: ${r.calls} calls, ${r.items} items${r.stop ? ` (${r.stop === 'reserve' ? 'reserve bereikt' : 'quotum op'})` : ''}`); }
          if (b.dataset.ns === 'empty') { const s = await runWithButton(b, 'Verwerken…', () => emptyInbox()); toast(s.items ? `${s.items} items verwerkt${s.left ? ` · ${s.left} pakketjes morgen (dagbudget Firestore)` : ''}` : 'De brievenbus was al leeg: de app had hem bij het openen al verwerkt.'); ctx.refresh(); }
          ctx.refresh();
        } catch (err) { toast(explain(err)); }
      });
    },
  },
};

// Bewust geen browser-dialoog (die blokkeert alles): een tweede tik bevestigt.
let turboArmed = 0;
function confirmTurbo() {
  if (Date.now() - turboArmed < 8000) return true;
  turboArmed = Date.now();
  toast('Turbo gebruikt je hele quotum, zonder reserve. Alleen met een betaald abonnement. Tik nog een keer op Turbo om te bevestigen.', { duration: 8000 });
  return false;
}
