import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SPLIT = new RegExp(CR + '?' + LF);
const GATE = path.resolve('plugin/scripts/loop-gate.mjs');
const gateMod = await import(pathToFileURL(GATE).href);

function sha32(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 32); }
function b64url(s) {
  let b = Buffer.from(String(s), 'utf8').toString('base64').split('+').join('-').split('/').join('_');
  while (b.length && b.charAt(b.length - 1) === '=') b = b.slice(0, -1);
  return b;
}
function findSessionFile(id) {
  const want = b64url(id);
  const root = path.join(os.homedir(), '.minimax', 'v2', 'sessions');
  const stack = [root];
  const suffix = '-session_' + want;
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (e.name.length >= suffix.length && e.name.slice(-suffix.length) === suffix) {
        const mj = path.join(p, 'messages.jsonl');
        if (fs.existsSync(mj)) return mj;
      }
      stack.push(p);
    }
  }
  return '';
}
function runGate(payload, env) {
  const e2 = Object.assign({}, process.env, env || {});
  const r = spawnSync('node', [GATE], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 120000, env: e2 });
  return { out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim(), code: r.status };
}
function innerCallsOfLine(line) {
  let o;
  try { o = JSON.parse(line); } catch (e) { return []; }
  const m = o && o.message;
  const cc = m && m.details && m.details.ptc && m.details.ptc.child_calls;
  if (!Array.isArray(cc)) return [];
  return cc.map((c) => ({ name: String(c.tool_name || ''), input: (c.input && typeof c.input === 'object') ? c.input : {} }));
}
const sessionId = process.argv[2];
const out = { sessionId: sessionId };

// ── (1) 截断回放：会话库 messages.jsonl（A-5）—— 用**真实 turn_id** ─────────────
{
  const f = findSessionFile(sessionId);
  out.sessionFile = f;
  if (f) {
    const lines = fs.readFileSync(f, 'utf8').split(SPLIT).filter((l) => l.trim());
    const recs = [];
    let realTurn = '';
    lines.forEach((l, i) => {
      let o;
      try { o = JSON.parse(l); } catch (e) { o = null; }
      if (o && o.turn_id) realTurn = String(o.turn_id);
      for (const c of innerCallsOfLine(l)) recs.push({ c: c, idx: i });
    });
    out.realTurnId = realTurn;
    const key = (r) => r.c.name + '|' + JSON.stringify(r.c.input);
    let best = { start: 0, len: 0 }, run = 0;
    for (let i = 0; i < recs.length; i++) {
      if (i > 0 && key(recs[i]) === key(recs[i - 1])) run += 1; else run = 1;
      if (run > best.len) best = { start: i - run + 1, len: run };
    }
    out.innerTotal = recs.length;
    out.longestIdenticalInnerRun = best.len;
    out.longestRunSample = best.len ? key(recs[best.start]).slice(0, 160) : '';
    if (best.len >= 5) {
      const fifth = recs[best.start + 4];
      // 按**记录数**截断：切在第 6 条相同记录所在行之前 ⇒ 文件里正好 5 条相同记录
      const sixth = recs[best.start + 5];
      const cut = lines.slice(0, sixth.idx);
      const tmp = path.join('docs', 'audit', '.tmp-d97', 'replay-cut5.jsonl');
      fs.writeFileSync(tmp, cut.join(LF) + LF, 'utf8');
      const pay = {
        hook_event_name: 'PreToolUse', tool_name: fifth.c.name, tool_input: fifth.c.input,
        session_id: sessionId, agent_type: 'worker', transcript_path: path.resolve(tmp),
        turn_id: realTurn, tool_use_id: 'tu-replay'
      };
      const r = runGate(pay);
      out.cut5 = { payload: fifth.c, out: r.out, err: r.err, code: r.code };
      const cut4 = lines.slice(0, fifth.idx);
      const tmp4 = path.join('docs', 'audit', '.tmp-d97', 'replay-cut4.jsonl');
      fs.writeFileSync(tmp4, cut4.join(LF) + LF, 'utf8');
      pay.transcript_path = path.resolve(tmp4);
      const r4 = runGate(pay);
      out.cut4 = { out: r4.out, err: r4.err, code: r4.code };
    }
  }
}

// ── (2) 活体投影回放（A-2/A-8）—— 真实运行时投影字节 ─────────────────────────
{
  const pf = path.join(os.tmpdir(), 'minimax-plugin-hooks', 'transcripts', sha32(sessionId) + '.compatible.jsonl');
  out.projectionFile = pf;
  if (fs.existsSync(pf)) {
    const lines = fs.readFileSync(pf, 'utf8').split(SPLIT).filter((l) => l.trim());
    let lastUseLine = '', lastUse = null;
    for (const l of lines) {
      let o;
      try { o = JSON.parse(l); } catch (e) { o = null; }
      const calls = gateMod.projectionCallsOf(o);
      if (calls.length) { lastUseLine = l; lastUse = calls[0]; }
    }
    out.projectionLastTool = lastUse ? lastUse.name : '';
    const tail = lastUse ? gateMod.innerTailOf(lastUse.code) : null;
    out.projectionLastInnerTail = tail ? tail.tool : '';
    if (tail) {
      const vals = gateMod.argValuesOf(tail.argsText, ['command']);
      const cmd = String(vals.values.command === undefined ? '' : vals.values.command);
      out.projectionLastInnerCommand = cmd.slice(0, 120);
      const dup = lines.concat([lastUseLine, lastUseLine, lastUseLine, lastUseLine, lastUseLine]);
      const tmp = path.join('docs', 'audit', '.tmp-d97', 'replay-projection-dup.jsonl');
      fs.writeFileSync(tmp, dup.join(LF) + LF, 'utf8');
      const pay = {
        hook_event_name: 'PreToolUse', tool_name: tail.tool, tool_input: { command: cmd },
        session_id: sessionId, agent_type: 'worker', transcript_path: path.resolve(tmp),
        turn_id: 'turn_task_bg_bg_11111111-2222-4333-8444-555555555555', tool_use_id: 'tu-proj'
      };
      const r = runGate(pay);
      out.projectionDup = { out: r.out, err: r.err, code: r.code };
      const tmp2 = path.join('docs', 'audit', '.tmp-d97', 'replay-projection-real.jsonl');
      fs.writeFileSync(tmp2, lines.join(LF) + LF, 'utf8');
      pay.transcript_path = path.resolve(tmp2);
      const r2 = runGate(pay, { SAR_LOOP_GATE_SESSION_ROOT: path.join('docs', 'audit', '.tmp-d97', 'no-session-store') });
      out.projectionReal = { out: r2.out, err: r2.err, code: r2.code };
      pay.tool_input = { command: 'echo d97-never-seen-command' };
      const r3 = runGate(pay, { SAR_LOOP_GATE_SESSION_ROOT: path.join('docs', 'audit', '.tmp-d97', 'no-session-store') });
      out.projectionMiss = { out: r3.out, err: r3.err, code: r3.code };
    }
  }
}

process.stdout.write(JSON.stringify(out, null, 2) + LF);