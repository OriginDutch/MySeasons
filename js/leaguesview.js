// Meer → Competities: welke competities je volgt. Toevoegen via zoeken bij Highlightly (1 call) of met de hand.
// Volgen uit = niet meer verversen; standen en wedstrijden blijven bewaard (en worden dus vanzelf oud).

import { esc, icons, toast } from './ui.js';
import { hl } from './api.js';
import { countCalls, getStandings, getLeagueIndexes, getMeta } from './store.js';
import { openSheet } from './editor.js';
import { CURRENT_SEASON, MAIN_CLUB } from './config.js';
import { LEAGUES, ensureLeagues, saveLeagues, countriesOf, leagueInfo } from './leagues.js';
import { rulesFor } from './rules.js';
import { disciplineFor } from './discipline.js';
import { correctedList } from './matchviews.js';
import { mainLeague } from './season.js';

let RESULTS = []; // laatste zoekresultaten, voor de toevoegknoppen
let MINE = null; // competitie van je club dit seizoen

const COUNTRY_NL = {
  Netherlands: 'Nederland', England: 'Engeland', Germany: 'Duitsland', Spain: 'Spanje', Italy: 'Italië', France: 'Frankrijk',
  Belgium: 'België', Scotland: 'Schotland', Portugal: 'Portugal', Wales: 'Wales', World: 'Internationaal', Europe: 'Europa',
};
const countryNl = (c) => COUNTRY_NL[c] || c || 'Overig';
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

function head() {
  return `<header class="page-head"><div class="page-head__titles">
    <a class="back-btn" href="#/meer" aria-label="Terug">${icons.back}</a>
    <span class="page-head__kicker">Meer / Competities</span><h1 class="page-head__title">Competities</h1></div></header>`;
}

/** Ruwe schatting van wat volgen per nacht kost, met clubs uit de stand (anders 18). */
function costOf(teams) {
  const n = teams || 18;
  return { night: Math.ceil((n * (n - 1)) / 100) + 1, round: Math.floor(n / 2) };
}

function row(l, info) {
  const bits = [`id ${l.id}`, l.source === 'highlightly' ? 'via zoeken' : l.source === 'standaard' ? 'standaard' : 'handmatig'];
  const extras = [rulesFor(l.id, CURRENT_SEASON) ? 'regels' : null, disciplineFor(l.id, CURRENT_SEASON) ? 'schorsingen' : null].filter(Boolean);
  if (extras.length) bits.push(extras.join(' + '));
  else bits.push('kale stand');
  if (!l.follow) bits.push(info.updatedAt ? `niet gevolgd · laatst ververst ${dmy(info.updatedAt)}` : 'niet gevolgd');
  return `<button type="button" class="list-row lg-admin" data-edit-league="${l.id}">
    <span class="lg-row__tier mono">${l.tier}</span>
    <span class="list-row__main"><span class="list-row__title">${esc(l.name)}${l.short && l.short !== l.name ? ` <span class="muted">· ${esc(l.short)}</span>` : ''}${l.follow ? '' : ' <span class="ptag">uit</span>'}</span>
      <span class="list-row__sub">${esc(bits.join(' · '))}</span></span>
    <span class="list-row__end" aria-hidden="true">✎</span></button>`;
}

function resultsHtml(list) {
  if (!list) return '';
  if (!list.length) return '<p class="muted" style="font-size:var(--fs-md)">Niets gevonden. Andere spelling, of de Engelse naam (bijv. "Eerste Divisie", "Premier League")? Of voeg hem met de hand toe.</p>';
  return `<div class="list">${list.map((r, i) => {
    const have = leagueInfo(r.id);
    return `<div class="list-row lg-res">
      ${r.logo ? `<img class="crest" src="${esc(r.logo)}" width="22" height="22" alt="" loading="lazy">` : '<span></span>'}
      <span class="list-row__main"><span class="list-row__title">${esc(r.name)}</span><span class="list-row__sub">${esc(r.country)} · id ${r.id}</span></span>
      ${have ? '<span class="muted" style="font-size:var(--fs-sm)">staat erin</span>' : `<button class="btn btn--sm" type="button" data-add-result="${i}">Toevoegen</button>`}
    </div>`;
  }).join('')}</div>`;
}

/** Sheet voor nieuw of bestaand. base = voorinvulling. */
async function editLeague(ctx, base, { isNew }) {
  const sameCountry = LEAGUES.filter((l) => l.country === base.country).map((l) => l.tier);
  const tierGuess = base.tier || (sameCountry.length ? Math.max(...sameCountry) + 1 : 1);
  const data = await openSheet({
    title: isNew ? 'Competitie toevoegen' : `${base.name} aanpassen`,
    body: `${isNew && base.source !== 'highlightly' ? `<label class="field"><span>Highlightly-id</span><input name="id" type="number" inputmode="numeric" min="1" required value="${esc(String(base.id || ''))}" placeholder="bijv. 76523"></label>` : `<p class="muted sheet__note">Highlightly-id ${base.id}</p>`}
      <label class="field"><span>Naam</span><input name="name" maxlength="60" required value="${esc(base.name || '')}"></label>
      <div class="field-row">
        <label class="field"><span>Korte naam</span><input name="short" maxlength="20" placeholder="bijv. KKD" value="${esc(base.short && base.short !== base.name ? base.short : '')}"></label>
        <label class="field"><span>Niveau</span><input name="tier" type="number" inputmode="numeric" min="1" max="12" required value="${esc(String(tierGuess))}"></label>
      </div>
      <label class="field"><span>Land</span><input name="country" maxlength="40" required list="lg-countries" value="${esc(base.country || 'Nederland')}">
        <datalist id="lg-countries">${countriesOf().map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field field--check"><input type="checkbox" name="follow" ${base.follow === false ? '' : 'checked'}> <span>Volgen: de nachtploeg haalt stand en uitslagen op</span></label>
      <p class="muted sheet__note">Niveau 1 = hoogste divisie van dat land; de kiezer sorteert erop. Volgen uit = niet meer verversen, de data blijft staan.</p>
      ${!isNew && base.id === MINE ? `<p class="sheet__error" style="margin:0">${esc(MAIN_CLUB.name)} speelt dit seizoen in deze competitie. Uitzetten of weghalen betekent: geen verse stand meer.</p>` : ''}
      ${isNew ? '' : '<label class="field field--check"><input type="checkbox" name="delete"> <span>Uit de lijst halen (opgehaalde data blijft bewaard)</span></label>'}`,
    validate: (fd) => {
      if (fd.get('delete')) return null;
      const id = isNew && base.source !== 'highlightly' ? Number(fd.get('id')) : base.id;
      if (!Number.isInteger(id) || id <= 0) return 'Vul een geldig Highlightly-id in.';
      if (isNew && leagueInfo(id)) return 'Die competitie staat er al in.';
      if (!String(fd.get('name') || '').trim()) return 'Vul een naam in.';
      if (!(Number(fd.get('tier')) >= 1)) return 'Vul een niveau in (1 = hoogste).';
      return null;
    },
  });
  if (!data) return;
  const before = LEAGUES.map((l) => ({ ...l }));
  let next;
  if (data.get('delete')) next = before.filter((l) => l.id !== base.id);
  else {
    const item = {
      ...base,
      id: isNew && base.source !== 'highlightly' ? Number(data.get('id')) : base.id,
      name: String(data.get('name')).trim(),
      short: String(data.get('short') || '').trim() || String(data.get('name')).trim(),
      tier: Number(data.get('tier')),
      country: String(data.get('country')).trim() || 'Overig',
      follow: !!data.get('follow'),
      source: base.source || 'handmatig',
      ...(isNew ? { addedAt: new Date().toISOString() } : {}),
    };
    next = isNew ? [...before, item] : before.map((l) => (l.id === base.id ? item : l));
  }
  try {
    await saveLeagues(next);
    const msg = data.get('delete') ? `${base.name} uit de lijst` : isNew ? `${String(data.get('name')).trim()} toegevoegd${data.get('follow') ? ', de nachtploeg pakt hem op' : ''}` : 'Opgeslagen';
    toast(msg, { action: 'Ongedaan maken', onAction: async () => { await saveLeagues(before); ctx.refresh(); } });
    ctx.refresh();
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); }
}

async function search(root, q) {
  const box = root.querySelector('[data-lg-results]');
  const btn = root.querySelector('[data-lg-search]');
  btn.disabled = true; box.innerHTML = '<p class="muted">Zoeken…</p>';
  try {
    const res = await hl('/leagues', { leagueName: q, limit: 20 });
    await countCalls(1).catch(() => {});
    const arr = Array.isArray(res) ? res : (res && res.data) || [];
    RESULTS = arr.filter((x) => x && x.id).map((x) => ({
      id: Number(x.id), name: String(x.name || ''), logo: x.logo || null,
      country: countryNl(x.country && (x.country.name || x.country)),
    }));
    box.innerHTML = resultsHtml(RESULTS);
  } catch (err) {
    box.innerHTML = `<p class="muted">Zoeken lukte niet: ${esc(err.message || String(err))}</p>`;
  } finally { btn.disabled = false; }
}

export const leaguesViews = {
  competities: {
    title: 'Competities',
    navKey: 'meer',
    async render() {
      await ensureLeagues();
      const { list: own } = await correctedList().catch(() => ({ list: [] }));
      const ml = mainLeague(own); MINE = ml ? Number(ml.id) : null;
      const idx = await getLeagueIndexes().catch(() => []);
      const info = new Map(LEAGUES.map((l) => [l.id, idx.find((i) => Number(i.leagueId) === l.id && Number(i.season) === CURRENT_SEASON) || {}]));
      const followed = LEAGUES.filter((l) => l.follow);
      const q = await getMeta('quota').catch(() => null);
      const LIMIT = (q && q.hl && q.hl.limit) || 100;
      let night = 0; let round = 0;
      await Promise.all(followed.map(async (l) => {
        const st = await getStandings(l.id, CURRENT_SEASON).catch(() => null);
        const c = costOf(st && st.groups && st.groups[0] && st.groups[0].rows.length);
        night += c.night; round += c.round;
      }));
      const list = countriesOf().map((c) => `<div class="lg-country">${esc(c)}</div>${LEAGUES.filter((l) => l.country === c).sort((a, b) => a.tier - b.tier).map((l) => row(l, info.get(l.id))).join('')}`).join('');
      return `${head()}
        <section class="section">
          <p class="muted" style="font-size:var(--fs-md)">${followed.length} gevolgd${LEAGUES.length > followed.length ? `, ${LEAGUES.length - followed.length} uit` : ''}. Gevolgd = de nachtploeg haalt stand en uitslagen op en hij staat in de competitiekiezer.</p>
          <div class="lg-cost"><span class="mono">≈ ${night} calls per nacht</span><span class="muted">+ ≈ ${round} per speelronde voor schutters en kaarten van andere clubs · ${followed.length ? `van je ${LIMIT.toLocaleString('nl-NL')} per dag` : ''}</span></div>
        </section>
        <section class="section"><div class="list lg-admin-list">${list || '<p class="muted">Nog geen competities.</p>'}</div></section>
        <section class="section">
          <div class="section__label"><span>Toevoegen</span></div>
          <form class="lg-search" data-lg-form>
            <label class="field" style="flex:1"><span class="visually-hidden">Competitie zoeken</span><input name="q" type="search" minlength="3" required placeholder="Zoek bij Highlightly, bijv. Premier League" autocomplete="off"></label>
            <button class="btn" type="submit" data-lg-search>Zoeken · 1 call</button>
          </form>
          <div data-lg-results></div>
          <div><button class="btn btn--sm" type="button" data-lg-manual>Met de hand toevoegen</button></div>
          <p class="muted" style="font-size:var(--fs-sm);margin:0">Een nieuwe competitie krijgt een kale stand: geen promotie- of degradatiezones, periodes of schorsingen tot er een regelset voor is.</p>
        </section>`;
    },
    mount(root, ctx) {
      RESULTS = [];
      root.querySelector('[data-lg-form]')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = String(new FormData(e.currentTarget).get('q') || '').trim();
        if (q.length >= 3) search(root, q);
      });
      root.addEventListener('click', (e) => {
        const ed = e.target.closest('[data-edit-league]');
        if (ed) { const l = leagueInfo(ed.dataset.editLeague); if (l) editLeague(ctx, l, { isNew: false }); return; }
        const add = e.target.closest('[data-add-result]');
        if (add) { const r = RESULTS[Number(add.dataset.addResult)]; if (r) editLeague(ctx, { ...r, short: '', source: 'highlightly', follow: true }, { isNew: true }); return; }
        if (e.target.closest('[data-lg-manual]')) editLeague(ctx, { id: null, name: '', country: 'Nederland', source: 'handmatig', follow: true }, { isNew: true });
      });
    },
  },
};
