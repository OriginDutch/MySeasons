// Plaatjes binnenhalen voor de fotogalerij: alleen van toegestane sites, alleen afbeeldingen, max. 8 MB.
// De browser mag deze plaatjes niet zelf lezen (CORS); de app slaat ze daarna verkleind op in Firestore.
// Geen open proxy: elke host (ook na een doorverwijzing) moet op de lijst staan.

const HOSTS = [
  /(^|\.)transfermarkt\.technology$/, // img.a.transfermarkt.technology
  /^tmssl\.akamaized\.net$/, // oudere Transfermarkt-plaatjes
  /(^|\.)transfermarkt\.(nl|com|de|co\.uk|be)$/,
  /(^|\.)cambuur\.nl$/, // clubsite
];
const MAX_BYTES = 8 * 1024 * 1024;

export const allowedImageHost = (host) => HOSTS.some((re) => re.test(String(host || '').toLowerCase()));

function check(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'Ongeldige link'; }
  if (u.protocol !== 'https:') return 'Alleen https-links';
  if (u.username || u.password || (u.port && u.port !== '443')) return 'Ongeldige link';
  if (!allowedImageHost(u.hostname)) return `Site niet toegestaan: ${u.hostname}`;
  return null;
}

/** GET /img?url=… → { status, body | error }. reply(body, status) voor fouten, cors voor de afbeelding. */
export async function imgApi(url, reply, cors) {
  let target = url.searchParams.get('url') || '';
  const bad = check(target);
  if (bad) return reply({ error: bad }, 400);
  let res;
  for (let hop = 0; hop < 4; hop++) {
    try {
      res = await fetch(target, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (MySeasons fotogalerij)', Accept: 'image/*' }, signal: AbortSignal.timeout(12000) });
    } catch (err) { return reply({ error: 'Site niet bereikbaar', detail: String(err && err.message || err) }, 502); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
      target = new URL(res.headers.get('Location'), target).toString();
      const b = check(target);
      if (b) return reply({ error: `Doorverwezen naar een niet-toegestane site (${b})` }, 400);
      continue;
    }
    break;
  }
  if (!res || !res.ok) return reply({ error: `De site gaf fout ${res ? res.status : '?'}` }, 502);
  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return reply({ error: 'Dit is geen afbeelding', type }, 415);
  const len = Number(res.headers.get('Content-Length') || 0);
  if (len > MAX_BYTES) return reply({ error: 'Afbeelding te groot' }, 413);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return reply({ error: 'Afbeelding te groot' }, 413);
  return new Response(buf, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-MS-Final-Url': target, ...cors } });
}
