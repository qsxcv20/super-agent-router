// 查「当前正在执行的外层调用」在会话库里的记录形态：child_calls 是否已预填、status 是什么。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function b64url(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function locate(id) {
  const want = b64url(id);
  const root = path.join(os.homedir(), '.minimax', 'v2', 'sessions');
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name.indexOf(want) >= 0) {
        const mj = path.join(p, 'messages.jsonl');
        if (fs.existsSync(mj)) return mj;
      }
      stack.push(p);
    }
  }
  return null;
}

const id = process.argv[2];
const f = locate(id);
if (!f) { process.stdout.write(JSON.stringify({ found: false })); process.exit(0); }
const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const rows = [];
for (let i = 0; i < lines.length; i++) {
  let o;
  try { o = JSON.parse(lines[i]); } catch (e) { continue; }
  const m = o && o.message;
  if (!m || !Array.isArray(m.content)) continue;
  const tc = m.content.find((x) => x && x.type === 'toolCall');
  if (!tc) continue;
  const cc = m.details && m.details.ptc && Array.isArray(m.details.ptc.child_calls) ? m.details.ptc.child_calls : null;
  rows.push({
    line: i + 1,
    turn_id: o.turn_id,
    outer: String(tc.name || ''),
    hasDetails: !!(m.details),
    childCount: cc ? cc.length : null,
    children: cc ? cc.map((c) => ({ tool: String(c.tool_name || ''), status: String(c.status), is_error: c.is_error === undefined ? null : c.is_error, keys: c.input && typeof c.input === 'object' ? Object.keys(c.input).sort() : [] })) : null
  });
}
process.stdout.write(JSON.stringify({ found: true, file: f, total: rows.length, last: rows.slice(-5) }, null, 2));
