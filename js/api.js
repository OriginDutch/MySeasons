// Praat met de MySeasons-Worker. De Worker bewaart de Highlightly-key;
// de app stuurt alleen je Firebase-login mee zodat de Worker weet dat jij het bent.

import { auth } from './firebase.js';
import { noteRateLimit } from './store.js';

export const WORKER_URL = 'https://myseasons-api.marcel-19-95.workers.dev';

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

let lastRateLimit = null;
export function getLastRateLimit() {
  return lastRateLimit;
}

async function call(path, params, { method = 'GET', body, raw = null, binary = false } = {}) {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Niet ingelogd', 401);
  const token = await user.getIdToken();
  const url = new URL(WORKER_URL + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }

  let res;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    if (raw) headers['Content-Type'] = 'application/octet-stream';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    res = await fetch(url, { method, headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError('Geen verbinding met de Worker', 0);
  }

  const remaining = res.headers.get('X-MS-RateLimit-Remaining');
  const limit = res.headers.get('X-MS-RateLimit-Limit');
  if (remaining !== null) {
    lastRateLimit = { remaining: Number(remaining), limit: limit !== null ? Number(limit) : null };
    noteRateLimit(lastRateLimit).catch(() => {});
  }

  if (binary && res.ok) return res.arrayBuffer();
  let data = null;
  try { data = await res.json(); } catch { /* geen JSON */ }

  if (!res.ok) {
    if (res.status === 429) throw new ApiError('API-quotum voor vandaag is op', 429);
    const msg = (data && data.error) || `Fout ${res.status}`;
    throw new ApiError(msg, res.status, data && data.detail);
  }
  return data;
}

/** Test login en Worker-instellingen. Kost geen Highlightly-quotum. */
export function health() {
  return call('/health');
}

/** Highlightly-aanvraag via de Worker, bijv. hl('/matches', { homeTeamId: 358204, season: 2026 }). */
export function hl(path, params) {
  return call('/hl' + path, params);
}

/** VI-nieuws via de Worker: kop, teaser, link, datum en tags. Kost geen Highlightly-quotum. */
export function viNews(tag) {
  return call('/news/vi', tag ? { tag } : undefined);
}

/** RSSSF-seizoenspagina via de Worker (ned2025 = seizoen 2024/25). Kost geen Highlightly-quotum. */
export function rsssf(year) {
  return call(`/rsssf/ned${year}`);
}

// ---------- Nachtploeg (Worker-wachtrij + brievenbus) ----------
export const ns = {
  state: () => call('/ns/state'),
  setQueue: (items) => call('/ns/queue', null, { method: 'POST', body: { items } }),
  setMode: (mode) => call('/ns/mode', null, { method: 'POST', body: { mode } }),
  runNow: () => call('/ns/run', null, { method: 'POST', body: {} }),
  inbox: (key) => call(`/ns/inbox/${key}`),
  ack: (key) => call(`/ns/inbox/${key}`, null, { method: 'DELETE' }),
};

// ---------- Meldingen op wedstrijddag (Web Push via de Worker) ----------
export const push = {
  key: () => call('/push/key'),
  subscribe: (subscription, label) => call('/push/subscribe', null, { method: 'POST', body: { subscription, label } }),
  unsubscribe: (endpoint) => call('/push/unsubscribe', null, { method: 'POST', body: { endpoint } }),
  schedule: (matches) => call('/push/schedule', null, { method: 'POST', body: { matches } }),
  test: () => call('/push/test', null, { method: 'POST', body: {} }),
  prefs: (p) => call('/push/prefs', null, { method: 'POST', body: p }),
};

// ---------- Automatische back-ups (gzip, bewaard in de Worker-KV) ----------
export const backups = {
  list: () => call('/backup/list'),
  upload: (bytes, { docs, version, why = 'auto' } = {}) => call('/backup/upload', { docs, v: version, why }, { method: 'POST', raw: bytes }),
  get: (key) => call('/backup/get', { key }, { binary: true }),
};
