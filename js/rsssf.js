// RSSSF-lezer voor de Nederlandse seizoenspagina's (rsssf.org/tablesn/nedJJJJ.html).
// Bron: Karel Stokkermans / RSSSF. Kopiëren mag met bronvermelding.
//
// Leest per divisie de eindstand, de speelrondes met datums en de nacompetitie,
// plus de KNVB Beker. Daarna controleert hij zichzelf: de stand die volgt uit de
// gelezen uitslagen moet gelijk zijn aan de eindstand die RSSSF zelf geeft.

export const RSSSF_CREDIT = 'Bron: RSSSF · Karel Stokkermans';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DIVISIONS = ['Eredivisie', 'Eerste Divisie', 'KNVB Beker', 'Tweede Divisie'];
const KEEP = ['Eredivisie', 'Eerste Divisie'];
// Highlightly league-id's per RSSSF-divisie.
export const RSSSF_LEAGUE = { Eredivisie: 75672, 'Eerste Divisie': 76523 };

/** HTML-pagina → regels platte tekst. */
export function toLines(input) {
  let s = String(input || '');
  if (/<[a-z!][^>]*>/i.test(s)) {
    s = s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|div|tr|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  }
  return s.normalize('NFKC').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
}

const DATE_RE = /^\[([A-Z][a-z]{2})\s+(\d{1,2})(?:[^\]]*)\]/;
const ROUND_RE = /^Round\s+(\d+)\b(?:\s*\[([A-Z][a-z]{2})\s+(\d{1,2})[^\]]*\])?/;
// "Final Table:", of bij een afgebroken seizoen (2019/20) "Table at abandonment:".
const TABLE_LABEL = /^\s*(Final Table|Table at (?:time of )?abandonment):?\s*$/i;
const TABLE_RE = /^\s*(\d{1,2})\.(.+?)\s{2,}(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})-(\d{1,3})\s+(-?\d{1,3})\b(.*)$/;
// "Groningen        4-1 NAC   [aet, 5-4 pen]" of "Heracles      abd Groningen     [abandoned ...]"
const MATCH_RE = /^\s*(\S.*?)\s{2,}(\d{1,2})-(\d{1,2})\s+(\S.*?)(?:\s{2,}\[(.*)\]?)?\s*$|^\s*(\S.*?)\s{2,}(abd|awd|ann|postp|canc|n\/p)\.?\s+(\S.*?)(?:\s{2,}\[(.*)\]?)?\s*$/;

function isoDate(seasonStart, mon, day) {
  const m = MONTHS[String(mon).toLowerCase()];
  if (!m) return null;
  const y = m >= 7 ? seasonStart : seasonStart + 1;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNote(raw) {
  const note = (raw || '').replace(/\]$/, '').trim();
  const pen = note.match(/(\d+)-(\d+)\s*pen/);
  return {
    note: note || null,
    aet: /\baet\b/.test(note),
    penalties: pen ? { home: Number(pen[1]), away: Number(pen[2]) } : null,
  };
}

/** Splitst de pagina in secties per divisie (op de kopregel, na de inhoudsopgave). */
function sections(lines) {
  // Elke regel met alleen een divisienaam is een kandidaat-kop: in de inhoudsopgave bovenaan, of de echte kop.
  // De inhoudsopgave eindigt niet altijd met een divisie (2019/20: "Amateur Level"), dus kiezen we per divisie
  // de kandidaat met de meeste inhoud (speelrondes, standregels, uitslagen) tot de volgende kandidaat.
  const cands = [];
  lines.forEach((l, i) => { const t = l.trim(); if (DIVISIONS.includes(t)) cands.push({ name: t, start: i }); });
  const score = (from, to) => lines.slice(from + 1, to).filter((x) => { const t = x.trim(); return ROUND_RE.test(t) || TABLE_RE.test(x) || MATCH_RE.test(x); }).length;
  cands.forEach((c, k) => { c.end = k + 1 < cands.length ? cands[k + 1].start : lines.length; c.score = score(c.start, c.end); });
  const best = new Map();
  cands.forEach((c) => { const b = best.get(c.name); if (c.score > 0 && (!b || c.score > b.score)) best.set(c.name, c); });
  const heads = [...best.values()].sort((a, b) => a.start - b.start);
  return heads.map((h, k) => ({ name: h.name, lines: lines.slice(h.start + 1, k + 1 < heads.length ? heads[k + 1].start : lines.length) }));
}

function parseTable(lines, from) {
  const rows = [];
  let i = from;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(TABLE_RE);
    if (m) {
      const tail = m[10] || '';
      const ded = tail.match(/\[-(\d+)\]/);
      rows.push({
        pos: Number(m[1]), name: m[2].trim(),
        played: Number(m[3]), w: Number(m[4]), d: Number(m[5]), l: Number(m[6]),
        gf: Number(m[7]), ga: Number(m[8]), points: Number(m[9]),
        deduction: ded ? Number(ded[1]) : 0,
        flags: (tail.match(/\[[A-Z!*0-9]+\]/g) || []).map((f) => f.slice(1, -1)),
        remark: tail.replace(/\[[^\]]*\]/g, '').trim() || null,
      });
      continue;
    }
    if (rows.length && /^\s*$/.test(l) && !(lines[i + 1] || '').match(TABLE_RE) && !(lines[i + 1] || '').match(/^\s*[-\s]+$/)) break;
    if (rows.length && /^\s*Round\s+\d/.test(l)) break;
  }
  return { rows, end: i };
}

/** Leest een blok wedstrijden (rondes of knock-out) vanaf `from` tot de volgende sectie. */
function parseMatches(lines, seasonStart, stage) {
  const out = [];
  let date = null; let round = null; let label = null;
  let pending = null; // gestaakt/uitgesteld duel, wacht op het vervolg
  let openNote = null; // notitie zonder ']' die op de volgende regel doorloopt
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    const r = l.match(ROUND_RE);
    if (r) {
      round = Number(r[1]); label = `Round ${round}`;
      if (r[2]) date = isoDate(seasonStart, r[2], r[3]);
      continue;
    }
    const d = l.match(DATE_RE);
    if (d) { date = isoDate(seasonStart, d[1], d[2]); continue; }
    const head = l.match(/^(Semifinals|Quarterfinals|Final|First Legs?|Second Legs?|Third Place|Replay|Qualifying Round \d+|Round of 16)\b\s*(?:\[([A-Z][a-z]{2})\s+(\d{1,2})[^\]]*\])?/);
    if (head) {
      if (!/Legs?$/.test(head[1])) label = head[1];
      else label = `${(label || '').replace(/ · .*$/, '')} · ${head[1]}`;
      if (head[2]) date = isoDate(seasonStart, head[2], head[3]);
      continue;
    }
    if (TABLE_RE.test(raw)) continue; // standregel (bijv. "Halfway Table:" tussen de rondes), geen uitslag
    const m = l.match(MATCH_RE);
    if (!m) continue;
    if (m[1]) {
      // Een notitie die doorloopt van de regel erboven ("[annulled; Jong AZ fielded suspended" / "... Excelsior   player]")
      // staat achter de uitslag zonder '[': die hoort niet bij de clubnaam.
      const [away, ...rest] = m[4].trim().split(/\s{2,}/);
      const n = parseNote(m[5]);
      if (rest.length && openNote) { openNote.note = `${openNote.note} ${rest.join(' ').replace(/\]$/, '')}`; openNote = null; }
      // Geannuleerd (bijv. ongerechtigde speler, opnieuw gespeeld): telt niet.
      const annulled = /annul/i.test(n.note || '');
      out.push({ stage, round, label, date, home: m[1].trim(), away, hs: Number(m[2]), as: Number(m[3]), ...n, status: annulled ? 'annulled' : 'played' });
      openNote = n.note && !/\]\s*$/.test(m[0]) ? out[out.length - 1] : null;
    } else {
      const n = parseNote(m[9]);
      out.push({ stage, round, label, date, home: m[6].trim(), away: m[8].trim(), hs: null, as: null, ...n, status: m[7] });
      pending = out[out.length - 1];
    }
  }
  return out;
}

// ---------- Clubnamen: "Go Ahead" ↔ "Go Ahead Eagles (Deventer)" ----------

const STOP = new Set(['fc', 'sc', 'sv', 'bv', 'afc']);
export const tokens = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9'' -]/g, ' ').replace(/[-]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));

/** Koppelt korte namen uit de uitslagen aan de volledige namen uit de eindstand. */
export function resolver(fullNames) {
  const full = fullNames.map((n) => ({ name: n, t: tokens(n) }));
  const cache = new Map();
  return (short) => {
    if (cache.has(short)) return cache.get(short);
    const st = tokens(short);
    const fits = full.filter((f) => st.length && st.every((t) => f.t.includes(t) || f.t.some((x) => x.startsWith(t) && t.length >= 3)));
    fits.sort((a, b) => (a.t.length - st.length) - (b.t.length - st.length));
    const pick = fits.length && (fits.length === 1 || fits[0].t.length !== fits[1].t.length) ? fits[0].name : null;
    cache.set(short, pick);
    return pick;
  };
}

/** Rekent de stand na uit de gelezen uitslagen en vergelijkt met de eindstand van RSSSF. */
export function verify(division) {
  const table = division.table;
  if (!table.length) return { ok: false, problems: ['Geen eindstand gevonden'] };
  const resolve = resolver(table.map((r) => r.name));
  const calc = new Map(table.map((r) => [r.name, { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }]));
  const unknown = new Set();
  division.matches.filter((m) => m.stage === 'regular' && m.status === 'played').forEach((m) => {
    const h = resolve(m.home); const a = resolve(m.away);
    if (!h) unknown.add(m.home);
    if (!a) unknown.add(m.away);
    if (!h || !a) return;
    m.homeFull = h; m.awayFull = a;
    const H = calc.get(h); const A = calc.get(a);
    H.played++; A.played++;
    H.gf += m.hs; H.ga += m.as; A.gf += m.as; A.ga += m.hs;
    if (m.hs > m.as) { H.w++; A.l++; } else if (m.hs < m.as) { A.w++; H.l++; } else { H.d++; A.d++; }
  });
  const problems = [];
  unknown.forEach((n) => problems.push(`Onbekende club in uitslagen: "${n}"`));
  table.forEach((r) => {
    const c = calc.get(r.name);
    const keys = ['played', 'w', 'd', 'l', 'gf', 'ga'];
    const off = keys.filter((k) => c[k] !== r[k]);
    if (off.length) problems.push(`${r.name}: ${off.map((k) => `${k} ${c[k]} i.p.v. ${r[k]}`).join(', ')}`);
    const pts = c.w * 3 + c.d - r.deduction;
    if (!off.length && pts !== r.points) problems.push(`${r.name}: ${pts} punten i.p.v. ${r.points}`);
  });
  return { ok: !problems.length, problems, matches: division.matches.filter((m) => m.stage === 'regular' && m.status === 'played').length };
}

/** Hele pagina → { season, divisions: [{ name, table, matches, notes }], cup: { matches } }. */
export function parseRsssf(input, seasonStart) {
  const lines = toLines(input);
  const result = { season: seasonStart, divisions: [], cup: null };
  sections(lines).forEach((sec) => {
    if (sec.name === 'KNVB Beker') {
      result.cup = { name: sec.name, matches: parseMatches(sec.lines, seasonStart, 'cup') };
      return;
    }
    const L = sec.lines;
    const ti = L.findIndex((l) => TABLE_LABEL.test(l));
    const { rows } = ti >= 0 ? parseTable(L, ti + 1) : { rows: [] };
    const nacStart = L.findIndex((l, i) => i > ti && /^\s*Nacompetitie\s*$/.test(l) && !/\|/.test(l));
    const firstRound = L.findIndex((l) => ROUND_RE.test(l.trim()));
    // Reguliere rondes: van de eerste 'Round' tot de tweede 'Final Table' of de playoffs.
    let regEnd = L.length;
    const secondTable = L.findIndex((l, i) => i > firstRound && TABLE_LABEL.test(l));
    if (secondTable > 0) regEnd = secondTable;
    else if (nacStart > 0) regEnd = nacStart;
    const regular = firstRound >= 0 ? parseMatches(L.slice(firstRound, regEnd), seasonStart, 'regular') : [];
    const playoffLines = nacStart > 0 ? L.slice(nacStart + 1) : [];
    const cl = L.findIndex((l, i) => i > regEnd && /^\s*Conference League Playoff\s*$/.test(l));
    const europe = cl > 0 ? parseMatches(L.slice(cl + 1, nacStart > cl ? nacStart : L.length), seasonStart, 'europe-playoff') : [];
    const nac = parseMatches(playoffLines, seasonStart, 'nacompetitie');
    const notes = L.map((l) => l.trim()).filter((l) => /^NB:|^\[(\*\d|!)\]/.test(l));
    if (!KEEP.includes(sec.name) || (!rows.length && !regular.length)) return;
    result.divisions.push({ name: sec.name, table: rows, matches: [...regular, ...europe, ...nac], notes });
  });
  return result;
}
