// MySeasons API — Cloudflare Worker
//
// Doet drie dingen:
// 1. Checkt of de aanvraag van jou komt (Firebase ID-token + jouw UID).
// 2. Stuurt alleen toegestane Highlightly-aanvragen door, met de key die hier als secret staat.
// 3. Zet CORS-headers zodat alleen de MySeasons-app hem kan gebruiken.
//
// Instellen in Cloudflare (Settings → Variables and Secrets):
//   HIGHLIGHTLY_KEY  (type Secret)  je Highlightly API-key
//   ALLOWED_UID      (type Text)    je Firebase UID uit MySeasons → Meer → Instellingen

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
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

// ---------- Worker ----------

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return json({ error: 'Alleen GET is toegestaan' }, 405, origin);
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

    // Gezondheidscheck: geen Highlightly-call, kost geen quotum.
    if (url.pathname === '/health') {
      return json({ ok: true, uid: user.sub }, 200, origin);
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
