// Trainers: lijst (Meer → Trainers) en een eigen pagina per trainer met aanstellingen en foto's.

import { esc, icons } from './ui.js';
import { getCoaches } from './store.js';
import { coachName } from './coaches.js';
import { flag, nationalities } from './flags.js';
import { loadPhotos, heroImg, galleryHtml, mountPhotos, shownThumb } from './photos.js';
import { getSeason } from './seasonstate.js';

let CUR = null;
const dmy = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'nu');
const ini = (c) => esc(((c.firstname || ' ')[0] + (c.lastname || ' ')[0]).trim().toUpperCase() || '?');
const head = (kicker, title, back) => `<header class="page-head"><div class="page-head__titles">
    <a class="back-btn" href="${back}" aria-label="Terug">${icons.back}</a>
    <span class="page-head__kicker">${esc(kicker)}</span><h1 class="page-head__title">${esc(title)}</h1></div></header>`;
const lastTo = (c) => (c.appointments || []).reduce((m, a) => (!a.to ? '9999' : a.to > m ? a.to : m), '');

function avatar(c) {
  const ph = shownThumb(c.gallery, getSeason()) || c.photoUrl;
  return `<span class="avatar">${ph ? `<img class="avatar__img" src="${esc(ph)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar__ini',textContent:'${ini(c)}'}))">` : `<span class="avatar__ini">${ini(c)}</span>`}</span>`;
}

export const coachViews = {
  trainers: {
    title: 'Trainers',
    navKey: 'meer',
    async render() {
      const list = (await getCoaches().catch(() => [])).sort((a, b) => lastTo(b).localeCompare(lastTo(a)));
      return `${head('Meer / Trainers', 'Trainers', '#/meer')}
        <section class="section"><div class="list">${list.map((c) => `<a class="list-row player-row" href="#/trainer/${encodeURIComponent(c.id)}">
          ${avatar(c)}<span class="list-row__main"><span class="list-row__title">${esc(coachName(c) || '?')}</span>
          <span class="list-row__sub">${(c.appointments || []).map((a) => `${esc(a.role || 'trainer')} ${String(a.from || '…').slice(0, 4)}–${a.to ? String(a.to).slice(0, 4) : 'nu'}`).join(' · ')}</span></span><span></span></a>`).join('')
          || '<p class="muted">Nog geen trainers. Die komen uit de import van je oude tracker.</p>'}</div></section>`;
    },
  },
  trainer: {
    title: 'Trainer',
    navKey: 'meer',
    async render(ctx, args) {
      const id = decodeURIComponent(args[0] || '');
      const c = (await getCoaches().catch(() => [])).find((x) => String(x.id) === id);
      if (!c) return `${head('Trainers', 'Niet gevonden', '#/trainers')}<section class="section"><p class="muted">Deze trainer staat niet in je data.</p></section>`;
      CUR = await loadPhotos('coach', c.id, c.gallery);
      const hero = heroImg(CUR.photos, c.gallery, getSeason(), c.photoUrl);
      const nat = c.nationality ? nationalities(c.nationality).map((n) => flag(n, 14)).join('') : '';
      return `${head('Trainers', coachName(c) || '?', '#/trainers')}
        <section class="section">
          <div class="player-hero">${hero}<span class="muted">${nat} ${c.dob ? `geboren ${esc(dmy(c.dob))}` : ''}</span></div>
          <div><button class="btn btn--sm" type="button" data-photo-add>Foto toevoegen</button></div>
        </section>
        ${galleryHtml(CUR.photos, c.gallery, { linkUrl: c.photoUrl })}
        <section class="section"><div class="section__label"><span>Aanstellingen</span><span>${(c.appointments || []).length}</span></div>
          <div class="list">${(c.appointments || []).map((a) => `<div class="list-row"><span class="list-row__main"><span class="list-row__title">${esc(a.role || 'Trainer')}</span>
            <span class="list-row__sub">${esc(dmy(a.from))} → ${esc(dmy(a.to))}</span></span></div>`).join('') || '<p class="muted">Geen aanstellingen bekend.</p>'}</div></section>`;
    },
    mount(root, ctx) { mountPhotos(root, ctx, () => CUR); },
  },
};
