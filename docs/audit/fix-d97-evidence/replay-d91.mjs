import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SPLIT = new RegExp(CR + '?' + LF);
const GATE = path.resolve('plugin/scripts/loop-gate.mjs');
const FIX = path.join('tests', 'fixtures', 'd91-ptc-real-prefix.jsonl');

function innerCallsOfLine(line) {
  let o;
  try { o = JSON.parse(line); } catch (e) { return []; }
  const m = o && o.message;
  const cc = m && m.details && m.details.ptc && m.details.ptc.child_calls;
  if (!Array.isArray(cc)) return [];
  return cc.map((c) => ({ name: String(c.tool_name || ''), input: (c.input && typeof c.input === 'object') ? c.input : {} }));
}
const rows = fs.readFileSync(FIX, 'utf8').split(SPLIT).filter((l) => l.trim());
const recs = [];
let realTurn = '';
rows.forEach((l, i) => {
  let o;
  try { o = JSON.parse(l); } catch (e) { o = null; }
  if (o && o.turn_id) realTurn = String(o.turn_id);
  for (const c of innerCallsOfLine(l)) recs.push({ c: c, idx: i });
});
const key = (r) => r.c.name + '|' + JSON.stringify(r.c.input);
let best = { start: 0, len: 0 }, run = 0;
for (let i = 0; i < recs.length; i++) {
  if (i > 0 && key(recs[i]) === key(recs[i - 1])) run += 1; else run = 1;
  if (run > best.len) best = { start: i - run + 1, len: run };
}
const out = { fixture: FIX, innerTotal: recs.length, longestRun: best.len, sample: key(recs[best.start]).slice(0, 160) };
const sixth = recs[best.start + 5];
// 与既有断言同口径：截到**第 5 条相同记录所在行（含）** ⇒ 文件里正好 5 条相同记录
const cut = rows.slice(0, recs[best.start + 4].idx + 1);
out.recordsInCut = recs.filter((r) => r.idx <= recs[best.start + 4].idx && key(r) === key(recs[best.start])).length;
const tmp = path.join('docs', 'audit', '.tmp-d97', 'replay-d91-cut5.jsonl');
fs.writeFileSync(tmp, cut.join(LF) + LF, 'utf8');
const fifth = recs[best.start + 4];
const pay = {
  hook_event_name: 'PreToolUse', tool_name: fifth.c.name, tool_input: fifth.c.input,
  session_id: 'sess-d91-replay', agent_type: 'worker', transcript_path: path.resolve(tmp),
  turn_id: realTurn, tool_use_id: 'tu-d91'
};
const r = spawnSync('node', [GATE], { input: JSON.stringify(pay), encoding: 'utf8', timeout: 120000 });
out.cut5 = { out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim(), code: r.status };
const cut4 = rows.slice(0, fifth.idx);
const tmp4 = path.join('docs', 'audit', '.tmp-d97', 'replay-d91-cut4.jsonl');
fs.writeFileSync(tmp4, cut4.join(LF) + LF, 'utf8');
pay.transcript_path = path.resolve(tmp4);
const r4 = spawnSync('node', [GATE], { input: JSON.stringify(pay), encoding: 'utf8', timeout: 120000 });
out.cut4 = { out: String(r4.out || '').trim(), err: String(r4.stderr || '').trim(), code: r4.status };
process.stdout.write(JSON.stringify(out, null, 2) + LF);