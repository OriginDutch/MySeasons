// Selectiepagina's van de clubsite volgen: één keer per dag ophalen, namen + rugnummers eruit halen, snapshot bewaren.
// Geen Highlightly-calls. De app vergelijkt de snapshot met jouw selectie en jij beslist wat je overneemt.
//
// KV: sq:pages = [{ url, level: 'first' | 'o21' }], sq:snap = { at, changedAt, sig, pages: [...] }, sq:day = 'YYYY-MM-DD'.
// Generiek uitlezen, drie manieren (samengevoegd):
//   A. tabelrijen met een nummer-cel en een naam-cel (bijv. de O21-pagina)
//   B. links naar een subpagina van de selectiepagina (spelerkaarten), met het dichtstbijzijnde nummer ("Nr1", "#1", "1")
//   C. tekstregels "Nr 1 Naam" / "1. Naam"
// Kopjes (Keepers, Verdediging, ...) geven de linie; alles onder een staf-kopje wordt overgeslagen.

const PAGES = 'sq:pages';
const SNAP = 'sq:snap';
const DAY = 'sq:day';
const RUN_AT_HOUR = 7; // 07:00 NL-tijd
const MAX_PAGES = 6;
const MAX_BYTES = 3_000_000;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euml: 'ë', iuml: 'ï', eacute: 'é', egrave: 'è', ccedil: 'ç', ouml: 'ö', uuml: 'ü', auml: 'ä', aacute: 'á', oacute: 'ó', ntilde: 'ñ' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (html) => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const LINE_OF = [
  [/keeper|doelm|goalkeep|goalie/i, 'Goalkeeper'],
  [/verdedig|defen|achterhoede/i, 'Defender'],
  [/middenv|midfield/i, 'Midfielder'],
  [/aanval|forward|spits|attack|voorhoede/i, 'Forward'],
];
const STAFF = /staf|staff|trainer|begeleid|coach|medisch|management|directie/i;
const PARTICLES = new Set(['van', 'der', 'de', 'den', 'het', 'ter', 'ten', 'te', 'el', 'al', 'da', 'dos', 'di', 'le', 'la', 'du', 'op', 'in', "'t", 'bin', 'ben', 'von', 'y']);
const NAV = /^(home|nieuws|tickets|selectie|naam|functie|contact|lees meer|meer|bekijk|shop|partners|club|jeugd|o\d\d|eerste elftal|keepers|verdediging|middenveld|aanvallers)$/i;

/** Lijkt dit op een persoonsnaam? 2–5 woorden, begint met een hoofdletter, alleen letters/tussenvoegsels. */
export function looksLikeName(s) {
  const n = String(s || '').replace(/\((k|c|aanvoerder)\)/gi, '').replace(/\s+/g, ' ').trim();
  if (n.length < 4 || n.length > 45 || NAV.test(n)) return null;
  const words = n.split(' ');
  if (words.length < 2 || words.length > 5) return null;
  if (!/^\p{Lu}/u.test(words[0])) return null;
  const ok = words.every((w) => PARTICLES.has(w.toLowerCase()) || /^[\p{L}][\p{L}'’.-]*$/u.test(w));
  return ok ? n : null;
}

const lineFrom = (h) => { for (const [re, v] of LINE_OF) if (re.test(h)) return v; return null; };
const numFrom = (s) => { const m = String(s).trim().match(/^(?:nr\.?\s*|#\s*|no\.?\s*)?(\d{1,2})\.?$/i); return m ? Number(m[1]) : null; };

/** HTML → [{ name, number, line }] */
export function extractSquad(html, pageUrl) {
  const src = String(html || '').slice(0, MAX_BYTES)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ');
  const found = new Map(); // key: naam (lowercase) -> speler
  const add = (name, number, line, staff) => {
    const n = looksLikeName(name); if (!n || staff) return;
    const k = n.toLowerCase();
    const prev = found.get(k);
    if (!prev) found.set(k, { name: n, number: number ?? null, line: line || null });
    else { if (prev.number == null && number != null) prev.number = number; if (!prev.line && line) prev.line = line; }
  };

  // Een stroom van gebeurtenissen: kopjes, tabelrijen, links en losse tekst.
  const base = (() => { try { const u = new URL(pageUrl); return u.origin + u.pathname.replace(/\/?$/, '/'); } catch { return null; } })();
  const events = [];
  const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<tr\b[^>]*>([\s\S]*?)<\/tr>|<a\b([^>]*)>([\s\S]*?)<\/a>|>([^<>]+)(?=<)/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) events.push({ k: 'h', t: text(m[2]) });
    else if (m[3] != null) events.push({ k: 'tr', cells: [...m[3].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1])) });
    else if (m[4] != null) {
      const attrs = m[4];
      const href = decode((attrs.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
      const title = decode((attrs.match(/title\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
      let abs = null; try { abs = new URL(href, pageUrl).href; } catch { /* geen geldige link */ }
      let inner = text(m[5]);
      const num = numFrom(inner);
      if (num != null) events.push({ k: 'n', n: num });
      // "Nr1 Thijs Jansen" in één link: nummer en naam los
      const both = inner.match(/^(?:nr\.?\s*|#\s*)?(\d{1,2})[.)]?\s+(.+)$/i);
      if (both && looksLikeName(both[2])) { events.push({ k: 'n', n: Number(both[1]) }); inner = both[2]; }
      // Naam + extra tekst ("Thijs Jansen Keeper"): dan de title, als die wel een naam is
      if (looksLikeName(title) && (!looksLikeName(inner) || (inner !== title && inner.includes(title)))) inner = title;
      events.push({ k: 'a', href: abs, t: inner || title });
    } else if (m[6] != null) {
      const t = decode(m[6]).replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const num = numFrom(t);
      if (num != null) events.push({ k: 'n', n: num });
      else events.push({ k: 't', t });
    }
  }

  let line = null; let staff = false;
  // A + C in één doorloop; B daarna met de posities.
  const cards = []; // { href, name, idx, line, staff }
  events.forEach((e, i) => {
    if (e.k === 'h') { const l = lineFrom(e.t); if (l) { line = l; staff = false; } else if (STAFF.test(e.t)) staff = true; else if (looksLikeName(e.t)) cards.push({ href: null, name: e.t, idx: i, line, staff }); return; }
    if (e.k === 'tr') {
      const ni = e.cells.findIndex((c) => numFrom(c) != null);
      const nm = e.cells.find((c) => looksLikeName(c));
      if (ni >= 0 && nm) add(nm, numFrom(e.cells[ni]), line, staff);
      return;
    }
    if (e.k === 'a' && base && e.href && e.href.startsWith(base) && e.href.length > base.length + 1 && looksLikeName(e.t)) {
      cards.push({ href: e.href, name: e.t, idx: i, line, staff });
      return;
    }
    if (e.k === 't') {
      const mm = e.t.match(/^(?:nr\.?\s*|#\s*)?(\d{1,2})[.)]?\s+(.+)$/i);
      if (mm && looksLikeName(mm[2])) add(mm[2], Number(mm[1]), line, staff);
    }
  });
  // B: nummer = het dichtstbijzijnde nummer tussen de vorige en de volgende kaart (vóór gaat voor bij gelijke afstand).
  const uniq = []; const seenHref = new Set();
  cards.forEach((c) => { const key = c.href || c.name; if (seenHref.has(key)) return; seenHref.add(key); uniq.push(c); });
  uniq.forEach((c, j) => {
    const lo = j ? uniq[j - 1].idx : -1; const hi = j < uniq.length - 1 ? uniq[j + 1].idx : events.length;
    let best = null; let dist = Infinity;
    for (let i = lo + 1; i < hi; i++) {
      if (events[i].k !== 'n') continue;
      const d = i < c.idx ? c.idx - i : (i - c.idx) + 0.5;
      if (d < dist) { dist = d; best = events[i].n; }
    }
    add(c.name, best, c.line, c.staff);
  });
  return [...found.values()];
}

async function fetchPage(p) {
  try {
    const res = await fetch(p.url, { headers: { 'User-Agent': 'MySeasons/1.0 (persoonlijke supporterstracker; 1x per dag)', Accept: 'text/html' }, cf: { cacheTtl: 3600 } });
    if (!res.ok) return { ...p, error: `HTTP ${res.status}`, players: [] };
    const html = await res.text();
    const players = extractSquad(html, p.url);
    return { ...p, players, error: players.length ? null : 'Geen spelers gevonden op deze pagina' };
  } catch (err) {
    return { ...p, error: String(err.message || err).slice(0, 120), players: [] };
  }
}

const sigOf = (pages) => JSON.stringify(pages.map((p) => [p.url, p.error ? 'ERR' : p.players.map((x) => `${x.name}|${x.number ?? ''}|${x.line ?? ''}`).sort()]));

export async function refreshSquad(env, time = Date.now()) {
  const pages = (await env.MS_KV.get(PAGES, 'json')) || [];
  const prev = (await env.MS_KV.get(SNAP, 'json')) || null;
  const results = [];
  for (const p of pages.slice(0, MAX_PAGES)) results.push(await fetchPage(p)); // na elkaar: rustig voor de site
  const at = new Date(time).toISOString();
  const sig = sigOf(results);
  // Een mislukte ophaalronde is geen "wijziging": dan houden we de oude spelers van die pagina.
  const merged = results.map((r) => (r.error && prev ? { ...r, players: (prev.pages || []).find((x) => x.url === r.url)?.players || [] } : r));
  const changed = !prev || (prev.sig !== sig && !results.some((r) => r.error));
  const snap = { at, sig: changed ? sig : (prev ? prev.sig : sig), changedAt: changed ? at : prev.changedAt, pages: merged };
  await env.MS_KV.put(SNAP, JSON.stringify(snap));
  return snap;
}

/** Elke minuut aangeroepen; draait één keer per dag vanaf 07:00 NL-tijd. */
export async function squadScheduled(env, time) {
  if (!env.MS_KV) return;
  const p = Object.fromEntries(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)).map((x) => [x.type, x.value]));
  if (Number(p.hour) < RUN_AT_HOUR) return;
  const today = `${p.year}-${p.month}-${p.day}`;
  if ((await env.MS_KV.get(DAY)) === today) return;
  const pages = (await env.MS_KV.get(PAGES, 'json')) || [];
  await env.MS_KV.put(DAY, today, { expirationTtl: 3 * 86400 });
  if (pages.length) await refreshSquad(env, time);
}

/** /squad/* achter de login. GET /squad, POST /squad/pages { pages }, POST /squad/refresh */
export async function squadApi(request, env, url, json) {
  const kv = env.MS_KV;
  const path = url.pathname.slice(6); // na /squad
  if ((path === '' || path === '/') && request.method === 'GET') {
    return json({ pages: (await kv.get(PAGES, 'json')) || [], snap: (await kv.get(SNAP, 'json')) || null }, 200);
  }
  if (path === '/pages' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const list = Array.isArray(body && body.pages) ? body.pages : null;
    if (!list) return json({ error: 'Geen pagina\'s' }, 400);
    const clean = list.slice(0, MAX_PAGES).filter((p) => p && /^https:\/\/[^\s]+$/.test(String(p.url || ''))).map((p) => ({ url: String(p.url).trim().slice(0, 300), level: p.level === 'o21' ? 'o21' : 'first' }));
    await kv.put(PAGES, JSON.stringify(clean));
    return json({ ok: true, pages: clean }, 200);
  }
  if (path === '/refresh' && request.method === 'POST') {
    return json({ ok: true, snap: await refreshSquad(env) }, 200);
  }
  return json({ error: 'Onbekend pad' }, 404);
}
