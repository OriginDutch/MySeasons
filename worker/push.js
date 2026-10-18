// Web Push vanuit de Worker: "Veel plezier bij…" / "Succes met…" om 09:00 op wedstrijddag.
//
// Geen sleutel om in te stellen: de Worker maakt bij het eerste gebruik zelf een VAPID-sleutelpaar
// en bewaart het in KV (push:vapid). Alleen de publieke sleutel gaat naar de app.
// De app meldt je telefoon aan (push:subs) en zet de komende wedstrijden klaar (push:schedule).
//
// Versleuteling volgens RFC 8291 (aes128gcm) en VAPID volgens RFC 8292, alles met WebCrypto.

const VAPID = 'push:vapid';
const SUBS = 'push:subs';
const SCHEDULE = 'push:schedule';
const SENT = 'push:sent:';
const TZ = 'Europe/Amsterdam';
const SEND_AT = '09:00';
const CONTACT = 'mailto:myseasons@example.invalid';

// ---------- base64url ----------
const enc = new TextEncoder();
export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; b.forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
};

// ---------- VAPID-sleutels ----------
export async function vapidKeys(kv) {
  const saved = await kv.get(VAPID, 'json');
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const keys = { jwk, publicKey: b64u(pub), createdAt: new Date().toISOString() };
  await kv.put(VAPID, JSON.stringify(keys));
  return keys;
}

async function vapidHeader(keys, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })));
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// ---------- RFC 8291 ----------
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Versleutel payload voor één abonnement. Geeft de body (aes128gcm) terug. */
export async function encrypt(sub, payload, { salt = crypto.getRandomValues(new Uint8Array(16)), local = null } = {}) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const pair = local || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02 = laatste record
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // recordgrootte 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Eén melding naar één abonnement. Geeft de HTTP-status van de pushdienst terug. */
export async function sendPush(kv, sub, message) {
  const keys = await vapidKeys(kv);
  const body = await encrypt(sub, JSON.stringify(message));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(keys, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'normal',
    },
    body,
  });
  return res.status;
}

/** Naar alle aangemelde apparaten. Verlopen abonnementen (404/410) ruimen we op. */
export async function broadcast(kv, message) {
  const subs = (await kv.get(SUBS, 'json')) || [];
  const results = await Promise.all(subs.map((s) => sendPush(kv, s, message).catch(() => 0)));
  const alive = subs.filter((s, i) => results[i] !== 404 && results[i] !== 410);
  if (alive.length !== subs.length) await kv.put(SUBS, JSON.stringify(alive));
  return { sent: results.filter((r) => r >= 200 && r < 300).length, total: subs.length, results };
}

// ---------- Wedstrijddag ----------
const localParts = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

export function matchMessage(m) {
  const kick = localParts(new Date(m.date)).time;
  const title = m.home ? `Veel plezier bij ${m.homeName} – ${m.awayName}!` : `Succes met ${m.homeName} – ${m.awayName}!`;
  const body = `Aftrap ${kick}${m.comp ? ` · ${m.comp}` : ''}${m.venue ? ` · ${m.venue}` : ''}`;
  return { title, body, url: `#/wedstrijd/${m.id}`, tag: `match-${m.id}` };
}

/** Elke minuut aangeroepen. Om 09:00 NL-tijd (of later die dag, als die minuut gemist is) één keer per wedstrijd. */
export async function pushScheduled(env, time) {
  if (!env.MS_KV) return;
  const now = localParts(new Date(time));
  if (now.time < SEND_AT) return;
  const schedule = (await env.MS_KV.get(SCHEDULE, 'json')) || [];
  const today = schedule.filter((m) => localParts(new Date(m.date)).date === now.date && Date.parse(m.date) > time);
  for (const m of today) {
    const key = SENT + m.id;
    if (await env.MS_KV.get(key)) continue;
    await env.MS_KV.put(key, new Date(time).toISOString(), { expirationTtl: 3 * 86400 });
    await broadcast(env.MS_KV, matchMessage(m));
  }
}

// ---------- API: /push/* (achter de login) ----------
export async function pushApi(request, env, url, json) {
  const kv = env.MS_KV;
  const path = url.pathname.slice(5); // na /push
  if (path === '/key' && request.method === 'GET') {
    const k = await vapidKeys(kv);
    const subs = (await kv.get(SUBS, 'json')) || [];
    const schedule = (await kv.get(SCHEDULE, 'json')) || [];
    return json({ publicKey: k.publicKey, devices: subs.length, scheduled: schedule.length, sendAt: SEND_AT, tz: TZ }, 200);
  }
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  if (path === '/subscribe' && request.method === 'POST') {
    const s = body && body.subscription;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: 'Ongeldig abonnement' }, 400);
    const subs = ((await kv.get(SUBS, 'json')) || []).filter((x) => x.endpoint !== s.endpoint);
    subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, label: String(body.label || '').slice(0, 60), at: new Date().toISOString() });
    await kv.put(SUBS, JSON.stringify(subs.slice(-10)));
    return json({ ok: true, devices: Math.min(subs.length, 10) }, 200);
  }
  if (path === '/unsubscribe' && request.method === 'POST') {
    const subs = ((await kv.get(SUBS, 'json')) || []).filter((x) => x.endpoint !== (body && body.endpoint));
    await kv.put(SUBS, JSON.stringify(subs));
    return json({ ok: true, devices: subs.length }, 200);
  }
  if (path === '/schedule' && request.method === 'POST') {
    const list = Array.isArray(body && body.matches) ? body.matches.slice(0, 80) : null;
    if (!list) return json({ error: 'Geen programma' }, 400);
    const clean = list.filter((m) => m && m.id && m.date && !Number.isNaN(Date.parse(m.date))).map((m) => ({
      id: String(m.id).slice(0, 20), date: m.date, home: !!m.home,
      homeName: String(m.homeName || '').slice(0, 40), awayName: String(m.awayName || '').slice(0, 40),
      comp: String(m.comp || '').slice(0, 40), venue: String(m.venue || '').slice(0, 60),
    }));
    const prev = await kv.get(SCHEDULE);
    const next = JSON.stringify(clean);
    if (prev !== next) await kv.put(SCHEDULE, next); // KV-writes sparen
    return json({ ok: true, scheduled: clean.length, changed: prev !== next }, 200);
  }
  if (path === '/test' && request.method === 'POST') {
    const r = await broadcast(kv, { title: 'MySeasons', body: 'Testmelding: meldingen op wedstrijddag staan aan.', url: '#/home', tag: 'test' });
    return json({ ok: true, ...r }, 200);
  }
  return json({ error: 'Onbekend pad' }, 404);
}
