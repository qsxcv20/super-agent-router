import fs from 'node:fs';
const F = 'docs/audit/.tmp-d97/block-projection.js';
const Q = String.fromCharCode(39);
const DQ = String.fromCharCode(34);
const B = String.fromCharCode(92);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SPLIT = new RegExp(CR + '?' + LF);
// 目标行（文件里的 JS 源码）：单引号字符串里，
//   正则转义 s 要写成双反斜杠；字符串里的单引号要写成单反斜杠 + 引号。
const parts = [
  '    const re = new RegExp(',
  Q, '(?:^|[{,', B, B, 's])[', B, Q, DQ, ']?', Q,
  ' + key + ', Q, '[', B, Q, DQ, ']?', B, B, 's*:', B, B, 's*', Q,
  ', ', Q, 'g', Q, ');'
];
const GOOD = parts.join('');
const lines = fs.readFileSync(F, 'utf8').split(SPLIT);
let hit = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('const re = new RegExp(') >= 0) { lines[i] = GOOD; hit += 1; }
}
fs.writeFileSync(F, lines.join(LF), 'utf8');
const now = lines.filter((l) => l.indexOf('const re = new RegExp(') >= 0)[0];
process.stdout.write('fixed=' + hit + ' now=' + JSON.stringify(now) + String.fromCharCode(10));