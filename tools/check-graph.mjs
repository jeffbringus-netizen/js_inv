// Verify the module graph (v2): imports resolve to exports, known helpers
// used in a body are imported, no imports are dead.
import fs from 'node:fs';

const files = fs.readdirSync('.').filter(f => f.endsWith('.js'));
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(f, 'utf8')]));
const stripImports = body => body.replace(/^import[^;]+;$/gm, '');

function exportedNames(file) {
  const names = new Set();
  for (const m of src[file].matchAll(/^export (?:async function|function|const|let) ([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src[file].matchAll(/export \{([^}]+)\}/g)) m[1].split(',').forEach(n => names.add(n.trim()));
  return names;
}

let failures = 0;
for (const f of files) {
  const exported = exportedNames(f);
  for (const m of src[f].matchAll(/import \{([^}]+)\} from '\.\/(.+?)'/g)) {
    for (const name of m[1].split(',').map(n => n.trim())) {
      if (!exportedNames(m[2]).has(name)) {
        console.log(`RESOLUTION FAIL: ${f} imports '${name}' but ${m[2]} does not export it`);
        failures++;
      }
    }
  }
}

const KNOWN = ['esc','eur','eur4','$','toast','copyToClipboard','paginationHtml','showUnsavedChangesPrompt',
  'validateRequiredFields','listDiffCell','diffCell','STATUS_BADGE','getJSON','showApiError',
  'createAutocomplete','acWidgets','loadProducts','updateMassEditBtn','openMassEdit','openModal',
  'ENTITY_DEFS','openEntityTab','HIST_TYPE_BADGE','HIST_ENTITY_TYPES','HISTORY_FIELD_LABELS',
  'productHistoryBody','salesHistoryBody','entityHistoryBody','purchasesHistoryBody',
  'loadBackups','loadOrders','loadPurchases','loadHistory','selectView'];

for (const f of files) {
  const body = stripImports(src[f]);
  const imported = new Set([...src[f].matchAll(/import \{([^}]+)\}/g)].flatMap(m => m[1].split(',').map(n => n.trim())));
  const local = new Set([...body.matchAll(/^(?:export )?(?:async function|function|const|let) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  if (f === 'store.js' || f === 'app.js') continue;
  for (const name of KNOWN) {
    const used = new RegExp('\\b' + name + '\\b').test(body);
    if (used && !imported.has(name) && !local.has(name)) {
      console.log(`MISSING IMPORT: ${f} uses '${name}'`);
      failures++;
    }
    if (!used && imported.has(name)) {
      console.log(`DEAD IMPORT: ${f} imports '${name}' but never uses it`);
      failures++;
    }
  }
}
console.log(failures === 0 ? 'graph check: OK' : `graph check: ${failures} failures`);

// reachability: every module must be loadable from the app.js entry, otherwise
// its side-effect listeners never attach in the browser
const reachable = new Set(['app.js']);
let grew = true;
while (grew) {
  grew = false;
  for (const f of [...reachable]) {
    for (const m of src[f].matchAll(/from '\.\/([\w-]+\.js)'/g)) {
      if (!reachable.has(m[1])) { reachable.add(m[1]); grew = true; }
    }
    for (const m of src[f].matchAll(/import '\.\/([\w-]+\.js)'/g)) {
      if (!reachable.has(m[1])) { reachable.add(m[1]); grew = true; }
    }
  }
}
// config.js is loaded by its own <script> tag in index.html, not the module graph
const orphans = files.filter(f => !reachable.has(f) && f !== 'config.js');
if (orphans.length) {
  console.log('UNREACHABLE from app.js:', orphans.join(', '));
  process.exitCode = 1;
} else {
  console.log('reachability: OK (all modules reachable from app.js)');
}
