// VI-nieuws: ophalen via de Worker, filteren op clubs die je volgt, bewaren in Firestore.
// We tonen alleen kop, teaser en een link naar vi.nl.

import { viNews } from './api.js';
import { getNews, saveNews, getMeta, setMeta } from './store.js';
import { MAIN_CLUB } from './config.js';

// VI-slugs per club (vi.nl/clubs/<slug>). Cambuur staat vast; de rest leert de app uit de algemene feed.
const KNOWN_SLUGS = { [MAIN_CLUB.id]: 'sc-cambuur' };

const KEY = 'ms-news-fetched';
const EVERY_MS = 15 * 60 * 1000;

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(sc|fc|afc|sv|vv|bv)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Hoort een VI-tag bij deze club? 'AZ' ↔ 'AZ Alkmaar', 'SC Cambuur' ↔ 'Cambuur', 'PSV' ↔ 'PSV Eindhoven'. */
export function tagMatches(tag, teamName) {
  const t = norm(tag); const n = norm(teamName);
  if (!t || !n) return false;
  return t === n || n.startsWith(t + ' ') || t.startsWith(n + ' ') || t.endsWith(' ' + n);
}

function idOf(link) {
  let h = 0;
  for (let i = 0; i < link.length; i++) h = (h * 31 + link.charCodeAt(i)) >>> 0;
  return `vi-${h.toString(36)}`;
}

/** teams: [{ id, name }]. Geeft de items die bij minstens één team horen, met hun team-id's. */
export function matchNews(items, teams, forTeamId = null) {
  return items.map((it) => {
    const clubs = teams.filter((t) => (it.categories || []).some((c) => tagMatches(c, t.name))).map((t) => t.id);
    if (forTeamId && !clubs.includes(forTeamId)) clubs.push(forTeamId); // uit de clubfeed: hoort sowieso bij die club
    if (!clubs.length) return null;
    const date = Date.parse(it.pubDate);
    return {
      id: idOf(it.link), source: 'VI', title: it.title, teaser: it.teaser || null, link: it.link,
      date: Number.isNaN(date) ? new Date().toISOString() : new Date(date).toISOString(), clubs,
    };
  }).filter(Boolean);
}

function lastFetch() {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}

/**
 * Haalt de feed op (hooguit eens per kwartier, tenzij force) en bewaart wat bij je clubs hoort.
 * Fouten zijn niet erg: dan tonen we wat er al bewaard is.
 */
export async function refreshNews(teams, { force = false, focus = [MAIN_CLUB.id] } = {}) {
  if (!force && Date.now() - lastFetch() < EVERY_MS) return { fetched: false };
  try {
    // 1. Algemene feed: nieuws over alle clubs uit je programma, en VI-slugs leren.
    const res = await viNews();
    const items = (res && res.items) || [];
    const saved = (await getMeta('viSlugs').catch(() => null)) || {};
    const slugs = { ...saved, ...KNOWN_SLUGS };
    let learned = false;
    items.forEach((it) => (it.clubs || []).forEach((c) => {
      const t = teams.find((x) => tagMatches(c.name, x.name));
      if (t && !slugs[t.id]) { slugs[t.id] = c.slug; learned = true; }
    }));
    if (learned) await setMeta('viSlugs', slugs).catch(() => {});
    const found = matchNews(items, teams);

    // 2. Clubfeeds voor de clubs die er nu toe doen (Cambuur en de volgende tegenstander).
    for (const id of focus) {
      if (!slugs[id]) continue;
      try {
        const r = await viNews(slugs[id]);
        found.push(...matchNews((r && r.items) || [], teams, id));
      } catch { /* clubfeed mislukt: algemene feed is er nog */ }
    }

    const unique = [...new Map(found.map((n) => [n.id, n])).values()];
    await saveNews(unique);
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* niet erg */ }
    return { fetched: true, found: unique.length, mine: unique.filter((n) => n.clubs.includes(MAIN_CLUB.id)).length };
  } catch (err) {
    return { fetched: false, error: err };
  }
}

export async function newsFor(teamIds, limit = 50) {
  const all = await getNews();
  return all
    .filter((n) => n.clubs && n.clubs.some((c) => teamIds.includes(c)))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, limit);
}
