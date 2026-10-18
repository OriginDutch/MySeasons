// Automatische back-ups: de app maakt ze (gzip), de Worker bewaart de laatste 4 in KV.
// De Worker leest of schrijft nooit in Firestore: hij bewaart alleen het bestand dat de app aanlevert.

const PREFIX = 'bk:';
const KEEP = 4;
const MAX_BYTES = 24 * 1024 * 1024; // KV-waarde mag max. 25 MiB

export async function backupApi(request, env, url, json, cors) {
  const kv = env.MS_KV;
  const path = url.pathname.slice(7); // na /backup
  if (path === '/list' && request.method === 'GET') {
    const list = await kv.list({ prefix: PREFIX });
    const items = list.keys.map((k) => ({ key: k.name, ...(k.metadata || {}) })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return json({ items, keep: KEEP }, 200);
  }
  if (path === '/upload' && request.method === 'POST') {
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.length < 20 || buf[0] !== 0x1f || buf[1] !== 0x8b) return json({ error: 'Geen gzip-back-up' }, 400);
    if (buf.length > MAX_BYTES) return json({ error: 'Back-up te groot voor de opslag (max. 24 MB)' }, 413);
    const at = new Date().toISOString();
    const meta = {
      at, size: buf.length,
      docs: Number(url.searchParams.get('docs')) || null,
      version: String(url.searchParams.get('v') || '').slice(0, 20),
      why: url.searchParams.get('why') === 'manual' ? 'manual' : 'auto',
    };
    const key = PREFIX + at;
    await kv.put(key, buf, { metadata: meta });
    // Opruimen: alleen de nieuwste KEEP blijven staan.
    const list = await kv.list({ prefix: PREFIX });
    const old = list.keys.map((k) => k.name).sort().reverse().slice(KEEP);
    await Promise.all(old.map((k) => kv.delete(k)));
    return json({ ok: true, key, ...meta, removed: old.length }, 200);
  }
  if (path === '/get' && request.method === 'GET') {
    const key = url.searchParams.get('key') || '';
    if (!key.startsWith(PREFIX)) return json({ error: 'Onbekende back-up' }, 400);
    const v = await kv.get(key, 'arrayBuffer');
    if (!v) return json({ error: 'Niet gevonden' }, 404);
    return new Response(v, { status: 200, headers: { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', ...cors } });
  }
  return json({ error: 'Onbekend pad' }, 404);
}
