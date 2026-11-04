// Meer → Nachtploeg: stand, wachtrij, brievenbus en logboek.

import { esc, icons, toast } from './ui.js';
import { ns } from './api.js';
import { getMeta, noteRateLimit } from './store.js';
import { pushQueue, emptyInbox, getPrefs, setPrefs, FIRST_BACKFILL } from './nightshift.js';
import { runWithButton, explain } from './matchviews.js';
import { dayShort, timeOf } from './season.js';
import { mountCompleteness } from './completeness.js';

const MODE_LABEL = {
  off: ['Uit', 'De wekker doet niets.'],
  free: ['Gratis', "Elke avond vanaf 23:00 (in de winter 22:00) elke 10 minuten een ronde van max. 40 calls, tot er nog 15 over zijn. In het laatste half uur voor de reset (01:30, in de winter 00:30) gaat hij door tot er 3 over zijn: die zouden anders ongebruikt verlopen."],
  turbo: ['Turbo', 'Elke minuut een ronde van 40 calls, zonder reserve. Alleen voor een betaald Highlightly-abonnement.'],
};
const TYPE_LABEL = { full: 'Cambuur-details', lfull: 'volledige duels andere clubs', lineups: 'opstellingen (keepers)', events: 'schutters andere duels', league: 'competitielijsten', program: 'programma', standings: 'standen' };
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
      const [prefs, last, q, nsErr] = await Promise.all([getPrefs(), getMeta('nsLast').catch(() => null), getMeta('nsQueue').catch(() => null), getMeta('nsError').catch(() => null)]);
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
          ${st.state.pausedUntil && st.state.pausedUntil > Date.now() ? `<p class="warn-line">Opslaan in de brievenbus lukte 3 keer niet. De wekker pauzeert tot ${esc(timeOf(new Date(st.state.pausedUntil).toISOString()))}; zie het logboek. "Nu een ronde" werkt wel.</p>` : ''}
          <p class="muted" style="font-size:var(--fs-sm)">Opgebouwd ${esc(when(q && q.at))}. Highlightly-calls over volgens de laatste ronde: <span class="mono">${st.state.remaining ?? '?'}</span>.</p>
          ${st.kv ? `<p class="muted" style="font-size:var(--fs-sm)">Cloudflare-opslag (${esc(st.kv.store || 'KV')}) vandaag: <span class="mono">${st.kv.used} van ${st.kv.budget}</span> schrijfacties voor de nachtploeg${st.kv.used + 2 > st.kv.allowedNow ? ` · nu even op (gespreid over de dag; om dit uur mogen er ${st.kv.allowedNow})` : ''}. ${st.kv.store === 'D1' ? 'D1 (gratis): 100.000 rijen per dag' : 'Gratis Cloudflare geeft 1.000 per dag; de rest blijft voor live en meldingen'}. Nieuwe dag om 01:00.</p>` : ''}
          <label class="field field--check"><input type="checkbox" data-backfill ${prefs.backfill ? 'checked' : ''}> <span>Ook oude seizoenen ophalen (vanaf ${FIRST_BACKFILL}–${String(FIRST_BACKFILL + 1).slice(2)})</span></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" type="button" data-ns="queue">${icons.refresh}<span>Wachtrij opbouwen</span></button>
            <button class="btn" type="button" data-ns="run">Nu een ronde · max 40 calls</button>
          </div>
        </section>
        <section class="section">
          <div class="section__label"><span>Compleetheid</span><span>per seizoen</span></div>
          <div data-complete><p class="muted" style="font-size:var(--fs-sm)">Tellen…</p></div>
        </section>
        <section class="section">
          <div class="section__label"><span>Brievenbus</span><span>${(st.inbox || []).length}</span></div>
          <p class="muted" style="font-size:var(--fs-md)">${(st.inbox || []).length ? `${st.inbox.length} ${st.inbox.length === 1 ? 'pakketje wacht' : 'pakketjes wachten'} op verwerking.` : 'Leeg.'}${last ? ` Laatst verwerkt ${esc(when(last.at))}: ${last.items} items.` : ''}</p>
          ${nsErr && Date.now() - Date.parse(nsErr.at) < 7 * 864e5 ? `<p class="warn-line" style="font-size:var(--fs-sm)">Laatste fout bij verwerken (${esc(when(nsErr.at))}, ${esc(TYPE_LABEL[nsErr.type] || nsErr.type)}${nsErr.id ? ` ${esc(nsErr.id)}` : ''}): ${esc(nsErr.message)}</p>` : ''}
          <div><button class="btn btn--primary" type="button" data-ns="empty" ${(st.inbox || []).length ? '' : 'disabled'}>Brievenbus legen</button></div>
        </section>
        <section class="section">
          <div class="section__label"><span>Logboek</span><span>laatste rondes</span></div>
          ${log.length ? `<div class="list">${log.slice(0, 12).map((l) => `<div class="kv-line"><span>${esc(when(l.at))} <span class="muted">· ${esc(l.why)}</span></span><span class="mono">${l.calls} calls · ${l.items} items${l.stop === 'reserve' ? ` · reserve${l.reserve ? ` ${l.reserve}` : ''}` : l.stop === 'quota' ? ' · quotum op' : l.stop === 'opslag' ? ' · opslaan mislukt' : ''}</span></div>${l.error ? `<p class="warn-line" style="font-size:var(--fs-sm)">${esc(l.error)}</p>` : ''}`).join('')}</div>` : '<p class="muted" style="font-size:var(--fs-md)">Nog geen rondes gedraaid.</p>'}
        </section>`;
    },
    mount(root, ctx) {
      mountCompleteness(root, ctx);
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
          if (b.dataset.ns === 'run') { const r = await runWithButton(b, 'Bezig…', () => ns.runNow()); toast(r.error ? `Ronde: ${r.calls} calls, opslaan mislukt: ${r.error}` : `Ronde: ${r.calls} calls, ${r.items} items${r.stop ? ` (${r.stop === 'reserve' ? 'reserve bereikt' : r.stop === 'kv-budget' ? 'opslagbudget op' : 'quotum op'})` : ''}`, r.error ? { duration: 8000 } : undefined); }
          if (b.dataset.ns === 'empty') { const s = await runWithButton(b, 'Verwerken… laat dit scherm open', () => emptyInbox((sum, total) => { b.innerHTML = `<span>Verwerken… ${sum.chunks} van ${total} · laat dit scherm open</span>`; })); toast(s.items ? `${s.items} items verwerkt${s.repaired ? ` · ${s.repaired} duels gerepareerd` : ''}${s.errors ? ` · ${s.errors} mislukt` : ''}${s.left ? ` · ${s.left} pakketjes morgen (dagbudget Firestore)` : ''}` : s.repaired ? `${s.repaired} duels gerepareerd` : 'De brievenbus was al leeg: de app had hem bij het openen al verwerkt.', { duration: 6000 }); ctx.refresh(); }
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
