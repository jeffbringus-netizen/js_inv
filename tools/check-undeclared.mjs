// Static undeclared-identifier check (v2). Strips comments/strings, collects
// declarations + params + imports, then flags bare identifiers that could be
// runtime ReferenceErrors after the split.
import fs from 'node:fs';

const files = fs.readdirSync('.').filter(f => f.endsWith('.js'));

// declarations visible anywhere in a module: top-level, nested, and params
function collectDeclared(body) {
  const names = new Set();
  for (const m of body.matchAll(/(?:const|let|var|function|async function)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of body.matchAll(/\((?:[^()]|\([^()]*\))*\)\s*=>/g)) {
    for (const p of m[0].replace(/[()=>]/g, ' ').split(/[\s,]+/)) {
      if (/^[A-Za-z_$][\w$]*$/.test(p)) names.add(p);
    }
  }
  for (const m of body.matchAll(/function\s+[\w$]*\s*\(([^)]*)\)/g)) {
    m[1].split(',').forEach(a => { const n = a.trim().replace(/=.*/, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); });
  }
  for (const m of body.matchAll(/import\s+\{([^}]+)\}/g)) m[1].split(',').forEach(n => names.add(n.trim()));
  for (const m of body.matchAll(/(?:const|let)\s+\{([^}]+)\}\s*=/g)) {
    m[1].split(',').forEach(a => { const n = a.trim().replace(/=.*/, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); });
  }
  return names;
}

function stripNoise(body) {
  return body
    .replace(/`(?:\\.|[^`\\])*`/g, '""')            // template literals (keeps ${} stripped too — fine, inner code is balanced-ish)
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")          // single-quoted strings
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')          // double-quoted strings
    .replace(/\/\/[^\n]*/g, '');                    // line comments
}

// universe: every top-level declaration in the codebase
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(f, "utf8")]));
const universe = new Set();
for (const f of files) {
  for (const m of src[f].matchAll(/^(?:export )?(?:async function|function|const|let) ([A-Za-z_$][\w$]*)/gm)) universe.add(m[1]);
}


const GLOBALS = new Set(('document,window,localStorage,bootstrap,fetch,URL,URLSearchParams,navigator,console,Intl,JSON,Math,Number,String,Array,Object,Set,Map,Promise,Date,RegExp,Error,isNaN,parseInt,parseFloat,encodeURIComponent,decodeURIComponent,setTimeout,clearTimeout,setInterval,prompt,FormData,Blob,FileReader,CustomEvent,MouseEvent,location,history,alert,undefined,true,false,null,this,bootstrap'.split(',')));

let failures = 0;
for (const f of files) {
  const declared = collectDeclared(src[f]); // from ORIGINAL body (imports included)
  const clean = stripNoise(src[f]);
  for (const name of universe) {
    if (declared.has(name) || GLOBALS.has(name)) continue;
    if (new RegExp(`(?<![\\w.$'"\`])${name}\\b(?!\\s*:)`).test(clean)) {
      console.log(`UNDECLARED in ${f}: '${name}'`);
      failures++;
    }
  }
}
console.log(failures === 0 ? 'undeclared check: OK' : `undeclared check: ${failures} candidate(s)`);
