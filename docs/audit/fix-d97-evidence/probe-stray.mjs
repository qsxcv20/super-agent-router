// 只读核查：工作区**旁边**是否留下了错位产物（生成器第一版 URL 编码未解码所致）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const PARENT = path.dirname(REPO);
const out = { repo: REPO, parent: PARENT, stray: [] };
for (const name of fs.readdirSync(PARENT)) {
  if (name.indexOf('%20') < 0) continue;
  const p = path.join(PARENT, name);
  const files = [];
  const walk = (d, depth) => {
    if (depth > 4) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q, depth + 1);
      else { const st = fs.statSync(q); files.push({ path: q, bytes: st.size }); }
    }
  };
  walk(p, 0);
  out.stray.push({ dir: p, files });
}
process.stdout.write(JSON.stringify(out, null, 2));
