// Verify short-name device matching in both parsers against the live DB,
// using throwaway devices (removed afterwards).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const db = require('../db');
const XLSX = require('xlsx');
const koff = require('../parsers/koff');
const tfo = require('../parsers/tfo');

// temp devices: full name + short name (clear leftovers if a previous run crashed)
db.prepare("DELETE FROM devices WHERE name IN ('Test Galaxy S22', 'Test Galaxy S23')").run();
const mk = db.prepare('INSERT INTO devices (name, year, short_name) VALUES (?, ?, ?)');
const s22 = mk.run('Test Galaxy S22', 2022, 'S22').lastInsertRowid;
const s23 = mk.run('Test Galaxy S23', 2023, 'S23').lastInsertRowid;

let failures = 0;
const check = (label, got, want) => {
  const names = got.map(d => d.name).sort();
  const ok = JSON.stringify(names) === JSON.stringify(want.sort());
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: [${names.join(', ')}]`);
  if (!ok) failures++;
};

// --- TFO: "for <devices>" compatibility text ---
const t1 = tfo.parseName('Tempered glass 2,5D Premium for Test Galaxy S22 / S23', db);
check('tfo full + short', t1.devices, ['Test Galaxy S22', 'Test Galaxy S23']);
const t2 = tfo.parseName('Silicone case for S22 / S23', db);
check('tfo shorts only', t2.devices, ['Test Galaxy S22', 'Test Galaxy S23']);
const t3 = tfo.parseName('Silicone case for S22 / Unknown Phone X', db);
check('tfo short + unknown (unknown stays compatible)', t3.devices, ['Test Galaxy S22']);
console.log(`      tfo compatible_devices: [${t3.compatible_devices.join(', ')}]`);
const t4 = tfo.parseName('Cable for Test Galaxy S22 / S22', db);
check('tfo dedupe same device twice', t4.devices, ['Test Galaxy S22']);

// --- KOFF: "brand - product - devices - color" name segments ---
function koffRow(name) {
  const ws = XLSX.utils.aoa_to_sheet([['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['', name, 'SKU1', '111', 1, '', '5']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  // koff.parse returns the row array directly (unlike tfo's { rows, shipping })
  return koff.parse(XLSX.write(wb, { type: 'base64' }), db)[0].parsed;
}
const k1 = koffRow('TestBrand - Tempered glass 2,5D Premium - Test Galaxy S22 / S23 - black');
check('koff full + short', k1.devices, ['Test Galaxy S22', 'Test Galaxy S23']);
const k2 = koffRow('TestBrand - Silicone case - S22 / S23 - black');
check('koff shorts only', k2.devices, ['Test Galaxy S22', 'Test Galaxy S23']);
const k3 = koffRow('TestBrand - Silicone case - Test Galaxy S22 / S22 - black');
check('koff dedupe same device twice', k3.devices, ['Test Galaxy S22']);

// cleanup
db.prepare('DELETE FROM product_devices WHERE device_id IN (?, ?)').run(s22, s23);
db.prepare('DELETE FROM devices WHERE id IN (?, ?)').run(s22, s23);
console.log('temp devices removed;', failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
process.exit(failures ? 1 : 0);
