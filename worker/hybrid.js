// Opslag van de Worker: wat vaak verandert in D1 (gratis: 100.000 rijen schrijven per dag), de rest in KV
// (gratis: 1.000 writes per dag). Zelfde vorm als KV (get/put/delete/list), zodat de rest van de Worker niets
// hoeft te weten: in myseasons-api.js wordt env.MS_KV vervangen door dit object.
//
// In D1 ("hot"): de nachtploeg (stand, wachtrij, brievenbus), live-standen, het live-bord, de bekercache, de
// vraag-vooraf-vlaggen en de uitslag-opvolging. In KV blijft: meldingen-abonnementen en sleutels, het programma
// (push:schedule), instellingen, back-ups en de selectiepagina's.
//
// Overstap: bij de eerste run met D1 worden de ns:-sleutels (stand, wachtrij, brievenbus) uit KV overgezet en daar
// weggehaald. Live-standen e.d. niet: die zijn na een paar uur toch verlopen.

const HOT = ['ns:', 'live:', 'livelog:', 'lv:', 'lvc:', 'ask:', 'fu:'];
const COLD = new Set(['live:secret']);
const isHot = (k) => !COLD.has(k) && HOT.some((p) => String(k).startsWith(p));
let ready = null;

async function ensure(db) {
  if (!ready) {
    ready = db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER)').run()
      .catch((err) => { ready = null; throw err; });
  }
  return ready;
}

/** Bovengrens voor een prefix-zoekactie op de primaire sleutel: "ns:inbox:" → "ns:inbox;" */
const upper = (p) => p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1);

export function hybrid(env) {
  const kv = env.MS_KV; const db = env.DB;
  if (!db) return kv; // nog geen D1 gekoppeld: alles zoals voorheen
  return {
    async get(k, type) {
      if (!isHot(k)) return kv.get(k, type);
      await ensure(db);
      const row = await db.prepare('SELECT v, exp FROM kv WHERE k = ?').bind(k).first();
      if (!row || (row.exp && row.exp < Date.now())) return null;
      if (type === 'json') { try { return JSON.parse(row.v); } catch { return null; } }
      return row.v;
    },
    async put(k, v, opts = {}) {
      if (!isHot(k)) return kv.put(k, v, opts);
      await ensure(db);
      const exp = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
      await db.prepare('INSERT INTO kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp').bind(k, String(v), exp).run();
    },
    async delete(k) {
      if (!isHot(k)) return kv.delete(k);
      await ensure(db);
      await db.prepare('DELETE FROM kv WHERE k = ?').bind(k).run();
    },
    async list({ prefix = '' } = {}) {
      if (!isHot(prefix)) return kv.list({ prefix });
      await ensure(db);
      const { results } = await db.prepare('SELECT k FROM kv WHERE k >= ? AND k < ? AND (exp IS NULL OR exp > ?) ORDER BY k LIMIT 1000').bind(prefix, upper(prefix), Date.now()).all();
      return { keys: results.map((r) => ({ name: r.k })), list_complete: true };
    },
  };
}

/** Eén keer: nachtploeg-sleutels uit KV naar D1, en eens per uur verlopen rijen opruimen. */
export async function maintain(env, time) {
  const db = env.DB; const kv = env.MS_KV;
  if (!db || !kv) return;
  await ensure(db);
  const flag = await db.prepare("SELECT v FROM kv WHERE k = 'meta:migrated'").first();
  if (!flag) {
    const keys = ['ns:state', 'ns:queue', ...((await kv.list({ prefix: 'ns:inbox:' })).keys || []).map((x) => x.name)];
    for (const k of keys) {
      const v = await kv.get(k);
      if (v == null) continue;
      await db.prepare('INSERT INTO kv (k, v, exp) VALUES (?, ?, NULL) ON CONFLICT(k) DO NOTHING').bind(k, v).run();
      await kv.delete(k);
    }
    await db.prepare("INSERT INTO kv (k, v, exp) VALUES ('meta:migrated', ?, NULL) ON CONFLICT(k) DO NOTHING").bind(new Date().toISOString()).run();
  }
  if (new Date(Number(time)).getUTCMinutes() === 7) await db.prepare('DELETE FROM kv WHERE exp IS NOT NULL AND exp < ?').bind(Date.now()).run();
}

/** D1-gebruik vandaag is niet op te vragen vanuit de Worker; we tellen zelf de nachtploeg (zie nsRun). */
export const D1_HOT = HOT;
