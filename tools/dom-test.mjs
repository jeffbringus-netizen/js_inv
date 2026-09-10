// Loads the real ES modules under a minimal fake DOM, then simulates a user
// click on the webstock upload zone and checks the file input's click() ran.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const srcDir = path.resolve('../public/js');
const tmp = path.resolve('.modules-test');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
for (const f of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, f), path.join(tmp, f.replace(/\.js$/, '.mjs')));
  // rewrite relative import specifiers to the temp .mjs names
  const p = path.join(tmp, f.replace(/\.js$/, '.mjs'));
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    .replace(/from '\.\/([\w-]+)\.js'/g, "from './$1.mjs'")
    .replace(/import '\.\/([\w-]+)\.js'/g, "import './$1.mjs'"));
}

// ---- minimal fake DOM ----
function makeElement(selector) {
  const listeners = {};
  const el = {
    selector,
    listeners,
    clicks: 0,
    textContent: '',
    innerHTML: '',
    value: '',
    hidden: false,
    disabled: false,
    files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {},
    dataset: {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    click() { el.clicks++; },
    closest: () => null,
    scrollIntoView() {},
    appendChild() {},
    remove() {},
    querySelector: () => makeElement(selector + ' *'),
    querySelectorAll: () => []
  };
  // any other property access (form.price, form.is_online.checked, ...) yields
  // another absorbent element so chained calls never crash
  return new Proxy(el, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      t[p] = makeElement(selector + ' > ' + String(p));
      return t[p];
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

const elements = new Map();
const getElement = sel => {
  if (!elements.has(sel)) elements.set(sel, makeElement(sel));
  return elements.get(sel);
};

const documentStub = {
  querySelector: getElement,
  querySelectorAll: () => [],
  getElementById: getElement,
  createElement: sel => makeElement('<created>'),
  addEventListener() {},
  body: makeElement('body')
};

const windowStub = { addEventListener() {}, innerWidth: 1400, location: { hash: '' } };
const localStorageStub = { getItem: () => null, setItem() {} };
const bootstrapStub = { Modal: function () { this.show = () => {}; this.hide = () => {}; }, Tooltip: function () {} };

globalThis.document = documentStub;
globalThis.window = windowStub;
globalThis.localStorage = localStorageStub;
globalThis.bootstrap = bootstrapStub;
// app.js boot calls loadProducts(); keep it happy with a stubbed response
globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [], total: 0 }) });

// ---- import ONLY the real entry point: the browser loads exactly what is
// reachable from app.js, so this test exercises the true module graph ----
const imod = name => import(pathToFileURL(path.join(tmp, name)));
await imod('app.mjs');

// ---- simulate the user click on the upload zone ----
const zone = getElement('#webstockUploadZone');
const input = getElement('#webstockCsvInput');
const handler = (zone.listeners.click || [])[0];
if (!handler) { console.log('FAIL: no click listener on #webstockUploadZone (module not reachable from app.js)'); process.exit(1); }
handler({ target: makeElement('zone-child') });
console.log('zone click handler ran. input.click() calls:', input.clicks);
console.log(input.clicks > 0 ? 'WIRING OK: the module calls the input\'s click()' : 'WIRING BROKEN: input click never invoked');

// copy button listener must exist too (same module)
const copyBtn = getElement('#copyWebstockSqlBtn');
console.log(copyBtn.listeners.click ? 'copy button listener: attached' : 'FAIL: copy button has no listener');
const exportCopyBtn = getElement('#copyWebstockExportSqlBtn');
console.log(exportCopyBtn.listeners.click ? 'export-SQL copy listener: attached' : 'FAIL: export-SQL copy has no listener');
const labelsBtn = getElement('#generateLabelsBtn');
console.log(labelsBtn.listeners.click ? 'labels generate listener: attached' : 'FAIL: labels button has no listener');
