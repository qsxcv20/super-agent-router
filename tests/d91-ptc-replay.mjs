// D-91 终局回放：用**真实 PTC transcript + 真实载荷**驱动**仓库版** loop-gate.mjs
//
// 落盘位置：tests/d91-ptc-replay.mjs（不是 *-test.mjs ⇒ 不会被回归壳自动发现，
// 它是需要人显式跑的回放工具；回归断言在 tests/loop-gate-test.mjs 里）。
//
// 跑法：
//   node tests\d91-ptc-replay.mjs
//   node tests\d91-ptc-replay.mjs <messages.jsonl 路径>
//
// 它做什么：
//   ① 从真实 PTC 会话里找出「逐字相同的内层调用」连跑；
//   ② 把 transcript 截断到第 4 次 / 第 5 次之后（真实字节前缀，临时文件放 TEMP）；
//   ③ 用**内层形态**载荷（tool_name='bash'、tool_input={command}）与
//      **外层形态**载荷（tool_name='run_code'、tool_input={code,description}）分别喂闸门；
//   ④ 打印裁决原文、时间戳与会话标识。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(REPO, 'plugin', 'scripts', 'loop-gate.mjs');
const DEFAULT_TRANSCRIPT = path.join(os.homedir(), '.minimax', 'v2', 'sessions', '2026', '11', '12',
  '00-04-02-355-session_bXZzX2JjM2RjY2E1ZGU5YjRmNzlhZGRkY2UyZDU0OTgyZjQw', 'messages.jsonl');
const TRANSCRIPT = process.argv[2] || DEFAULT_TRANSCRIPT;

console.log('REPLAY 开始时间=' + new Date().toISOString());
console.log('REPLAY 真实 transcript=' + TRANSCRIPT);
if (!fs.existsSync(TRANSCRIPT)) { console.log('REPLAY transcript 不存在，退出'); process.exit(2); }

const raw = fs.readFileSync(TRANSCRIPT, 'utf8');
const lines = raw.split(/\r?\n/);
if (lines[lines.length - 1] === '') lines.pop();

const inner = [], outer = [];
lines.forEach((l, i) => {
  let o = null; try { o = JSON.parse(l); } catch (e) { return; }
  const m = o.message || {};
  const turnId = String((o && (o.turn_id || o.turnId)) || '');
  const cc = m.details && m.details.ptc && Array.isArray(m.details.ptc.child_calls) ? m.details.ptc.child_calls : [];
  for (const c of cc) inner.push({ idx: i, name: String(c.tool_name || ''), input: c.input || {}, turnId });
  if (Array.isArray(m.content)) {
    for (const it of m.content) if (it && it.type === 'toolCall') outer.push({ idx: i, name: String(it.name || ''), args: it.arguments || {}, turnId });
  }
});
const innerFp = (c) => c.name + '|' + JSON.stringify(c.input);
const outerFp = (c) => c.name + '|' + JSON.stringify(c.args);
function longestRun(items, keyFn) {
  let run = 1, bestStart = 0, bestLen = items.length ? 1 : 0;
  for (let i = 1; i < items.length; i++) {
    if (keyFn(items[i]) === keyFn(items[i - 1])) run++; else run = 1;
    if (run > bestLen) { bestLen = run; bestStart = i - run + 1; }
  }
  return { start: bestStart, len: bestLen };
}
const ir = longestRun(inner, innerFp);
const orr = longestRun(outer, outerFp);
console.log('REPLAY 真实 transcript：行数=' + lines.length + ' 内层调用=' + inner.length +
  ' 最长逐字相同内层段=' + ir.len + ' 外层toolCall=' + outer.length + ' 最长逐字相同外层段=' + orr.len);

// 内层记录落盘的参数键（按工具）—— 决定哪些内层调用「可比」
const inputShapes = {};
for (const c of inner) {
  const k = c.name + ' {' + Object.keys(c.input || {}).join(',') + '}';
  inputShapes[k] = (inputShapes[k] || 0) + 1;
}
console.log('REPLAY 内层记录落盘的参数键=' + JSON.stringify(inputShapes));
// 每个工具各自的「最长逐字相同内层段」
const perTool = {};
for (const c of inner) {
  if (!perTool[c.name]) perTool[c.name] = [];
  perTool[c.name].push(c);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-d91-replay-'));
function cut(linesUpTo, name) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, lines.slice(0, linesUpTo + 1).join('\n') + '\n', 'utf8');
  return p;
}
function gate(payload) {
  const r = spawnSync(process.execPath, [GATE], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 120000 });
  return { out: String(r.stdout || '').trim(), err: String(r.stderr || ''), code: r.status };
}
function verdict(r) {
  if (r.out.includes('deny')) {
    let reason = '';
    try { reason = JSON.parse(r.out).hookSpecificOutput.permissionDecisionReason || ''; } catch (e) { reason = r.out; }
    return 'DENY :: ' + reason;
  }
  return 'ALLOW' + (r.err ? ' :: stderr=' + r.err.trim() : '');
}
const sess = path.basename(path.dirname(TRANSCRIPT));

// 内层形态：**逐个工具**回放（不同工具的落盘完整度不同 ⇒ 裁决不同，要把原因一起打出来）
for (const toolName of Object.keys(perTool)) {
  const items = perTool[toolName];
  const r0 = longestRun(items, innerFp);
  if (r0.len < 2) continue;
  const shape = toolName + ' {' + Object.keys(items[0].input || {}).join(',') + '}';
  console.log('REPLAY -- 内层工具 ' + toolName + '：最长逐字相同段=' + r0.len + '  落盘参数=' + shape + ' --');
  for (const nth of [4, 5]) {
    if (r0.len < nth) continue;
    const item = items[r0.start + nth - 1];
    const p = cut(item.idx, 'inner-' + toolName + '-cut' + nth + '.jsonl');
    const payload = {
      hook_event_name: 'PreToolUse', tool_name: item.name, tool_input: item.input,
      session_id: sess, agent_type: 'worker', transcript_path: p, turn_id: item.turnId, tool_use_id: 'replay'
    };
    const t0 = Date.now();
    const r = gate(payload);
    console.log('REPLAY   [截断到第' + nth + '次之后⇒当前是第 ' + (nth + 1) + ' 次] 时间戳=' + new Date().toISOString() +
      ' 耗时=' + (Date.now() - t0) + 'ms');
    console.log('REPLAY     裁决=' + verdict(r));
  }
}
// 外层形态：同一真实 transcript，截断到外层第 5 次之后
{
  const item = outer[orr.start + 4];
  const p = cut(item.idx, 'outer-cut5.jsonl');
  const payload = {
    hook_event_name: 'PreToolUse', tool_name: item.name, tool_input: item.args,
    session_id: sess, agent_type: 'worker', transcript_path: p, turn_id: item.turnId, tool_use_id: 'replay'
  };
  const t0 = Date.now();
  const r = gate(payload);
  console.log('REPLAY [外层形态·截断到外层第5次之后⇒当前是第 6 次] 时间戳=' + new Date().toISOString() +
    ' 耗时=' + (Date.now() - t0) + 'ms');
  console.log('REPLAY   裁决=' + verdict(r));
}
// 完整体（未截断）：当前这次调用在真实历史里不是重复 ⇒ 应当放行
{
  const item = inner[ir.start + 4];
  const payload = {
    hook_event_name: 'PreToolUse', tool_name: item.name, tool_input: item.input,
    session_id: sess, agent_type: 'worker', transcript_path: TRANSCRIPT, turn_id: item.turnId, tool_use_id: 'replay'
  };
  const t0 = Date.now();
  const r = gate(payload);
  console.log('REPLAY [完整体·同一载荷] 时间戳=' + new Date().toISOString() + ' 耗时=' + (Date.now() - t0) + 'ms');
  console.log('REPLAY   裁决=' + verdict(r));
}
console.log('REPLAY 结束时间=' + new Date().toISOString());
