// 活体对照：兼容投影 vs 会话库 —— 各自的外层调用条数与最后一条内容，判断「当前正在执行的外层调用」是否已落盘。
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

const id = process.argv[2];
const h = crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32);
const proj = path.join(os.tmpdir(), 'minimax-plugin-hooks', 'transcripts', h + '.compatible.jsonl');
const out = { sessionId: id, projFile: proj, projMtime: null, projMtimeAgeMs: null };

if (fs.existsSync(proj)) {
  out.projMtime = fs.statSync(proj).mtime.toISOString();
  out.projMtimeAgeMs = Date.now() - fs.statSync(proj).mtimeMs;
  const lines = fs.readFileSync(proj, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const uses = [];
  for (const l of lines) {
    let o;
    try { o = JSON.parse(l); } catch (e) { continue; }
    const m = o && o.message;
    if (!m || !Array.isArray(m.content)) continue;
    for (const it of m.content) {
      if (it && it.type === 'tool_use') uses.push({ name: String(it.name || ''), code: String((it.input && it.input.code) || '').slice(0, 90) });
    }
  }
  out.projToolUse = uses.length;
  out.projLast = uses.slice(-3);
}

const sj = locate(id);
if (sj) {
  out.sessMtime = fs.statSync(sj).mtime.toISOString();
  out.sessMtimeAgeMs = Date.now() - fs.statSync(sj).mtimeMs;
  const lines = fs.readFileSync(sj, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const calls = [];
  for (const l of lines) {
    let o;
    try { o = JSON.parse(l); } catch (e) { continue; }
    const m = o && o.message;
    if (!m || !Array.isArray(m.content)) continue;
    for (const it of m.content) {
      if (it && it.type === 'toolCall') calls.push({ name: String(it.name || ''), code: String((it.arguments && it.arguments.code) || '').slice(0, 90) });
    }
  }
  out.sessToolCall = calls.length;
  out.sessLast = calls.slice(-3);
}
process.stdout.write(JSON.stringify(out, null, 2));
