// Evaluate a frontend module in Node with a permissive DOM stub.
// Any ReferenceError/TypeError at module evaluation indicates broken wiring.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const file = process.argv[2];
// imports are verified separately by check-graph.mjs — strip them for script eval
const code = fs.readFileSync(file, 'utf8').replace(/^import[^;\n]+;\n/gm, '');

const absorb = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === Symbol.toPrimitive || p === 'toString' || p === 'valueOf') return () => 'stub';
    if (p === 'then') return undefined; // not a thenable
    return absorb;
  },
  set: () => true,
  apply: () => absorb,
  construct: () => absorb
});

const elementStub = () => absorb;
const documentStub = {
  querySelector: elementStub,
  querySelectorAll: () => [],
  getElementById: elementStub,
  createElement: elementStub,
  addEventListener: () => {},
  body: absorb
};

const sandbox = {
  document: documentStub,
  window: new Proxy({ addEventListener: () => {}, location: absorb, innerWidth: 1200 }, { get: (t, p) => t[p] ?? absorb, set: () => true }),
  localStorage: { getItem: () => null, setItem: () => {} },
  bootstrap: { Modal: function () { this.show = () => {}; this.hide = () => {}; }, Tooltip: function () {} },
  fetch: async () => absorb,
  console,
  navigator: { clipboard: { writeText: async () => {} } },
  URL, URLSearchParams,
  FormData: globalThis.FormData || absorb,
  Blob: globalThis.Blob || absorb,
  FileReader: globalThis.FileReader || absorb,
  Intl, setTimeout, clearTimeout,
  alert: () => {}, prompt: () => null, location: { hash: '' }
};
sandbox.window.bootstrap = sandbox.bootstrap;
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
try {
  // wrap as ESM-ish: plain script evaluation is enough (imports were resolved by name already)
  vm.runInContext(code, context, { filename: file });
  console.log(`${file}: evaluated OK under stub`);
} catch (e) {
  console.log(`${file}: EVAL ERROR -> ${e.constructor.name}: ${e.message}`);
  process.exitCode = 1;
}
