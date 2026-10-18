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
  vietnamees: 'vn', 'wit-russisch': 'by', 'haitiaans': 'ht', israelisch: 'il', oekraiens: 'ua', faeroers: 'fo', indiaas: 'in', pakistaans: 'pk', oezbeeks: 'uz', kazachs: 'kz', moldavisch: 'md', faeroers: 'fo', gibraltarees: 'gi', andorrees: 'ad',
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

/** Keuzelijst voor de dropdown: eerst de veelvoorkomende, daarna alles op alfabet. */
export const NAT_TOP = ['Nederlands', 'Belgisch', 'Duits', 'Frans', 'Marokkaans', 'Surinaams', 'Curaçaos', 'Kaapverdisch', 'Noors', 'Deens', 'Zweeds', 'Engels', 'Spaans', 'Portugees'];
export const NAT_ALL = [
  'Afghaans', 'Albanees', 'Algerijns', 'Amerikaans', 'Andorrees', 'Angolees', 'Argentijns', 'Armeens', 'Arubaans', 'Australisch', 'Azerbeidzjaans',
  'Belgisch', 'Beninees', 'Bosnisch', 'Boliviaans', 'Braziliaans', 'Brits', 'Bulgaars', 'Burkinees', 'Burundees', 'Canadees', 'Chileens', 'Chinees',
  'Colombiaans', 'Congolees', 'Costa Ricaans', 'Curaçaos', 'Cypriotisch', 'Deens', 'Duits', 'Ecuadoraans', 'Egyptisch', 'Engels', 'Equatoriaal-Guinees',
  'Estisch', 'Ethiopisch', 'Faeröers', 'Filipijns', 'Fins', 'Frans', 'Gabonees', 'Gambiaans', 'Georgisch', 'Ghanees', 'Gibraltarees', 'Grieks', 'Guinees',
  'Guinee-Bissaus', 'Haïtiaans', 'Hondurees', 'Hongaars', 'Iers', 'IJslands', 'Indiaas', 'Indonesisch', 'Iraaks', 'Iraans', 'Israëlisch', 'Italiaans',
  'Ivoriaans', 'Jamaicaans', 'Japans', 'Jordaans', 'Kaapverdisch', 'Kameroens', 'Kazachs', 'Keniaans', 'Kosovaars', 'Kroatisch', 'Lets', 'Libanees',
  'Liberiaans', 'Libisch', 'Litouws', 'Luxemburgs', 'Macedonisch', 'Malinees', 'Maltees', 'Marokkaans', 'Mauritaans', 'Mexicaans', 'Moldavisch',
  'Montenegrijns', 'Mozambikaans', 'Nederlands', 'Nieuw-Zeelands', 'Nigeriaans', 'Noord-Iers', 'Noors', 'Oegandees', 'Oekraïens', 'Oezbeeks',
  'Oostenrijks', 'Pakistaans', 'Panamees', 'Paraguayaans', 'Peruaans', 'Pools', 'Portugees', 'Qatarees', 'Roemeens', 'Russisch', 'Rwandees',
  'Saoedisch', 'Schots', 'Senegalees', 'Servisch', 'Sierra Leoons', 'Sloveens', 'Slowaaks', 'Spaans', 'Sudanees', 'Surinaams', 'Syrisch', 'Tanzaniaans',
  'Thais', 'Togolees', 'Trinidadiaans', 'Tsjechisch', 'Tunesisch', 'Turks', 'Uruguayaans', 'Venezolaans', 'Vietnamees', 'Welsh', 'Wit-Russisch',
  'Zambiaans', 'Zimbabwaans', 'Zuid-Afrikaans', 'Zuid-Koreaans', 'Zweeds', 'Zwitsers',
];
