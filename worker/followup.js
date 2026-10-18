// Uitslag automatisch ophalen: ~2,5 uur na de aftrap van een Cambuur-wedstrijd (programma uit push:schedule).
// Nog niet afgelopen? Elk half uur opnieuw, tot 6 uur na de aftrap. De volgende ochtend om 08:00 nog één keer
// (Highlightly verbetert details soms achteraf). Resultaat in de brievenbus, zoals de nachtploeg; de app schrijft.

import { broadcast } from './push.js';

const SCHEDULE = 'push:schedule';
const PREFS = 'push:prefs';
const FU = 'fu:';
const TZ = 'Europe/Amsterdam';
const FIRST_AFTER = 150 * 60e3; // 2,5 uur na de aftrap
const LAST_AFTER = 6 * 3600e3;
const RETRY = 30 * 60e3;
const MIN_REMAINING = 5; // nooit je laatste calls opmaken

const localHour = (d) => Number(new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
const localDate = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(d);

export async function getPrefs(kv) {
  return { results: true, resultPush: true, ...((await kv.get(PREFS, 'json')) || {}) };
}

function scoreOf(body) {
  try {
    const d = JSON.parse(body); const m = Array.isArray(d) ? d[0] : d;
    const desc = String((m && m.state && m.state.description) || '').toLowerCase();
    const cur = m && m.state && m.state.score && m.state.score.current;
    const pen = m && m.state && m.state.score && m.state.score.penalties;
    return { finished: desc.includes('finished'), postponed: /postpon|cancel|abandon|suspend/.test(desc), score: cur || null, pen: pen || null, league: m && m.league ? { id: m.league.id, season: m.league.season } : null };
  } catch { return { finished: false }; }
}

/**
 * Elke minuut vanuit de cron. deps: { base, key, inboxPrefix, remainingOf, state: () => ns-state, saveRemaining(n) }.
 */
export async function followUp(env, time, deps) {
  const kv = env.MS_KV;
  if (!kv || !env.HIGHLIGHTLY_KEY) return;
  const prefs = await getPrefs(kv);
  if (!prefs.results) return;
  const schedule = (await kv.get(SCHEDULE, 'json')) || [];
  const now = Number(time);
  for (const m of schedule) {
    const ko = Date.parse(m.date);
    if (!ko || now < ko + FIRST_AFTER) continue;
    const key = FU + m.id;
    const st = (await kv.get(key, 'json')) || { tries: 0 };
    const morning = st.done && !st.refreshed && now > ko + 10 * 3600e3 && now < ko + 40 * 3600e3 && localDate(new Date(now)) !== localDate(new Date(ko)) && localHour(new Date(now)) >= 8;
    const first = !st.done && !st.gaveUp && now <= ko + LAST_AFTER && (!st.last || now - st.last >= RETRY);
    if (!first && !morning) {
      if (!st.done && !st.gaveUp && now > ko + LAST_AFTER) await kv.put(key, JSON.stringify({ ...st, gaveUp: true }), { expirationTtl: 3 * 86400 });
      continue;
    }
    const ns = await deps.state();
    if (ns.remaining != null && ns.remaining < MIN_REMAINING) continue;

    const get = async (p) => {
      const res = await fetch(`${deps.base}${p}`, { headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_KEY } });
      const r = deps.remainingOf(res); if (r != null) await deps.saveRemaining(r);
      if (res.status === 429) throw new Error('quota');
      return res.ok ? res.text() : null;
    };
    try {
      const detail = await get(`/matches/${Number(m.id)}`);
      const info = detail ? scoreOf(detail) : { finished: false };
      if (!info.finished) {
        await kv.put(key, JSON.stringify({ ...st, tries: st.tries + 1, last: now, ...(info.postponed ? { gaveUp: true } : {}) }), { expirationTtl: 3 * 86400 });
        continue;
      }
      const [lineups, box] = [await get(`/lineups/${Number(m.id)}`), await get(`/box-score/${Number(m.id)}`)];
      const results = [{ item: { type: 'full', id: Number(m.id), why: morning ? 'controle' : 'uitslag' }, status: 200, bodies: [detail, lineups, box] }];
      if (!morning && info.league && info.league.id && info.league.season != null) {
        const standings = await get(`/standings?leagueId=${Number(info.league.id)}&season=${Number(info.league.season)}`).catch(() => null);
        if (standings) results.push({ item: { type: 'standings', leagueId: Number(info.league.id), season: Number(info.league.season) }, status: 200, bodies: [standings] });
      }
      await kv.put(`${deps.inboxPrefix}${now}`, JSON.stringify({ at: new Date(now).toISOString(), results }));
      await kv.put(key, JSON.stringify({ ...st, done: true, refreshed: morning || st.refreshed || false, last: now, score: info.score }), { expirationTtl: 3 * 86400 });
      if (!morning && prefs.resultPush) {
        const sc = String(info.score || '').replace(/\s*-\s*/, '–');
        const pen = info.pen ? ` (${String(info.pen).replace(/\s*-\s*/, '–')} pen.)` : '';
        await broadcast(kv, { title: `Uitslag: ${m.homeName} ${sc} ${m.awayName}${pen}`, body: 'Opstelling en tijdlijn staan klaar. Tik om toeschouwers en je man van de wedstrijd in te vullen.', url: `#/wedstrijd/${m.id}`, tag: `result-${m.id}` });
      }
    } catch (err) {
      if (String(err.message) === 'quota') return; // morgen verder
      await kv.put(key, JSON.stringify({ ...st, tries: st.tries + 1, last: now }), { expirationTtl: 3 * 86400 });
    }
  }
}
