import fs from 'node:fs';
const lines = fs.readFileSync('history-bodies.js', 'utf8').split('\n');

// pull the misplaced fmtHistField block back out
const start = lines.findIndex(l => l.startsWith('export function fmtHistField'));
if (start < 0) { console.error('fmtHistField not found'); process.exit(1); }
const block = lines.splice(start, 5); // export function + 3 body lines + }
// drop the blank line the bad insert left after it
if (lines[start] === '') lines.splice(start, 1);
// re-insert right after the import (line 1)
lines.splice(1, 0, block.join('\n'), '');
fs.writeFileSync('history-bodies.js', lines.join('\n'));
console.log('fmtHistField placed at top of history-bodies.js');
