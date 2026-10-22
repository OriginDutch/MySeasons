// RSSSF-basis per seizoen ophalen, lezen, controleren en bewaren. Kost 0 Highlightly-calls.

import { rsssf } from './api.js';
import { saveRsssf, getRsssf } from './store.js';
import { parseRsssf, verify, RSSSF_CREDIT, RSSSF_LEAGUE, tokens } from './rsssf.js';
import { MAIN_CLUB } from './config.js';
import { nameRs } from './clubnames.js';

/** Seizoen 2024 (= 2024/25) staat op RSSSF als ned2025. */
export async function importRsssf(year) {
  const page = await rsssf(year + 1);
  const parsed = parseRsssf(page.text, year);
  const checks = parsed.divisions.map((d) => ({ name: d.name, leagueId: RSSSF_LEAGUE[d.name] || null, ...verify(d) }));
  const data = {
    year, url: page.url, credit: RSSSF_CREDIT, fetchedAt: new Date().toISOString(),
    divisions: parsed.divisions.map((d) => ({ ...d, leagueId: RSSSF_LEAGUE[d.name] || null })),
    cup: parsed.cup,
    checks: checks.map(({ matches, ...c }) => ({ ...c, matches: matches || 0 })),
  };
  await saveRsssf(year, data);
  return data;
}

const isMain = (name) => tokens(name).includes(tokens(MAIN_CLUB.name)[0]);
const cleanName = (n) => String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim();

/** De divisie waarin de hoofdclub dat seizoen speelde, volgens RSSSF. */
export function mainDivision(rs) {
  return rs && rs.divisions ? rs.divisions.find((d) => d.table.some((r) => isMain(r.name))) || null : null;
}

/** RSSSF-eindstand in hetzelfde formaat als de Highlightly-stand, zodat de standweergave hem kan tonen. */
export function rsssfStandings(rs, leagueId) {
  const d = rs && rs.divisions ? rs.divisions.find((x) => x.leagueId === leagueId) : null;
  if (!d || !d.table.length) return null;
  return {
    source: 'rsssf', credit: rs.credit, fetchedAt: rs.fetchedAt,
    league: { id: leagueId, name: d.name },
    groups: [{
      name: d.name,
      rows: d.table.map((r) => ({
        position: r.pos, points: r.points,
        team: nameRs({ id: isMain(r.name) ? MAIN_CLUB.id : `rs:${cleanName(r.name)}`, name: cleanName(r.name), logo: null }),
        total: { played: r.played, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga },
        home: null, away: null, deduction: r.deduction, remark: r.remark,
      })),
    }],
  };
}

export { getRsssf };
