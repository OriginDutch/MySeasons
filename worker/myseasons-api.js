// MySeasons API — Cloudflare Worker
//
// Doet vier dingen:
// 1. Checkt of de aanvraag van jou komt (Firebase ID-token + jouw UID).
// 2. Stuurt alleen toegestane Highlightly-aanvragen door, met de key die hier als secret staat.
// 3. Haalt VI-nieuws op (/news/vi, of per club /news/vi?tag=sc-cambuur) en geeft alleen
//    kop, teaser, link, datum en tags terug.
// 4. Haalt een RSSSF-seizoenspagina voor Nederland op (/rsssf/ned2025), ongewijzigd als tekst.
//    RSSSF staat kopiëren toe met bronvermelding (Karel Stokkermans / RSSSF); de app toont die.
// 5. Nachtploeg: een wekker (Cron Trigger) werkt een wachtrij af met je restquotum en legt de
//    ruwe antwoorden in een brievenbus (KV). De app leegt de brievenbus en schrijft zelf naar Firestore,
//    dus de Worker heeft geen toegang tot je database.
// 6. Zet CORS-headers zodat alleen de MySeasons-app hem kan gebruiken.
//
// Nodig voor de nachtploeg: een KV-namespace gekoppeld als MS_KV, en een Cron Trigger "* * * * *".
//
// Instellen in Cloudflare (Settings → Variables and Secrets):
//   HIGHLIGHTLY_KEY  (type Secret)  je Highlightly API-key
//   ALLOWED_UID      (type Text)    je Firebase UID uit MySeasons → Meer → Instellingen

import { pushApi, pushScheduled } from './push.js';
import { backupApi } from './backup.js';
import { followUp } from './followup.js';
import { squadApi, squadScheduled } from './squadpage.js';
import { imgApi } from './imgproxy.js';
import { liveScheduled, liveApi, askScheduled, optinApi } from './live.js';
import { boardScheduled, boardBusy, boardActive, BOARD, cupLive } from './board.js';

const PROJECT_ID = 'myseasons-c1dd9';
const HIGHLIGHTLY_BASE = 'https://soccer.highlightly.net';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const ALLOWED_ORIGINS = [
  'https://myseasons-c1dd9.firebaseapp.com',
  'https://myseasons-c1dd9.web.app',
  'http://localhost:5000',
  'http://127.0.0.1:5000',
];

// Alleen deze Highlightly-endpoints mogen door (alleen GET).
const ALLOWED_PATHS = [
  /^\/matches$/,
  /^\/matches\/\d+$/,
  /^\/lineups\/\d+$/,
  /^\/box-score\/\d+$/,
  /^\/statistics\/\d+$/,
  /^\/events\/\d+$/,
  /^\/standings$/,
  /^\/teams$/,
  /^\/teams\/\d+$/,
  /^\/leagues$/,
  /^\/leagues\/\d+$/,
  /^\/players\/\d+$/,
];

// ---------- Hulpjes ----------

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'X-MS-RateLimit-Remaining, X-MS-RateLimit-Limit',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin), ...extra },
  });
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

// ---------- VI-nieuws ----------

const VI_FEED = 'https://www.vi.nl/feed/news.xml';

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  const raw = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseFeed(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 60) {
    const block = m[1];
    const categories = [];
    const clubs = [];
    const cre = /<category(?:\s+domain="([^"]*)")?[^>]*>([\s\S]*?)<\/category>/g;
    let c;
    while ((c = cre.exec(block))) {
      const name = decodeEntities(c[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1')).trim();
      categories.push(name);
      const slug = (c[1] || '').match(/\/clubs\/([a-z0-9-]+)\/?$/);
      if (slug) clubs.push({ name, slug: slug[1] });
    }
    const link = tagText(block, 'link');
    if (!/^https:\/\/(www\.)?vi\.nl\//.test(link)) continue;
    items.push({
      title: tagText(block, 'title'),
      teaser: tagText(block, 'description').slice(0, 280),
      link,
      pubDate: tagText(block, 'pubDate'),
      categories,
      clubs,
    });
  }
  return items;
}

async function viNews(tag) {
  const url = tag ? `${VI_FEED}?tag=${encodeURIComponent(tag)}` : VI_FEED;
  const res = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true }, headers: { 'User-Agent': 'MySeasons/1.0 (persoonlijke app)' } });
  if (!res.ok) throw new Error(`VI gaf ${res.status}`);
  return parseFeed(await res.text());
}

// ---------- RSSSF ----------

async function rsssfPage(year) {
  const url = `https://www.rsssf.org/tablesn/ned${year}.html`;
  const res = await fetch(url, {
    cf: { cacheTtl: 86400, cacheEverything: true },
    headers: { 'User-Agent': 'MySeasons/1.0 (persoonlijke seizoenstracker; eenmalig per seizoen)' },
  });
  if (!res.ok) throw Object.assign(new Error(`RSSSF gaf ${res.status}`), { status: res.status });
  const buf = await res.arrayBuffer();
  const type = res.headers.get('Content-Type') || '';
  const charset = (type.match(/charset=([\w-]+)/i) || [])[1] || 'windows-1252';
  let text;
  try { text = new TextDecoder(charset).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
  return { url, text };
}

// ---------- Firebase ID-token controleren ----------

let jwksCache = { keys: null, expiresAt: 0 };

async function getSigningKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.expiresAt) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Kon Google-sleutels niet ophalen');
  const { keys } = await res.json();
  const maxAge = Number(((res.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1] || 3600);
  jwksCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}

async function verifyIdToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Ongeldig token');
  const [h, p, s] = parts;
  const header = b64urlToJson(h);
  const payload = b64urlToJson(p);

  if (header.alg !== 'RS256' || !header.kid) throw new Error('Ongeldig token');

  const keys = await getSigningKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Onbekende sleutel');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw new Error('Handtekening klopt niet');

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT_ID) throw new Error('Verkeerd project');
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error('Verkeerde uitgever');
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('Token verlopen');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('Token uit de toekomst');
  if (!payload.sub) throw new Error('Geen gebruiker');

  return payload;
}

// ---------- Nachtploeg ----------
// Gratis Workers-plan: max 50 subrequests per run (KV telt mee) en 10 ms CPU. Daarom per run
// hooguit MAX_CALLS Highlightly-calls, en de antwoorden ongeparst bewaren.

const NS_QUEUE = 'ns:queue';
const NS_STATE = 'ns:state';
const NS_INBOX = 'ns:inbox:';
const MAX_CALLS = 40;
const RESERVE = 15; // in de gratis stand blijven er altijd zoveel calls over voor de app zelf
const RESERVE_LATE = 3; // laatste half uur voor de reset (00:00 UTC): de 15 zouden anders ongebruikt verlopen
const RESERVE_TURBO = 200; // turbo: ~7.300 van de 7.500; de rest blijft voor uitslagen op wedstrijddag en de app
const RESERVE_MATCHDAY = 1200; // turbo op een dag met ED/KKD-duels: genoeg voor het live-bord (~400-600 per dag)
const MAX_CALLS_LIVE = 20; // per run tijdens duels
/** Reserve op dit moment: 15, behalve 23:30–00:00 UTC (dan 3). */
export function reserveAt(time = Date.now()) {
  const d = new Date(time);
  return d.getUTCHours() === 23 && d.getUTCMinutes() >= 30 ? RESERVE_LATE : RESERVE;
}
const MODES = ['off', 'free', 'turbo'];

const isId = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

/** Welke Highlightly-paden een wachtrij-item kost. Alleen vaste patronen: niets anders kan erdoor. */
function pathsFor(item) {
  const id = Number(item.id);
  switch (item.type) {
    case 'full': return isId(id) ? [`/matches/${id}`, `/lineups/${id}`, `/box-score/${id}`] : null;
    case 'events': return isId(id) ? [`/matches/${id}`] : null;
    case 'lineups': return isId(id) ? [`/lineups/${id}`] : null;
    case 'league': return isId(item.leagueId) && isId(item.season) ? [`/matches?leagueId=${Number(item.leagueId)}&season=${Number(item.season)}&limit=100&offset=${Number(item.offset) || 0}`] : null;
    case 'program': return isId(item.teamId) && isId(item.season) && ['home', 'away'].includes(item.side) ? [`/matches?${item.side}TeamId=${Number(item.teamId)}&season=${Number(item.season)}&limit=100`] : null;
    case 'standings': return isId(item.leagueId) && isId(item.season) ? [`/standings?leagueId=${Number(item.leagueId)}&season=${Number(item.season)}`] : null;
    default: return null;
  }
}

async function nsGet(env, key, fallback) {
  const v = await env.MS_KV.get(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function remainingOf(res) {
  for (const [name, value] of res.headers) {
    const n = name.toLowerCase();
    if (n.includes('ratelimit') && n.includes('remaining')) return Number(value);
  }
  return null;
}

/** Eén run: werk de wachtrij af tot het budget op is. Geeft een samenvatting terug. */
async function nsRun(env, why) {
  const [queue, state, board] = await Promise.all([nsGet(env, NS_QUEUE, []), nsGet(env, NS_STATE, {}), nsGet(env, BOARD, null)]);
  const mode = state.mode || 'free';
  const results = [];
  const reserve = reserveAt();
  // Wedstrijddag: turbo laat genoeg over voor het live-bord, en houdt de runs klein tijdens de duels
  // (subrequests per run worden gedeeld met live, het bord en de meldingen).
  const now = Date.now();
  const reserveTurbo = boardBusy(board, now) ? RESERVE_MATCHDAY : RESERVE_TURBO;
  const maxCalls = boardActive(board, now) ? MAX_CALLS_LIVE : MAX_CALLS;
  let calls = 0; let stop = null; let remaining = state.remaining ?? null; let limit = state.limit ?? null;
  while (queue.length && !stop) {
    const item = queue[0];
    const paths = pathsFor(item);
    if (!paths) { queue.shift(); continue; }
    if (calls + paths.length > maxCalls) break;
    if (remaining != null && remaining - paths.length < (mode === 'turbo' ? reserveTurbo : reserve)) { stop = 'reserve'; break; }
    const bodies = []; let status = 200;
    for (const p of paths) {
      const res = await fetch(`${HIGHLIGHTLY_BASE}${p}`, { headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_KEY } });
      calls++;
      const r = remainingOf(res); if (r != null) remaining = r;
      for (const [hn, hv] of res.headers) { const n = hn.toLowerCase(); if (n.includes('ratelimit') && n.includes('limit') && !n.includes('remaining') && !n.includes('reset')) limit = Number(hv); }
      if (res.status === 429) { status = 429; break; }
      if (!res.ok) { status = res.status; bodies.push(null); continue; }
      bodies.push(await res.text());
    }
    if (status === 429) { stop = 'quota'; break; } // item blijft in de wachtrij
    queue.shift();
    results.push({ item, status, bodies });
    // Competitie: volgende pagina van 100 erachteraan zetten (pagination uit het antwoord).
    if (item.type === 'league' && bodies[0]) {
      const m = bodies[0].match(/"totalCount"\s*:\s*(\d+)/);
      const total = m ? Number(m[1]) : 0;
      const next = (Number(item.offset) || 0) + 100;
      if (next < total) queue.unshift({ ...item, offset: next });
    }
  }
  const at = new Date().toISOString();
  if (results.length) await env.MS_KV.put(`${NS_INBOX}${Date.now()}`, JSON.stringify({ at, results }));
  const log = [{ at, why, calls, items: results.length, stop, remaining, reserve }, ...(state.log || [])].slice(0, 30);
  await Promise.all([
    env.MS_KV.put(NS_QUEUE, JSON.stringify(queue)),
    env.MS_KV.put(NS_STATE, JSON.stringify({ ...state, mode, lastRun: at, remaining, limit, exhaustedAt: stop === 'quota' ? at : state.exhaustedAt || null, log })),
  ]);
  return { calls, items: results.length, stop, remaining, queue: queue.length };
}

/** De wekker loopt elke minuut; hier beslissen we of er echt gedraaid wordt. */
async function nsScheduled(env, time) {
  if (!env.MS_KV) return;
  const state = await nsGet(env, NS_STATE, {});
  const mode = state.mode || 'free';
  if (mode === 'off') return;
  const d = new Date(time);
  // Gratis: 's avonds laat (UTC 21-23 = 23-01 uur NL-zomertijd), elke 10 minuten, met reserve.
  if (mode === 'free' && !(d.getUTCHours() >= 21 && d.getUTCMinutes() % 10 === 0)) return;
  const queue = await env.MS_KV.get(NS_QUEUE);
  if (!queue || queue === '[]') return;
  await nsRun(env, 'wekker');
}

async function nsApi(request, env, url, origin) {
  if (!env.MS_KV) return json({ error: 'Nachtploeg: KV-namespace MS_KV is nog niet gekoppeld aan de Worker' }, 501, origin);
  const path = url.pathname.slice(3); // na /ns
  if (path === '/state' && request.method === 'GET') {
    const [state, queue, list] = await Promise.all([nsGet(env, NS_STATE, {}), nsGet(env, NS_QUEUE, []), env.MS_KV.list({ prefix: NS_INBOX })]);
    const byType = {};
    queue.forEach((q) => { byType[q.type] = (byType[q.type] || 0) + 1; });
    return json({ state: { mode: 'free', ...state }, queue: queue.length, byType, inbox: list.keys.map((k) => k.name) }, 200, origin);
  }
  if (path === '/queue' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const items = Array.isArray(body && body.items) ? body.items.filter((i) => pathsFor(i)) : null;
    if (!items) return json({ error: 'Geen geldige wachtrij' }, 400, origin);
    if (items.length > 20000) return json({ error: 'Wachtrij te groot' }, 400, origin);
    await env.MS_KV.put(NS_QUEUE, JSON.stringify(items));
    return json({ ok: true, queue: items.length }, 200, origin);
  }
  if (path === '/mode' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !MODES.includes(body.mode)) return json({ error: 'Onbekende stand' }, 400, origin);
    const state = await nsGet(env, NS_STATE, {});
    await env.MS_KV.put(NS_STATE, JSON.stringify({ ...state, mode: body.mode }));
    return json({ ok: true, mode: body.mode }, 200, origin);
  }
  if (path === '/run' && request.method === 'POST') {
    return json(await nsRun(env, 'handmatig'), 200, origin);
  }
  const m = path.match(/^\/inbox\/(ns:inbox:\d+)$/);
  if (m && request.method === 'GET') {
    const v = await env.MS_KV.get(m[1]);
    return v ? new Response(v, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(origin) } }) : json({ error: 'Niet gevonden' }, 404, origin);
  }
  if (m && request.method === 'DELETE') {
    await env.MS_KV.delete(m[1]);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'Onbekend pad' }, 404, origin);
}

// ---------- Worker ----------

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      nsScheduled(env, event.scheduledTime),
      pushScheduled(env, event.scheduledTime).catch(() => {}),
      squadScheduled(env, event.scheduledTime).catch(() => {}),
      liveScheduled(env, event.scheduledTime, {
        base: HIGHLIGHTLY_BASE, remainingOf,
        state: () => nsGet(env, NS_STATE, {}),
        saveRemaining: async (n) => { const s = await nsGet(env, NS_STATE, {}); await env.MS_KV.put(NS_STATE, JSON.stringify({ ...s, remaining: n })); },
        saveLimit: async (n) => { const s = await nsGet(env, NS_STATE, {}); await env.MS_KV.put(NS_STATE, JSON.stringify({ ...s, limit: n })); },
      }).catch(() => {}),
      askScheduled(env, event.scheduledTime, { state: () => nsGet(env, NS_STATE, {}) }).catch(() => {}),
      boardScheduled(env, event.scheduledTime, {
        base: HIGHLIGHTLY_BASE, remainingOf, inboxPrefix: NS_INBOX,
        state: () => nsGet(env, NS_STATE, {}),
        saveRemaining: async (n) => { const s = await nsGet(env, NS_STATE, {}); await env.MS_KV.put(NS_STATE, JSON.stringify({ ...s, remaining: n })); },
      }).catch(() => {}),
      followUp(env, event.scheduledTime, {
        base: HIGHLIGHTLY_BASE, inboxPrefix: NS_INBOX, remainingOf,
        state: () => nsGet(env, NS_STATE, {}),
        saveRemaining: async (n) => { const s = await nsGet(env, NS_STATE, {}); await env.MS_KV.put(NS_STATE, JSON.stringify({ ...s, remaining: n })); },
      }).catch(() => {}),
    ]));
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    // Ja/Nee uit de melding "Live meldingen voor dit duel?": geen login (service worker), wel een token per apparaat en duel.
    if (url.pathname === '/live/optin' && request.method === 'POST') {
      if (!env.MS_KV) return json({ error: 'KV ontbreekt' }, 501, origin);
      let body = null; try { body = await request.json(); } catch { /* leeg */ }
      return optinApi(env.MS_KV, body, (b, st) => json(b, st, origin));
    }
    const isNs = url.pathname.startsWith('/ns/');
    const isPush = url.pathname.startsWith('/push/');
    const isBackup = url.pathname.startsWith('/backup/');
    const isSquad = url.pathname === '/squad' || url.pathname.startsWith('/squad/');
    if (request.method !== 'GET' && !(isNs && ['POST', 'DELETE'].includes(request.method)) && !((isPush || isBackup || isSquad) && request.method === 'POST')) {
      return json({ error: 'Methode niet toegestaan' }, 405, origin);
    }

    if (!env.HIGHLIGHTLY_KEY || !env.ALLOWED_UID) {
      return json({ error: 'Worker is nog niet ingesteld (HIGHLIGHTLY_KEY of ALLOWED_UID ontbreekt)' }, 500, origin);
    }

    // Wie is dit?
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return json({ error: 'Niet ingelogd' }, 401, origin);

    let user;
    try {
      user = await verifyIdToken(token);
    } catch (err) {
      return json({ error: 'Login ongeldig', detail: err.message }, 401, origin);
    }
    if (user.sub !== env.ALLOWED_UID) {
      return json({ error: 'Dit account heeft geen toegang' }, 403, origin);
    }

    // Nachtploeg: wachtrij, stand, handmatige run en de brievenbus.
    if (isNs) return nsApi(request, env, url, origin);

    // Meldingen op wedstrijddag: sleutel, aanmelden, programma klaarzetten, testmelding.
    if (isPush) {
      if (!env.MS_KV) return json({ error: 'Meldingen: KV-namespace MS_KV is nog niet gekoppeld' }, 501, origin);
      return pushApi(request, env, url, (b, st) => json(b, st, origin));
    }

    // Automatische back-ups (gzip-bestanden van de app), de laatste 4.
    if (isBackup) {
      if (!env.MS_KV) return json({ error: 'Back-ups: KV-namespace MS_KV is nog niet gekoppeld' }, 501, origin);
      return backupApi(request, env, url, (b, st) => json(b, st, origin), corsHeaders(origin));
    }

    // Selectiepagina's van de clubsite: instellen, snapshot lezen, nu ophalen.
    if (isSquad) {
      if (!env.MS_KV) return json({ error: 'Selectiepagina: KV-namespace MS_KV is nog niet gekoppeld' }, 501, origin);
      return squadApi(request, env, url, (b, st) => json(b, st, origin));
    }

    // Fotogalerij: plaatje van een toegestane site binnenhalen (geen Highlightly-call).
    if (url.pathname === '/img') return imgApi(url, (b, st) => json(b, st, origin), corsHeaders(origin));

    // Live-standen van de Cambuur-wedstrijd (de Worker vraagt ze op; geen Highlightly-call per app-verzoek).
    if (url.pathname === '/live') {
      if (!env.MS_KV) return json({ error: 'Live: KV-namespace MS_KV is nog niet gekoppeld' }, 501, origin);
      // Beker op aanvraag: ?cup=1 (en &match=<id> voor een duel dat je volgt).
      const cup = url.searchParams.get('cup') ? await cupLive(env, { base: HIGHLIGHTLY_BASE, remainingOf, state: () => nsGet(env, NS_STATE, {}) }, url.searchParams.get('match')).catch(() => null) : null;
      return liveApi(env, (b, st) => json(cup ? { ...b, cup } : b, st, origin, { 'Cache-Control': 'no-store' }));
    }

    // Gezondheidscheck: geen Highlightly-call, kost geen quotum.
    if (url.pathname === '/health') {
      return json({ ok: true, uid: user.sub }, 200, origin);
    }

    // VI-nieuws: geen Highlightly-call, kost geen quotum.
    if (url.pathname === '/news/vi') {
      const tag = url.searchParams.get('tag');
      if (tag && !/^[a-z0-9-]{2,40}$/.test(tag)) return json({ error: 'Ongeldige tag' }, 400, origin);
      try {
        return json({ items: await viNews(tag), tag: tag || null, fetchedAt: new Date().toISOString() }, 200, origin, { 'Cache-Control': 'no-store' });
      } catch (err) {
        return json({ error: 'VI-feed niet bereikbaar', detail: err.message }, 502, origin);
      }
    }

    // RSSSF-seizoenspagina: alleen /rsssf/nedJJJJ, geen Highlightly-call.
    const rs = url.pathname.match(/^\/rsssf\/ned(\d{4})$/);
    if (rs) {
      const year = Number(rs[1]);
      if (year < 1956 || year > 2040) return json({ error: 'Onbekend seizoen' }, 400, origin);
      try {
        const page = await rsssfPage(year);
        return json({ ...page, fetchedAt: new Date().toISOString() }, 200, origin, { 'Cache-Control': 'no-store' });
      } catch (err) {
        return json({ error: 'RSSSF niet bereikbaar', detail: err.message }, err.status === 404 ? 404 : 502, origin);
      }
    }

    // Doorsturen naar Highlightly: /hl/<pad>
    if (!url.pathname.startsWith('/hl/')) {
      return json({ error: 'Onbekend pad' }, 404, origin);
    }
    const hlPath = url.pathname.slice(3);
    if (!ALLOWED_PATHS.some((re) => re.test(hlPath))) {
      return json({ error: 'Dit endpoint is niet toegestaan', path: hlPath }, 403, origin);
    }

    const upstream = await fetch(`${HIGHLIGHTLY_BASE}${hlPath}${url.search}`, {
      headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_KEY },
    });

    const extra = {};
    for (const [name, value] of upstream.headers) {
      const n = name.toLowerCase();
      if (n.includes('ratelimit') && n.includes('remaining')) extra['X-MS-RateLimit-Remaining'] = value;
      else if (n.includes('ratelimit') && n.includes('limit')) extra['X-MS-RateLimit-Limit'] = value;
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
        ...corsHeaders(origin),
        ...extra,
      },
    });
  },
};
