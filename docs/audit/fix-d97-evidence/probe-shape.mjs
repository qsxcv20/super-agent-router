// 打印运行时兼容投影里三种真实行的**结构**（键序 + 字段类型），用于生成同构夹具。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function shape(v, depth) {
  const d = depth || 0;
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1)] : [];
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = d > 2 ? (Array.isArray(v[k]) ? '[array]' : typeof v[k]) : shape(v[k], d + 1);
    return o;
  }
  return typeof v;
}

const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const out = { file: path.basename(file), lines: lines.length };
const want = { tool_use: null, tool_result: null, text: null };
for (const l of lines) {
  let o;
  try { o = JSON.parse(l); } catch (e) { continue; }
  const m = o && o.message;
  if (!m || !Array.isArray(m.content)) continue;
  for (const it of m.content) {
    const t = it && it.type;
    if (!want[t] && t) {
      want[t] = {
        topLevelKeys: Object.keys(o),
        topLevelShape: shape(o),
        line: l.length
      };
    }
  }
}
out.samples = want;
process.stdout.write(JSON.stringify(out, null, 2));
