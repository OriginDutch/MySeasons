// Inbox in de app: meldingen die je niet hoeven te storen, maar wel ergens moeten staan.
// Twee soorten:
//  - afgeleid: berekend uit je data bij het openen (aanvullen, afwijkingen, ontbrekende details,
//    back-up, blessure voorbij de verwachte terugkeer, aflopend contract). Verdwijnt vanzelf als het klaar is.
//  - bewaard: gebeurtenissen (resultaat van de nachtploeg), in meta/inbox.items.
// Gelezen = id staat in meta/inbox.seen. Wegdoen = id in meta/inbox.dismissed.

import { esc, icons, toast } from './ui.js';
import { getMeta, setMeta } from './store.js';
import { MAIN_CLUB } from './config.js';
import { missingDetails } from './sync.js';
import { isCurrentSeason } from './seasonstate.js';
import { dayShort } from './season.js';
import { correctedList, matchTitle, scoreText } from './matchviews.js';
import { injuredOn } from './playerextra.js';

const MAX_ITEMS = 60; const MAX_SEEN = 400;
const TEAM = MAIN_CLUB.id;

function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'net';
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gisteren' : d < 7 ? `${d} dagen geleden` : dayShort(iso);
}

async function state() {
  const s = (await getMeta('inbox').catch(() => null)) || {};
  return { items: s.items || [], seen: s.seen || [], dismissed: s.dismissed || [] };
}

/** Bewaarde melding toevoegen (bijv. na de nachtploeg). */
export async function addMessage(msg) {
  const s = await state();
  const item = { at: new Date().toISOString(), ...msg, id: msg.id || `m:${Date.now()}` };
  const items = [item, ...s.items.filter((x) => x.id !== item.id)].slice(0, MAX_ITEMS);
  await setMeta('inbox', { items });
  return item;
}

const KIND = {
  fill: 'Aanvullen', conflicts: 'Afwijkingen', details: 'Details', backup: 'Back-up',
  injury: 'Blessure', contract: 'Contract', nightshift: 'Nachtploeg', info: 'Melding',
};

/** Afgeleide meldingen uit je data. */
function derived({ list, profiles, conflicts, backup }) {
  const out = [];
  const today = new Date().toISOString().slice(0, 10);
  const official = list.filter((m) => m.league && !/friendl/i.test(m.league.name));
  // 1. Wedstrijden van de afgelopen 14 dagen zonder toeschouwers of notitie
  official.filter((m) => m.status === 'finished' && (Date.now() - Date.parse(m.date)) < 14 * 864e5)
    .filter((m) => { const n = m.notes || {}; return n.attendance == null && !n.note; })
    .forEach((m) => out.push({ id: `fill:${m.id}`, kind: 'fill', at: new Date(Date.parse(m.date) + 2 * 3600e3).toISOString(), title: `${matchTitle(m)} ${scoreText(m).replace(/<[^>]+>/g, '')}`, text: 'Toeschouwers, uitvak, man van de wedstrijd of een notitie ontbreken nog.', href: `#/wedstrijd/${m.id}` }));
  // 2. Afwijkingen tussen jouw correcties en Highlightly
  if (conflicts) out.push({ id: `conflicts:${conflicts}`, kind: 'conflicts', at: null, title: `${conflicts} ${conflicts === 1 ? 'afwijking' : 'afwijkingen'} om na te kijken`, text: 'Highlightly zegt iets anders dan jouw correctie. Jij beslist wat klopt.', href: '#/afwijkingen' });
  // 3. Gespeeld maar nog zonder details (telt niet mee in de spelersstats)
  if (isCurrentSeason()) {
    const miss = missingDetails(list).length;
    if (miss) out.push({ id: `details:${miss}`, kind: 'details', at: null, title: `${miss} ${miss === 1 ? 'wedstrijd' : 'wedstrijden'} zonder details`, text: 'Die tellen nog niet mee in de spelersstats. Ophalen kost 3 calls per wedstrijd.', href: '#/selectie' });
  }
  // 4. Back-up: nooit, of langer dan 30 dagen geleden
  if (list.length) {
    const age = backup && backup.at ? (Date.now() - Date.parse(backup.at)) / 864e5 : null;
    if (age == null || age > 30) out.push({ id: `backup:${today.slice(0, 7)}`, kind: 'backup', at: null, title: age == null ? 'Nog nooit een back-up gemaakt' : `Laatste back-up ${Math.floor(age)} dagen geleden`, text: 'Eén bestand met al je aanvullingen, correcties en spelers. Kost een paar seconden.', href: '#/backup' });
  }
  // 5. Spelers: blessure voorbij de verwachte terugkeer, contract dat binnen 90 dagen afloopt
  Object.entries(profiles || {}).forEach(([id, pr]) => {
    if (!pr || pr.linkedTo) return;
    const name = pr.fullName || pr.legacyName || 'Speler';
    const inj = injuredOn(pr, today);
    if (inj && inj.expected && inj.expected < today) {
      out.push({ id: `injury:${id}:${inj.startDate}`, kind: 'injury', at: `${inj.expected}T08:00:00Z`, title: `Is ${name} terug?`, text: `Verwacht terug op ${dayShort(inj.expected + 'T12:00:00')} (${(inj.type || 'blessure').toLowerCase()}). Vul "echt terug" in, of schuif de verwachting op.`, href: `#/speler/${encodeURIComponent(id)}` });
    }
    if (pr.contractUntil && pr.contractUntil >= today) {
      const days = (Date.parse(pr.contractUntil) - Date.now()) / 864e5;
      if (days <= 90 && !(pr.transfers || []).some((t) => t.type === 'transfer-uit' && t.date >= today)) {
        out.push({ id: `contract:${id}:${pr.contractUntil}`, kind: 'contract', at: null, title: `Contract ${name} loopt af`, text: `Tot ${dayShort(pr.contractUntil + 'T12:00:00')}. Verlengd? Voeg een verlenging toe en pas de datum aan.`, href: `#/speler/${encodeURIComponent(id)}` });
      }
    }
  });
  return out;
}

/** Alle meldingen, nieuwste eerst, zonder weggedane. ctx mag list/profiles/conflicts al bevatten. */
export async function inboxItems(ctx = null) {
  const c = ctx && ctx.list ? ctx : await correctedList();
  const [s, manual, auto] = await Promise.all([state(), getMeta('backup').catch(() => null), getMeta('autoBackup').catch(() => null)]);
  const backup = [manual, auto].filter((b) => b && b.at).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  const all = [...derived({ list: c.list, profiles: c.profiles, conflicts: c.conflicts || 0, backup }), ...s.items];
  const dismissed = new Set(s.dismissed); const seen = new Set(s.seen);
  return all.filter((m) => !dismissed.has(m.id))
    .map((m) => ({ ...m, unread: !seen.has(m.id) }))
    .sort((a, b) => (b.unread - a.unread) || String(b.at || '9').localeCompare(String(a.at || '9')));
}

export async function unreadCount(ctx) {
  return (await inboxItems(ctx)).filter((m) => m.unread).length;
}

async function markSeen(ids) {
  const s = await state();
  const seen = [...new Set([...ids, ...s.seen])].slice(0, MAX_SEEN);
  await setMeta('inbox', { seen });
}

async function dismiss(id, undo = false) {
  const s = await state();
  const dismissed = undo ? s.dismissed.filter((x) => x !== id) : [...new Set([id, ...s.dismissed])].slice(0, MAX_SEEN);
  await setMeta('inbox', { dismissed });
}

/** Belletje met teller, voor de kop van Home. */
export function bellButton(n) {
  return `<a class="bell" href="#/inbox" aria-label="Inbox${n ? `, ${n} nieuw` : ''}">${icons.bell}${n ? `<span class="bell__n mono">${n > 9 ? '9+' : n}</span>` : ''}</a>`;
}

export const inboxViews = {
  inbox: {
    title: 'Inbox',
    navKey: 'home',
    async render() {
      const items = await inboxItems();
      this._ids = items.filter((m) => m.unread).map((m) => m.id);
      const head = `<header class="page-head"><div class="page-head__titles">
        <a class="back-btn" href="#/home" aria-label="Terug">${icons.back}</a>
        <span class="page-head__kicker">Home / Inbox</span><h1 class="page-head__title">Inbox</h1></div></header>`;
      if (!items.length) {
        return `${head}<section class="section"><div class="empty"><span class="empty__title">Niets te doen</span>
          <p class="muted">Hier verschijnt wat je nog kunt aanvullen of nakijken, en wat de nachtploeg heeft binnengehaald.</p></div></section>`;
      }
      return `${head}
        <section class="section">
          <div class="list inbox">${items.map((m) => `
            <div class="inbox__row ${m.unread ? 'is-unread' : ''}" data-id="${esc(m.id)}">
              <a class="inbox__main" href="${esc(m.href || '#/inbox')}">
                <span class="inbox__kicker mono">${m.unread ? '<i class="inbox__dot"></i>' : ''}${esc(KIND[m.kind] || 'Melding')}${m.at ? ` · ${esc(ago(m.at))}` : ''}</span>
                <span class="inbox__title">${esc(m.title)}</span>
                ${m.text ? `<span class="inbox__text muted">${esc(m.text)}</span>` : ''}
              </a>
              <button class="inbox__x" type="button" data-dismiss="${esc(m.id)}" aria-label="Wegdoen">×</button>
            </div>`).join('')}</div>
          <p class="muted" style="font-size:12px">Wegdoen verbergt een melding. Meldingen over je data verdwijnen ook vanzelf zodra het geregeld is.</p>
        </section>`;
    },
    mount(root, ctx) {
      // Openen = gelezen (de stip blijft zichtbaar tot je weer terugkomt).
      if (this._ids && this._ids.length) markSeen(this._ids).catch(() => {});
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-dismiss]');
        if (!b) return;
        const id = b.dataset.dismiss;
        const row = b.closest('.inbox__row'); if (row) row.hidden = true;
        try {
          await dismiss(id);
          toast('Weggedaan', { action: 'Ongedaan maken', onAction: async () => { await dismiss(id, true); ctx.refresh(); } });
        } catch (err) { if (row) row.hidden = false; toast(`Lukte niet: ${err.message || err}`); }
      });
    },
  },
};
