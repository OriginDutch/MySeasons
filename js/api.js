// Praat met de MySeasons-Worker. De Worker bewaart de Highlightly-key;
// de app stuurt alleen je Firebase-login mee zodat de Worker weet dat jij het bent.

import { auth } from './firebase.js';

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

async function call(path, params) {
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
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError('Geen verbinding met de Worker', 0);
  }

  const remaining = res.headers.get('X-MS-RateLimit-Remaining');
  const limit = res.headers.get('X-MS-RateLimit-Limit');
  if (remaining !== null) lastRateLimit = { remaining: Number(remaining), limit: limit !== null ? Number(limit) : null };

  let body = null;
  try { body = await res.json(); } catch { /* geen JSON */ }

  if (!res.ok) {
    if (res.status === 429) throw new ApiError('API-quotum voor vandaag is op', 429);
    const msg = (body && body.error) || `Fout ${res.status}`;
    throw new ApiError(msg, res.status, body && body.detail);
  }
  return body;
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
