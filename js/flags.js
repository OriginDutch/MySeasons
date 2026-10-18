// Landenvlaggen bij nationaliteiten. SVG's van flag-icons (MIT, Panayiotis Lipiridis), lokaal in /flags.
// Je export noemt nationaliteiten als bijvoeglijk naamwoord ("Nederlands", "Frans"); die vertalen we naar een landcode.

const N = {
  nederlands: 'nl', belgisch: 'be', duits: 'de', frans: 'fr', engels: 'gb-eng', schots: 'gb-sct', welsh: 'gb-wls', noordiers: 'gb-nir', 'noord-iers': 'gb-nir',
  brits: 'gb', iers: 'ie', spaans: 'es', portugees: 'pt', italiaans: 'it', oostenrijks: 'at', zwitsers: 'ch', deens: 'dk', noors: 'no', zweeds: 'se',
  fins: 'fi', ijslands: 'is', pools: 'pl', tsjechisch: 'cz', slowaaks: 'sk', hongaars: 'hu', roemeens: 'ro', bulgaars: 'bg', grieks: 'gr', turks: 'tr',
  kroatisch: 'hr', servisch: 'rs', bosnisch: 'ba', sloveens: 'si', montenegrijns: 'me', macedonisch: 'mk', 'noord-macedonisch': 'mk', albanees: 'al', kosovaars: 'xk',
  oekraiens: 'ua', russisch: 'ru', wit_russisch: 'by', belarussisch: 'by', georgisch: 'ge', armeens: 'am', azerbeidzjaans: 'az', litouws: 'lt', lets: 'lv', estisch: 'ee',
  luxemburgs: 'lu', cypriotisch: 'cy', maltees: 'mt', israelisch: 'il', marokkaans: 'ma', algerijns: 'dz', tunesisch: 'tn', egyptisch: 'eg', libisch: 'ly',
  surinaams: 'sr', curacaos: 'cw', arubaans: 'aw', antilliaans: 'cw', kaapverdisch: 'cv', senegalees: 'sn', ghanees: 'gh', nigeriaans: 'ng', ivoriaans: 'ci',
  kameroens: 'cm', malinees: 'ml', guinees: 'gn', 'guinee-bissaus': 'gw', burkinees: 'bf', togolees: 'tg', beninees: 'bj', gambiaans: 'gm', 'sierra leoons': 'sl',
  liberiaans: 'lr', congolees: 'cd', angolees: 'ao', zambiaans: 'zm', zimbabwaans: 'zw', zuid_afrikaans: 'za', 'zuid-afrikaans': 'za', keniaans: 'ke', ethiopisch: 'et',
  gabonees: 'ga', 'equatoriaal-guinees': 'gq', mauritaans: 'mr', sudanees: 'sd', mozambikaans: 'mz', oegandees: 'ug', tanzaniaans: 'tz', rwandees: 'rw', burundees: 'bi',
  braziliaans: 'br', argentijns: 'ar', uruguayaans: 'uy', chileens: 'cl', colombiaans: 'co', peruaans: 'pe', ecuadoraans: 'ec', venezolaans: 've', paraguayaans: 'py',
  boliviaans: 'bo', mexicaans: 'mx', amerikaans: 'us', canadees: 'ca', jamaicaans: 'jm', haitiaans: 'ht', 'costa ricaans': 'cr', hondurees: 'hn', panamees: 'pa',
  'trinidadiaans': 'tt', japans: 'jp', 'zuid-koreaans': 'kr', koreaans: 'kr', chinees: 'cn', indonesisch: 'id', australisch: 'au', 'nieuw-zeelands': 'nz', iraans: 'ir',
  iraaks: 'iq', saoedisch: 'sa', 'saoedi-arabisch': 'sa', qatarees: 'qa', syrisch: 'sy', libanees: 'lb', jordaans: 'jo', afghaans: 'af', filipijns: 'ph', thais: 'th',
  vietnamees: 'vn', indiaas: 'in', pakistaans: 'pk', oezbeeks: 'uz', kazachs: 'kz', moldavisch: 'md', faeroers: 'fo', gibraltarees: 'gi', andorrees: 'ad',
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ij/g, 'ij').trim();

/** "Nederlands" → "nl"; ook landnamen en codes werken ("Nederland", "NL"). */
export function countryCode(nationality) {
  const n = norm(nationality);
  if (!n) return null;
  if (N[n]) return N[n];
  if (N[n.replace(/\s+/g, '_')]) return N[n.replace(/\s+/g, '_')];
  if (/^[a-z]{2}$/.test(n)) return n;
  const byCountry = { nederland: 'nl', belgie: 'be', duitsland: 'de', frankrijk: 'fr', engeland: 'gb-eng', marokko: 'ma', suriname: 'sr', curacao: 'cw', noorwegen: 'no', oostenrijk: 'at' };
  return byCountry[n] || null;
}

/** <img> van de vlag, of '' als het land onbekend is. */
export function flag(nationality, size = 16) {
  const c = countryCode(nationality);
  if (!c) return '';
  return `<img class="flag" src="flags/${c}.svg" width="${Math.round(size * 4 / 3)}" height="${size}" alt="" loading="lazy" onerror="this.remove()">`;
}

/** Splitst "Nederlands / Marokkaans" of "Nederlands, Marokkaans" in losse nationaliteiten. */
export const nationalities = (s) => String(s || '').split(/\s*[\/,;&+]\s*|\s+en\s+/i).map((x) => x.trim()).filter(Boolean);
