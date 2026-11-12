// 定位会话 messages.jsonl：目录名 = <时间戳>-session_<base64url(sessionId)>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function b64url(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const ids = process.argv.slice(2);
const roots = [
  path.join(os.homedir(), '.minimax', 'v2', 'sessions'),
  path.join(os.homedir(), '.minimax', 'sessions')
];
const out = [];
for (const id of ids) {
  const want = b64url(id);
  for (const root of roots) {
    if (!fs.existsSync(root)) { out.push({ id, root, exists: false }); continue; }
    const stack = [root];
    let hits = 0;
    while (stack.length && hits < 5) {
      const d = stack.pop();
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name.indexOf(want) >= 0) { hits += 1; out.push({ id, want, dir: p, messages: path.join(p, 'messages.jsonl'), exists: fs.existsSync(path.join(p, 'messages.jsonl')) }); }
          stack.push(p);
        }
      }
    }
    if (hits === 0) out.push({ id, want, root, found: false });
  }
}
process.stdout.write(JSON.stringify(out, null, 2));
