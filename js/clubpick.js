// Clubs kiezen in vrije tekstvelden (club van herkomst/bestemming bij transfers).
// Suggesties uit alle clubs die de app kent; kiezen bewaart id en logo, vrije tekst blijft gewoon mogelijk.

import { esc } from './ui.js';
import { getAllLeagueTeams, getPlayers, savePlayersBatch, getMeta, setMeta } from './store.js';

let cache = null;
export async function knownTeams() {
  if (!cache) cache = getAllLeagueTeams().catch(() => []);
  return cache;
}

/** Naam → vergelijkbare sleutel: kleine letters, geen accenten of FC/SC/... ervoor of erachter. */
export function clubKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['fc', 'sc', 'sv', 'afc', 'bv', 'vv'].includes(w)).join(' ').trim();
}

export function matchTeam(teams, name) {
  const k = clubKey(name);
  if (!k) return null;
  return teams.find((t) => clubKey(t.name) === k) || null;
}

const crestImg = (t, size = 18) => (t.logo ? `<img class="crest" src="${esc(t.logo)}" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'crest crest--txt',textContent:'${esc((t.name || '?').slice(0, 3).toUpperCase())}'}))">` : `<span class="crest crest--txt" style="width:${size}px;height:${size}px">${esc((t.name || '?').slice(0, 3).toUpperCase())}</span>`);
export const clubCrest = (t, size) => (t && (t.logo || t.name) ? crestImg(t, size) : '');

/** Veld-HTML: tekstveld + verborgen id/logo + suggestielijst. */
export function clubField(name, label, value = {}) {
  return `<label class="field clubpick"><span>${esc(label)}</span>
    <input name="${name}" maxlength="60" autocomplete="off" placeholder="Typ een club" value="${esc(value.club || '')}" data-clubpick>
    <input type="hidden" name="${name}Id" value="${esc(value.clubId || '')}"><input type="hidden" name="${name}Logo" value="${esc(value.clubLogo || '')}">
    <span class="clubpick__list" role="listbox" hidden></span>
    <span class="clubpick__chosen muted" ${value.clubId ? '' : 'hidden'}>${value.clubId ? `${clubCrest({ logo: value.clubLogo, name: value.club }, 16)} gekoppeld aan ${esc(value.club)}` : ''}</span></label>`;
}

// Eén set luisteraars voor alle clubvelden (sheets worden dynamisch gemaakt).
document.addEventListener('input', async (e) => {
  const input = e.target.closest && e.target.closest('input[data-clubpick]');
  if (!input) return;
  const box = input.closest('.clubpick');
  const id = box.querySelector(`input[name="${input.name}Id"]`); const logo = box.querySelector(`input[name="${input.name}Logo"]`);
  id.value = ''; logo.value = '';
  box.querySelector('.clubpick__chosen').hidden = true;
  const list = box.querySelector('.clubpick__list');
  const q = clubKey(input.value);
  if (q.length < 2) { list.hidden = true; return; }
  const teams = await knownTeams();
  const hits = teams.filter((t) => clubKey(t.name).includes(q)).sort((a, b) => clubKey(a.name).indexOf(q) - clubKey(b.name).indexOf(q) || a.name.localeCompare(b.name)).slice(0, 6);
  list.innerHTML = hits.map((t) => `<button type="button" class="clubpick__opt" data-id="${esc(String(t.id))}" data-name="${esc(t.name)}" data-logo="${esc(t.logo || '')}">${crestImg(t)}<span>${esc(t.name)}</span></button>`).join('');
  list.hidden = !hits.length;
});

document.addEventListener('click', (e) => {
  const opt = e.target.closest && e.target.closest('.clubpick__opt');
  if (!opt) return;
  e.preventDefault();
  const box = opt.closest('.clubpick');
  const input = box.querySelector('input[data-clubpick]');
  input.value = opt.dataset.name;
  box.querySelector(`input[name="${input.name}Id"]`).value = opt.dataset.id;
  box.querySelector(`input[name="${input.name}Logo"]`).value = opt.dataset.logo;
  box.querySelector('.clubpick__list').hidden = true;
  const chosen = box.querySelector('.clubpick__chosen');
  chosen.innerHTML = `${clubCrest({ logo: opt.dataset.logo, name: opt.dataset.name }, 16)} gekoppeld aan ${esc(opt.dataset.name)}`;
  chosen.hidden = false;
});

/** Eenmalig: bestaande transfers met een exact bekende clubnaam koppelen. */
export async function linkTransferClubs() {
  const done = await getMeta('clubLinkV1').catch(() => null);
  if (done && done.at) return null;
  const [teams, profiles] = await Promise.all([knownTeams(), getPlayers()]);
  if (!teams.length) return null;
  const writes = []; let linked = 0;
  Object.entries(profiles).forEach(([pid, pr]) => {
    if (!pr || !Array.isArray(pr.transfers)) return;
    let changed = false;
    const ts = pr.transfers.map((t) => {
      if (!t || t.clubId || !t.club) return t;
      const team = matchTeam(teams, t.club);
      if (!team) return t;
      changed = true; linked++;
      return { ...t, club: team.name, clubId: team.id, clubLogo: team.logo || null };
    });
    if (changed) writes.push([pid, { transfers: ts }]);
  });
  if (writes.length) await savePlayersBatch(writes);
  await setMeta('clubLinkV1', { at: new Date().toISOString(), linked });
  return { linked };
}
