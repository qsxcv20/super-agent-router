import fs from 'node:fs';
const BLOCK = 'docs/audit/.tmp-d97/block-projection.js';
const TARGET = 'plugin/scripts/loop-gate.mjs';
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SPLIT = new RegExp(CR + '?' + LF);
const ANCHOR = '// 量「末尾连续相同调用」有多少次，并说明这个数**是否精确**。';
const orig = fs.readFileSync(TARGET, 'utf8');
const eol = orig.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const lines = orig.split(SPLIT);
const blockLines = fs.readFileSync(BLOCK, 'utf8').split(SPLIT);
while (blockLines.length && blockLines[blockLines.length - 1].trim() === '') blockLines.pop();
let at = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf(ANCHOR) === 0) { at = i; break; }
}
if (at < 0) { process.stderr.write('anchor not found' + LF); process.exit(2); }
const out = lines.slice(0, at).concat(blockLines, lines.slice(at));
fs.writeFileSync(TARGET, out.join(eol), 'utf8');
process.stdout.write('spliced at line ' + (at + 1) + ' eol=' + (eol === LF ? 'LF' : 'CRLF') + ' total=' + out.length + LF);