// Schorsingen in de app: beslissingen over rode kaarten (meta/discipline), het blok op de spelerspagina,
// de tags in Selectie, de regel in de voorbeschouwing en de meldingen.

import { esc, toast } from './ui.js';
import { getMeta, replaceMeta } from './store.js';
import { openSheet } from './editor.js';
import { dayShort, opponentOf, isHome } from './season.js';
import { MAIN_CLUB } from './config.js';
import { leagueInfo } from './leagues.js';
import { discipline, statusFor, squadTags, nextThreshold, disciplineFor, CUP_ID } from './discipline.js';

const TEAM = MAIN_CLUB.id;

export async function getDecisions() {
  const m = await getMeta('discipline').catch(() => null);
  return (m && m.decisions) || {};
}

/** Telling voor deze lijst met jouw beslissingen erin. */
export async function disciplineState(list) {
  return discipline(list, await getDecisions());
}

const compShort = (lid) => (lid === CUP_ID ? 'Beker' : (leagueInfo(lid) || {}).short || 'Competitie');
const vs = (m) => { const o = opponentOf(m, TEAM); return `${isHome(m, TEAM) ? '' : '@ '}${o ? o.name : '?'}`; };

export const discTagsHtml = (tags) => (tags || []).map((t) => `<span class="ptag ${t.kind === 'ban' ? 'ptag--ban' : 'ptag--edge'}">${esc(t.text)}</span>`).join('');

/** Selectie: tags per speler (alleen in het lopende seizoen). */
export function attachDiscTags(players, state) {
  players.forEach((p) => { p.discTags = state ? squadTags(state.players.get(p.id)) : []; });
}

/** Voorbeschouwing: "Geschorst: X · Op scherp: Y" voor het volgende duel, of null. */
export function previewLine(state, next, nameOf = (id, n) => n) {
  if (!state || !next || !next.league || !disciplineFor(next.league.id, Number(next.league.season))) return null;
  const banned = []; const edge = [];
  state.players.forEach((info, id) => {
    const s = statusFor(info, next);
    if (s.banned) banned.push(nameOf(id, info.name));
    else if (s.edge.length) edge.push(nameOf(id, info.name));
  });
  if (!banned.length && !edge.length) return null;
  return [banned.length ? `Geschorst: ${banned.join(', ')}` : '', edge.length ? `Op scherp: ${edge.join(', ')}` : ''].filter(Boolean).join(' · ');
}

/** Rode kaarten die op jouw bevestiging wachten (lopend seizoen). */
export function pendingReds(state) {
  return state ? state.reds.filter((r) => r.confirm && !r.decided) : [];
}

/** Spelerspagina: telling per competitie, schorsingen en rode kaarten. */
export function disciplineBlock(state, playerId, nameOf) {
  const info = state && state.players.get(playerId);
  const covNote = state ? [...state.coverage.entries()].filter(([, c]) => c.counted < c.total).map(([lid, c]) => `${compShort(lid)}: ${c.counted} van ${c.total} duels met details`).join(' · ') : '';
  if (!info || (!info.cards.length && !info.bans.length)) {
    return `<section class="section"><div class="section__label"><span>Kaarten en schorsingen</span></div>
      <p class="muted" style="font-size:var(--fs-md)">Nog geen kaart dit seizoen.${covNote ? ` (${esc(covNote)})` : ''}</p></section>`;
  }
  const latest = new Map(); info.tallies.forEach((t) => latest.set(t.leagueId, t));
  const tallies = [...latest.values()].map((t) => {
    const nt = nextThreshold(t.rule, t.yellows);
    const label = `${compShort(t.leagueId)}${t.phase === 'playoff' ? ' · nacompetitie' : ''}`;
    return `<div class="tile"><span class="tile__num">${t.yellows}</span><span class="tile__label">geel · ${esc(label)}</span>${nt ? `<span class="tile__sub muted">${nt - t.yellows === 1 ? '<strong>op scherp</strong> · ' : ''}schorsing bij ${nt}</span>` : ''}</div>`;
  }).join('');
  const reds = state.reds.filter((r) => r.playerId === playerId);
  const bans = info.bans.slice().reverse().map((b) => {
    const red = b.kind === 'yellow' ? null : reds.find((r) => r.match.id === b.matchId) || null;
    const m = (info.cards.find((c) => c.match.id === b.matchId) || {}).match;
    return `<div class="list-row disc-row ${b.left > 0 ? 'is-banned' : ''}">
      <span class="list-row__main"><span class="list-row__title">${b.left > 0 ? `Geschorst · nog ${b.left} ${b.left === 1 ? 'duel' : 'duels'}` : `Geschorst · uitgezeten`}</span>
      <span class="list-row__sub">${esc(b.reason)}${m ? ` · ${esc(dayShort(m.date))} ${esc(vs(m))}` : ''} · ${b.games} ${b.games === 1 ? 'duel' : 'duels'}${b.scope === 'all' ? ' in alle duels' : ` in de ${esc(compShort(b.scope))}`}${red && red.confirm && !red.decided ? ' · <span class="ptag ptag--warn">standaard, nog bevestigen</span>' : ''}</span></span>
      ${red ? `<button class="btn btn--sm" type="button" data-red-edit="${esc(red.key)}">Aanpassen</button>` : ''}
    </div>`;
  }).join('');
  const redsNoBan = reds.filter((r) => !info.bans.some((b) => b.matchId === r.match.id && b.kind !== 'yellow')).map((r) => `<div class="list-row disc-row">
      <span class="list-row__main"><span class="list-row__title">${r.kind === 'second' ? '2x geel' : 'Rode kaart'} · geen schorsing</span>
      <span class="list-row__sub">${esc(dayShort(r.match.date))} ${esc(vs(r.match))}</span></span>
      <button class="btn btn--sm" type="button" data-red-edit="${esc(r.key)}">Aanpassen</button></div>`).join('');
  const rule = [...latest.values()][0]?.rule;
  return `<section class="section" id="kaarten">
      <div class="section__label"><span>Kaarten en schorsingen</span><span>${info.cards.filter((c) => c.kind === 'yellow').length} geel${reds.length ? ` · ${reds.length} rood` : ''}</span></div>
      <div class="tiles">${tallies}</div>
      ${bans || redsNoBan ? `<div class="list">${bans}${redsNoBan}</div>` : ''}
      <p class="muted" style="font-size:var(--fs-sm);margin:0">Competitie: 5e, 7e, 9e… geel = 1 duel. Beker: elke 2e geel. 2x geel in één duel = 1 duel, telt niet mee. Direct rood = standaard 1 duel tot jij de echte straf invult.${rule ? ` Bron: ${esc(rule.source)}.` : ''}${covNote ? ` Alleen duels met details tellen (${esc(covNote)}).` : ''}</p>
    </section>`;
}

/** Sheet: soort rode kaart en lengte. */
async function editRed(ctx, key, state) {
  const r = state.reds.find((x) => x.key === key);
  if (!r) return;
  const all = await getDecisions();
  const cur = all[key] || {};
  const data = await openSheet({
    title: `Rode kaart ${r.name || ''}`.trim(),
    body: `<p class="muted sheet__note">${esc(dayShort(r.match.date))} ${esc(vs(r.match))}. De app gokte: ${r.guess === 'second' ? '2x geel' : 'direct rood'}.</p>
      <fieldset class="field"><span>Soort</span>
        <label class="field--check"><input type="radio" name="kind" value="direct" ${r.kind === 'direct' ? 'checked' : ''}> <span>Direct rood</span></label>
        <label class="field--check"><input type="radio" name="kind" value="second" ${r.kind === 'second' ? 'checked' : ''}> <span>2x geel (die twee gele tellen niet mee in de telling)</span></label>
      </fieldset>
      <label class="field"><span>Schorsing (duels, onvoorwaardelijk)</span><input name="ban" type="number" inputmode="numeric" min="0" max="20" value="${esc(String(cur.ban ?? r.ban))}"></label>
      <p class="muted sheet__note">Bij direct rood: wat de aanklager voorstelde of de tuchtcommissie besliste. Voorwaardelijke duels tellen niet.</p>
      ${all[key] ? '<label class="field field--check"><input type="checkbox" name="reset"> <span>Terug naar de standaard</span></label>' : ''}`,
    validate: (fd) => { const n = Number(fd.get('ban')); return fd.get('reset') || (Number.isInteger(n) && n >= 0 && n <= 20) ? null : 'Vul 0 tot 20 duels in.'; },
  });
  if (!data) return;
  const decisions = { ...all };
  if (data.get('reset')) delete decisions[key];
  else decisions[key] = { kind: data.get('kind') || r.kind, ban: Number(data.get('ban')), at: new Date().toISOString() };
  try {
    // Hele document vervangen: met merge zou een weggehaalde sleutel blijven staan.
    await replaceMeta('discipline', { decisions });
    toast(data.get('reset') ? 'Terug naar de standaard' : 'Schorsing opgeslagen', {
      action: 'Ongedaan maken', onAction: async () => { await replaceMeta('discipline', { decisions: all }); ctx.refresh(); },
    });
    ctx.refresh();
  } catch (err) { toast(`Opslaan lukte niet: ${err.message || err}`); }
}

export function mountDiscipline(root, ctx, getState) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-red-edit]');
    if (!b) return;
    editRed(ctx, b.dataset.redEdit, await getState());
  });
}
