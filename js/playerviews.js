// Selectie en spelerspagina's.

import { esc, toast } from './ui.js';
import { savePlayer } from './store.js';
import { autoShort } from './names.js';
import { openSheet } from './editor.js';
import { MAIN_CLUB } from './config.js';
import { seasonLabel } from './seasonstate.js';
import { COST, missingDetails, fetchMany } from './sync.js';
import { buildSquad, playerFacts, LINES, LINE_SHORT } from './players.js';
import { correctedList, runWithButton, explain, head, crest } from './matchviews.js';
import { dayShort, opponentOf, isHome } from './season.js';

const TEAM = MAIN_CLUB.id;
const r1 = (v) => (v == null ? '–' : v.toFixed(2));

function missingBlock(list) {
  const miss = missingDetails(list);
  if (!miss.length) return '';
  const calls = miss.length * COST.match;
  return `
    <section class="section">
      <div class="warn-line">${miss.length} gespeelde ${miss.length === 1 ? 'wedstrijd heeft' : 'wedstrijden hebben'} nog geen details, dus die tellen nog niet mee in de spelersstats.</div>
      <div><button class="btn btn--primary" type="button" data-action="fetch-missing">Ontbrekende details ophalen · ${calls} calls</button></div>
    </section>`;
}

async function handleMissing(btn, ctx) {
  const { list } = await correctedList();
  const miss = missingDetails(list);
  let done = 0;
  try {
    await runWithButton(btn, `Ophalen 0/${miss.length}…`, () => fetchMany(miss, (n, total) => {
      done = n;
      btn.innerHTML = `<span>Ophalen ${n}/${total}…</span>`;
    }));
    toast(`${done} wedstrijden opgehaald · ${done * COST.match} calls`);
  } catch (err) {
    toast(`${done} opgehaald, daarna fout: ${explain(err)}`);
  }
  ctx.refresh();
}

const euro = (v) => (v == null ? '—' : v >= 1e6 ? `€${(v / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} mln` : `€${Math.round(v / 1e3).toLocaleString('nl-NL')}k`);
const dmy = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
function ageOf(dob) {
  if (!dob) return null;
  const b = new Date(dob + 'T12:00:00'); const n = new Date();
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
}
const T_LABEL = { 'transfer-in': 'Gekomen', 'transfer-uit': 'Vertrokken', 'huur-in': 'Gehuurd', 'huur-uit': 'Verhuurd', promotie: 'Doorgestroomd', verlenging: 'Verlengd' };

function profileBlock(pr) {
  if (!pr || !pr.legacyId) return '';
  const age = ageOf(pr.dob);
  const val = pr.valueHistory && pr.valueHistory[0];
  const kv = [
    ['Geboren', pr.dob ? `${dmy(pr.dob)}${age != null ? ` (${age})` : ''}` : null],
    ['Nationaliteit', pr.nationality],
    ['Voet', pr.foot],
    ['Lengte', pr.height ? `${pr.height} cm` : null],
    ['Bij de club sinds', pr.joined ? dmy(pr.joined) : null],
    ['Contract tot', pr.contractUntil ? dmy(pr.contractUntil) : null],
    ['Marktwaarde', val ? `${euro(val.amount)} <span class="muted">· ${esc(dmy(val.date))}</span>` : null],
  ].filter(([, v]) => v);
  const trend = (pr.valueHistory || []).slice(0, 6).reverse();
  const max = Math.max(...trend.map((v) => v.amount || 0), 1);
  return `
    <section class="section">
      <div class="section__label"><span>Profiel</span><span>uit je oude tracker</span></div>
      <div class="profile">
        ${pr.photoUrl ? `<img class="profile__photo" src="${esc(pr.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Marktwaarde' ? v : esc(v)}</dd>`).join('')}</dl>
      </div>
      ${trend.length > 1 ? `<div class="value-bars" aria-label="Marktwaarde-verloop">${trend.map((v) => `<span class="value-bar"><i style="height:${Math.max(6, Math.round(((v.amount || 0) / max) * 48))}px"></i><small class="mono">${esc(String(v.date).slice(2, 7).replace('-', '/'))}</small></span>`).join('')}</div>` : ''}
      ${(pr.transfers || []).length ? `<div class="list">${pr.transfers.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((t) => `
        <div class="list-row" style="cursor:default"><span class="list-row__main"><span class="list-row__title">${esc(T_LABEL[t.type] || t.type)}${t.club ? ` · ${esc(t.club)}` : ''}</span>
        <span class="list-row__sub">${esc(dmy(t.date))}${t.dateTo ? ` t/m ${esc(dmy(t.dateTo))}` : ''}${t.amount ? ` · ${euro(t.amount)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</span></span></div>`).join('')}</div>` : ''}
      ${pr.note ? `<p class="note-text">${esc(pr.note)}</p>` : ''}
    </section>`;
}

const SORTS = [['line', 'Linie'], ['goals', 'Goals'], ['minutes', 'Minuten'], ['rating', 'Cijfer']];

function rowHtml(p, sort) {
  const sub = p.apps
    ? `${p.apps} ${p.apps === 1 ? 'duel' : 'duels'}${p.subIns ? ` (${p.subIns} in)` : ''} · ${p.minutes}'`
    : `${p.squads}× op de bank`;
  return `<a class="list-row player-row" href="#/speler/${p.id}">
    <span class="player-row__num mono">${p.number ?? ''}</span>
    <span class="list-row__main"><span class="list-row__title">${esc(p.name)}</span>
      <span class="list-row__sub">${sort === 'line' ? '' : esc(LINE_SHORT[p.position] || '—') + ' · '}${sub}</span></span>
    <span class="player-row__stats mono">
      <span title="Goals">${p.goals || '·'}</span><span title="Assists">${p.assists || '·'}</span>
      <span class="${p.rating >= 7 ? 'accent-text' : ''}" title="Gemiddeld cijfer">${p.rating == null ? '–' : p.rating.toFixed(1)}</span>
    </span>
  </a>`;
}

const statHead = '<div class="player-head mono"><span></span><span>G</span><span>A</span><span>Cijfer</span></div>';

function sorted(players, sort) {
  const by = {
    goals: (a, b) => b.goals - a.goals || b.assists - a.assists || b.minutes - a.minutes,
    minutes: (a, b) => b.minutes - a.minutes,
    rating: (a, b) => (b.rated >= 3) - (a.rated >= 3) || (b.rating ?? -1) - (a.rating ?? -1),
  }[sort];
  return players.slice().sort(by);
}

function squadList(players, sort) {
  if (sort !== 'line') {
    return `<section class="section">${statHead}<div class="list">${sorted(players, sort).map((p) => rowHtml(p, sort)).join('')}</div>
      ${sort === 'rating' ? '<p class="muted" style="font-size:12px">Spelers met minder dan 3 beoordeelde duels staan onderaan.</p>' : ''}</section>`;
  }
  return LINES.map(([key, label]) => {
    const group = players.filter((p) => (p.position || '') === key)
      .sort((a, b) => b.apps - a.apps || b.minutes - a.minutes || (a.number ?? 99) - (b.number ?? 99));
    if (!group.length) return '';
    return `<section class="section">
      <div class="section__label"><span>${esc(label)}</span><span>${group.length}</span></div>
      ${statHead}<div class="list">${group.map((p) => rowHtml(p, sort)).join('')}</div>
    </section>`;
  }).join('');
}

export const playerViews = {
  selectie: {
    title: 'Selectie',
    async render() {
      const { list, profiles } = await correctedList();
      const { players, matches } = buildSquad(list, TEAM, profiles);
      const kicker = `MySeasons / ${MAIN_CLUB.name} ${seasonLabel()}`;
      if (!players.length) {
        return `${head({ kicker, title: 'Selectie' })}
          ${missingBlock(list) || `<section class="section"><div class="empty"><span class="empty__title">Nog geen spelers</span>
            <p class="muted">De selectie komt uit de opstellingen van gespeelde wedstrijden. Synchroniseer eerst het seizoen op Home.</p>
            <div><a class="btn" href="#/home">Naar Home</a></div></div></section>`}`;
      }
      const used = players.filter((p) => p.apps).length;
      return `
        ${head({ kicker, title: 'Selectie' })}
        <section class="section">
          <p class="muted" style="font-size:13px">${players.length} spelers op het wedstrijdformulier, ${used} kwamen in actie · ${matches} officiële ${matches === 1 ? 'duel' : 'duels'}</p>
          <fieldset class="segmented segmented--4" style="margin:0;padding:0">
            <legend class="visually-hidden">Sorteren</legend>
            ${SORTS.map(([v, l], i) => `<input type="radio" name="sq-sort" id="sq-${v}" value="${v}" ${i === 0 ? 'checked' : ''}><label for="sq-${v}">${l}</label>`).join('')}
          </fieldset>
        </section>
        ${missingBlock(list)}
        ${SORTS.map(([v], i) => `<div data-sq="${v}" ${i === 0 ? '' : 'hidden'}>${squadList(players, v)}</div>`).join('')}`;
    },
    mount(root, ctx) {
      root.querySelectorAll('input[name="sq-sort"]').forEach((input) => input.addEventListener('change', () => {
        root.querySelectorAll('[data-sq]').forEach((el) => { el.hidden = el.dataset.sq !== input.value; });
      }));
      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="fetch-missing"]');
        if (btn) handleMissing(btn, ctx);
      });
    },
  },

  speler: {
    title: 'Speler',
    navKey: 'selectie',
    mount(root, ctx) {
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action="edit-name"]');
        if (!btn) return;
        const { id, api, full, short } = btn.dataset;
        const data = await openSheet({
          title: 'Naam aanpassen',
          body: `<label class="field"><span>Volledige naam</span><input name="full" maxlength="60" autocomplete="off" placeholder="${esc(api)}" value="${esc(full)}"></label>
            <label class="field"><span>Korte naam (tijdlijn, opstellingen)</span><input name="short" maxlength="30" autocomplete="off" placeholder="${esc(autoShort(full || api))}" value="${esc(short)}"></label>
            <p class="muted sheet__note">Leeg laten = automatisch. Highlightly noemt hem: ${esc(api)}</p>`,
        });
        if (!data) return;
        const next = { fullName: String(data.get('full') || '').trim() || null, shortName: String(data.get('short') || '').trim() || null };
        if (next.fullName === (full || null) && next.shortName === (short || null)) { toast('Niets veranderd'); return; }
        try {
          await savePlayer(id, next);
          toast('Naam opgeslagen', { action: 'Ongedaan maken', onAction: async () => { await savePlayer(id, { fullName: full || null, shortName: short || null }); ctx.refresh(); } });
          ctx.refresh();
        } catch (err) {
          toast(`Opslaan lukte niet: ${err.message || err}`);
        }
      });
    },
    async render(ctx, args) {
      const id = Number(args[0]);
      const { list, profiles } = await correctedList();
      const { players } = buildSquad(list, TEAM, profiles);
      const p = players.find((x) => x.id === id);
      if (!p) {
        return `${head({ kicker: 'Selectie', title: 'Niet gevonden', back: 'selectie' })}
          <section class="section"><p class="muted">Deze speler staat (nog) niet in een opgehaalde wedstrijd.</p></section>`;
      }
      const facts = playerFacts(p, players);
      const tiles = [
        [p.apps, p.apps === 1 ? 'duel' : 'duels', p.starts ? `${p.starts} basis` : ''],
        [p.minutes, 'minuten', p.apps ? `gem. ${Math.round(p.minutes / p.apps)}'` : ''],
        [p.goals, p.goals === 1 ? 'goal' : 'goals', p.penalties ? `${p.penalties} pen.` : ''],
        [p.assists, p.assists === 1 ? 'assist' : 'assists', ''],
        [p.rating == null ? '–' : p.rating.toFixed(2), 'gem. cijfer', p.rated ? `${p.rated} beoordeeld` : ''],
        [p.yellow + p.red, 'kaarten', p.red ? `${p.red} rood` : ''],
      ];
      const log = p.log.slice().reverse();
      return `
        ${head({ kicker: `Selectie · ${LINE_SHORT[p.position] || '—'}`, title: p.name, back: 'selectie' })}
        <section class="section">
          <div class="player-hero"><span class="player-hero__num">${p.number ?? '–'}</span>
            <span class="muted">${esc(LINE_SHORT[p.position] || '')}${p.squads > p.apps ? ` · ${p.squads - p.apps}× op de bank zonder invalbeurt` : ''}</span></div>
          <p class="muted" style="font-size:12px;margin:0">Kort: ${esc(p.short)}${p.profile && (p.profile.fullName || p.profile.shortName) ? ` · Highlightly: ${esc(p.apiName)}` : ''}</p>
          <div><button class="btn" type="button" data-action="edit-name" data-id="${p.id}" data-api="${esc(p.apiName)}" data-full="${esc((p.profile && p.profile.fullName) || '')}" data-short="${esc((p.profile && p.profile.shortName) || '')}">Naam aanpassen</button></div>
          <div class="tiles">${tiles.map(([v, l, sub]) => `<div class="tile"><span class="tile__num">${v}</span><span class="tile__label">${l}</span>${sub ? `<span class="tile__sub muted">${sub}</span>` : ''}</div>`).join('')}</div>
        </section>
        ${profileBlock(p.profile)}
        ${facts.length ? `<section class="section"><div class="section__label"><span>Feitjes</span></div>
          <div class="facts">${facts.map((f) => `<div class="fact"><span>${esc(f)}</span></div>`).join('')}</div></section>` : ''}
        <section class="section">
          <div class="section__label"><span>Wedstrijden</span><span>${p.log.length}</span></div>
          <div class="list">${log.map((l) => {
            const m = l.match;
            const opp = opponentOf(m, TEAM);
            const role = l.started ? `${l.minutes}'` : l.minutes ? `in · ${l.minutes}'` : 'bank';
            const ga = [l.goals ? `${l.goals}G` : '', l.assists ? `${l.assists}A` : ''].filter(Boolean).join(' ');
            return `<a class="list-row log-row" href="#/wedstrijd/${m.id}">
              <span class="match-row__date mono">${esc(dayShort(m.date))}</span>
              <span class="list-row__main"><span class="list-row__title">${isHome(m, TEAM) ? '' : '@ '}${esc(opp ? opp.name : '?')} <span class="result result--${l.result}">${m.score ? `${m.score.home}–${m.score.away}` : ''}</span></span>
                <span class="list-row__sub">${role}${l.captain ? ' · (c)' : ''}</span></span>
              <span class="log-row__end mono">${ga ? `<strong>${ga}</strong>` : ''}
                ${l.red ? '<span class="card card--red"></span>' : l.yellow ? '<span class="card card--yellow"></span>' : ''}
                <span class="${l.rating >= 7 ? 'accent-text' : 'muted'}">${l.rating == null ? '' : l.rating.toFixed(1)}</span></span>
            </a>`;
          }).join('')}</div>
        </section>`;
    },
  },
};
