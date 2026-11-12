// 1) 验证兼容投影文件名 = sha256(sessionId).slice(0,32)；2) 查会话库里 child_calls 的状态分布与批次结构。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

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

const ids = process.argv.slice(2);
const out = { projectionNameCheck: [], sessionChildCalls: [] };
const tdir = path.join(os.tmpdir(), 'minimax-plugin-hooks', 'transcripts');
const projFiles = fs.existsSync(tdir) ? fs.readdirSync(tdir) : [];
for (const id of ids) {
  const h = crypto.createHash('sha256').update(String(id), 'utf8').digest('hex').slice(0, 32);
  const cands = projFiles.filter((f) => f.startsWith(h));
  out.projectionNameCheck.push({ sessionId: id, sha256_32: h, matchingProjectionFiles: cands });
  const f = locate(id);
  if (!f) { out.sessionChildCalls.push({ id, found: false }); continue; }
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const batches = [];
  for (let i = 0; i < lines.length; i++) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch (e) { continue; }
    const m = obj && obj.message;
    const cc = m && m.details && m.details.ptc && m.details.ptc.child_calls;
    if (!Array.isArray(cc) || cc.length === 0) continue;
    batches.push({
      line: i + 1,
      turn_id: obj.turn_id,
      n: cc.length,
      items: cc.map((c) => ({
        tool: String(c.tool_name || ''),
        status: String(c.status === undefined ? '(none)' : c.status),
        is_error: c.is_error === undefined ? null : c.is_error,
        keys: c.input && typeof c.input === 'object' ? Object.keys(c.input).sort() : []
      }))
    });
  }
  out.sessionChildCalls.push({ id, found: true, file: f, batches: batches.slice(-6) });
}
process.stdout.write(JSON.stringify(out, null, 2));
