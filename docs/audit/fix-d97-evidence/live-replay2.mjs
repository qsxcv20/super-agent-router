import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SPLIT = new RegExp(CR + '?' + LF);
const GATE = path.resolve('plugin/scripts/loop-gate.mjs');

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
const f = findSessionFile(sessionId);
const out = { sessionId: sessionId, sessionFile: f };
if (f) {
  const rows = fs.readFileSync(f, 'utf8').split(SPLIT).filter((l) => l.trim());
  const recs = [];
  let realTurn = '';
  rows.forEach((l, i) => {
    let o;
    try { o = JSON.parse(l); } catch (e) { o = null; }
    if (o && o.turn_id) realTurn = String(o.turn_id);
    for (const c of innerCallsOfLine(l)) recs.push({ c: c, idx: i });
  });
  const key = (r) => r.c.name + '|' + JSON.stringify(r.c.input);
  // 找「每条记录各占一行」的相同段（行号严格递增）⇒ 截断点才精确。
  const runs = [];
  let s = 0;
  while (s < recs.length) {
    let e = s;
    while (e + 1 < recs.length && key(recs[e + 1]) === key(recs[s])) e += 1;
    const len = e - s + 1;
    let distinct = true;
    for (let i = s + 1; i <= e; i++) if (recs[i].idx === recs[i - 1].idx) distinct = false;
    runs.push({ start: s, len: len, distinct: distinct, sample: key(recs[s]).slice(0, 140) });
    s = e + 1;
  }
  out.innerTotal = recs.length;
  out.runs = runs.filter((x) => x.len >= 4);
  const pick = runs.find((x) => x.len >= 5 && x.distinct);
  out.pickedRun = pick ? { len: pick.len, sample: pick.sample } : null;
  if (pick) {
    const fifth = recs[pick.start + 4];
    const sixth = recs[pick.start + 5];
    const cut5 = rows.slice(0, sixth.idx);
    const tmp5 = path.join('docs', 'audit', '.tmp-d97', 'replay-cut5.jsonl');
    fs.writeFileSync(tmp5, cut5.join(LF) + LF, 'utf8');
    const pay = {
      hook_event_name: 'PreToolUse', tool_name: fifth.c.name, tool_input: fifth.c.input,
      session_id: sessionId, agent_type: 'worker', transcript_path: path.resolve(tmp5),
      turn_id: realTurn, tool_use_id: 'tu-replay'
    };
    const r5 = runGate(pay);
    out.cut5 = { payload: fifth.c, recordsInCut: 5, out: r5.out, err: r5.err, code: r5.code };
    const cut4 = rows.slice(0, fifth.idx);
    const tmp4 = path.join('docs', 'audit', '.tmp-d97', 'replay-cut4.jsonl');
    fs.writeFileSync(tmp4, cut4.join(LF) + LF, 'utf8');
    pay.transcript_path = path.resolve(tmp4);
    const r4 = runGate(pay);
    out.cut4 = { out: r4.out, err: r4.err, code: r4.code };
  }
}
process.stdout.write(JSON.stringify(out, null, 2) + LF);