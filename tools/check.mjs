// Releasecontrole: draait in GitHub vóór elke deploy. Faalt er iets, dan wordt er niet gedeployd
// en blijft de vorige (werkende) versie online.
//
//  1. Elk JS-bestand moet parsen zoals een browser het leest (ES-module, strikt).
//  2. Elke lokale import moet bestaan, en elke geïmporteerde naam moet echt geëxporteerd worden.
//  3. Elk JS-bestand dat de app laadt, moet in de SHELL-lijst van sw.js staan (anders werkt offline niet).
//  4. APP_VERSION in js/version.js en CACHE_VERSION in sw.js moeten gelijk zijn.
//
// Lokaal: npm i --no-save acorn@8 && node tools/check.mjs

import { parse } from 'acorn';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => relative(root, p).replace(/\\/g, '/');

const files = [
  ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'js', f)),
  ...readdirSync(join(root, 'worker')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'worker', f)),
];

// 1. Parsen
const ast = new Map();
for (const f of files) {
  try {
    ast.set(f, parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true }));
  } catch (e) {
    fail(`${rel(f)}: syntaxfout: ${e.message}`);
  }
}
try {
  parse(readFileSync(join(root, 'sw.js'), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
} catch (e) {
  fail(`sw.js: syntaxfout: ${e.message}`);
}

// Exports per bestand
function exportsOf(tree) {
  const names = new Set();
  for (const n of tree.body) {
    if (n.type === 'ExportNamedDeclaration') {
      if (n.declaration) {
        const d = n.declaration;
        if (d.id) names.add(d.id.name);
        (d.declarations || []).forEach((v) => {
          if (v.id.type === 'Identifier') names.add(v.id.name);
          if (v.id.type === 'ObjectPattern') v.id.properties.forEach((p) => p.value && p.value.name && names.add(p.value.name));
        });
      }
      (n.specifiers || []).forEach((s) => names.add(s.exported.name || s.exported.value));
    }
    if (n.type === 'ExportDefaultDeclaration') names.add('default');
    if (n.type === 'ExportAllDeclaration') names.add('*');
  }
  return names;
}

// 2. Imports
const loaded = new Set();
function walk(file) {
  if (loaded.has(file) || !ast.has(file)) return;
  loaded.add(file);
  const tree = ast.get(file);
  for (const n of tree.body) {
    if (n.type !== 'ImportDeclaration' && !(n.type === 'ExportNamedDeclaration' && n.source) && n.type !== 'ExportAllDeclaration') continue;
    const src = n.source.value;
    if (!src.startsWith('.')) continue; // CDN (firebase) en dergelijke
    const target = normalize(join(dirname(file), src));
    if (!existsSync(target)) { fail(`${rel(file)}:${n.loc.start.line}: import "${src}" bestaat niet`); continue; }
    const ex = ast.get(target) ? exportsOf(ast.get(target)) : null;
    if (ex && !ex.has('*')) {
      (n.specifiers || []).forEach((s) => {
        const name = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? null : (s.imported || s.local).name;
        if (name && !ex.has(name)) fail(`${rel(file)}:${n.loc.start.line}: "${name}" wordt niet geëxporteerd door ${rel(target)}`);
      });
    }
    walk(target);
  }
  // dynamische imports: import('./x.js')
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const target = normalize(join(dirname(file), m[1]));
    if (!existsSync(target)) fail(`${rel(file)}: dynamische import "${m[1]}" bestaat niet`);
    else walk(target);
  }
}
walk(join(root, 'js', 'main.js'));
walk(join(root, 'worker', 'myseasons-api.js'));

// 3. Service worker-lijst
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const shell = new Set([...sw.matchAll(/'(js\/[^']+\.js)'/g)].map((m) => m[1]));
[...loaded].filter((f) => rel(f).startsWith('js/')).forEach((f) => {
  if (!shell.has(rel(f))) fail(`sw.js: ${rel(f)} ontbreekt in SHELL (werkt dan niet offline)`);
});
shell.forEach((p) => { if (!existsSync(join(root, p))) fail(`sw.js: SHELL noemt ${p}, maar dat bestand bestaat niet`); });

// 4. Versies
const app = (readFileSync(join(root, 'js', 'version.js'), 'utf8').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
const cache = (sw.match(/CACHE_VERSION\s*=\s*'ms-shell-v([^']+)'/) || [])[1];
if (!app || !cache || app !== cache) fail(`versies verschillen: APP_VERSION ${app} vs CACHE_VERSION ${cache}`);

if (errors.length) {
  console.error(`✗ ${errors.length} ${errors.length === 1 ? 'probleem' : 'problemen'}:`);
  errors.forEach((e) => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ ${files.length + 1} bestanden gelezen, ${loaded.size} modules gekoppeld, versie ${app}. Alles in orde.`);
