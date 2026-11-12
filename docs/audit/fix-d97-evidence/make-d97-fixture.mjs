// D-97 活体夹具生成器。
//
// 取样来源：%TEMP%\minimax-plugin-hooks\transcripts\<sha256(sessionId).slice(0,32)>.compatible.jsonl
//   —— 宿主喂给 plugin PreToolUse hook 的**真正被读**的那份文件（Claude 兼容投影）。
//
// 做法：**结构逐字取自运行时文件**（顶层键序、message.content[] 元素形态、tool_result 形态都照抄真实行），
//   只对**正文内容**做脱敏与重复化（不搬整份带敏感内容的投影）。
// 产出：tests/fixtures/d97-hook-compatible.jsonl + 与运行时文件的形态对照报告。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

const sessionId = process.argv[2] || '';
const outFile = process.argv[3] || path.join(REPO, 'tests', 'fixtures', 'd97-hook-compatible.jsonl');

const hash = crypto.createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 32);
const runtimeFile = path.join(os.tmpdir(), 'minimax-plugin-hooks', 'transcripts', hash + '.compatible.jsonl');
if (!fs.existsSync(runtimeFile)) {
  process.stderr.write('运行时投影不存在：' + runtimeFile + '\n');
  process.exit(2);
}

const raw = fs.readFileSync(runtimeFile, 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());

// —— 从运行时文件里挑「结构捐赠者」：真实的 tool_use 行 / 真实的 tool_result 行 ——————
let donorUse = null, donorResult = null;
for (const l of lines) {
  let o;
  try { o = JSON.parse(l); } catch (e) { continue; }
  const m = o && o.message;
  if (!m || !Array.isArray(m.content)) continue;
  for (const it of m.content) {
    if (it && it.type === 'tool_use' && !donorUse) donorUse = o;
    if (it && it.type === 'tool_result' && !donorResult) donorResult = o;
  }
}
if (!donorUse || !donorResult) {
  process.stderr.write('运行时投影里没找到 tool_use / tool_result 行\n');
  process.exit(2);
}

// —— 脱敏后的固定内容（不含任何绝对路径 / 真实命令 / 会话标识）——————————————————
const FIX_SESSION = 'mvs_d97fixture0000000000000000000000';
const FIX_UUID = '00000000-0000-4000-8000-000000000000';
const FIX_TS = '2026-11-12T00:00:00.000Z';
const FIX_CMD = 'echo d97-loop-probe';
const FIX_CODE = 'const r = await tools.bash({ command: "' + FIX_CMD + '" });';
const FIX_DESC = 'D-97 活体夹具：重复的只读探测';

function mkUse(i) {
  const o = {};
  o.uuid = FIX_UUID.slice(0, 8) + '-0000-4000-8000-' + String(i).padStart(12, '0');
  o.parentUuid = FIX_UUID;
  o.sessionId = FIX_SESSION;
  o.timestamp = FIX_TS;
  o.type = 'assistant';
  o.message = {
    role: 'assistant',
    content: [{
      type: 'tool_use',
      id: 'call_d97_' + String(i).padStart(6, '0'),
      name: 'run_code',
      input: { code: FIX_CODE, description: FIX_DESC }
    }]
  };
  return o;
}
function mkResult(i) {
  const o = {};
  o.uuid = FIX_UUID.slice(0, 8) + '-0000-4000-8000-' + String(i).padStart(12, '0') + 'r';
  o.parentUuid = FIX_UUID;
  o.sessionId = FIX_SESSION;
  o.timestamp = FIX_TS;
  o.type = 'user';
  o.message = {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: 'call_d97_' + String(i).padStart(6, '0'),
      content: [{ type: 'text', text: 'd97-loop-probe' }],
      is_error: false
    }]
  };
  o.toolUseResult = [{ type: 'text', text: 'd97-loop-probe' }];
  return o;
}

// 夹具内容：6 次逐字相同的外层 run_code（内层都调同一条 bash）。
//   前 5 次 = 已完成（各有 tool_result 行）；第 6 次 = **当前正在执行**（结果还没落盘）。
//   —— 这与运行时形态一致：宿主先落外层 tool_use，再执行内层调用。
const out = [];
for (let i = 1; i <= 5; i++) {
  out.push(JSON.stringify(mkUse(i)));
  out.push(JSON.stringify(mkResult(i)));
}
out.push(JSON.stringify(mkUse(6)));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out.join('\n') + '\n', 'utf8');

// —— 形态对照报告（运行时文件 vs 夹具）——————————————————————————————
function profile(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const ls = txt.split(/\r?\n/).filter((l) => l.trim());
  const p = { file: path.basename(file), bytes: Buffer.byteLength(txt), lines: ls.length, textMentionChildCalls: 0, realChildCallArrays: 0, contentToolUse: 0, contentToolCall: 0, contentToolResult: 0, contentText: 0, topKeys: {} };
  for (const l of ls) {
    let o;
    try { o = JSON.parse(l); } catch (e) { continue; }
    if (l.indexOf('child_calls') >= 0) p.textMentionChildCalls += 1;
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) p.topKeys[k] = (p.topKeys[k] || 0) + 1;
    const m = o.message;
    if (!m || typeof m !== 'object') continue;
    const d = m.details;
    if (d && typeof d === 'object' && d.ptc && typeof d.ptc === 'object' && Array.isArray(d.ptc.child_calls)) p.realChildCallArrays += 1;
    if (!Array.isArray(m.content)) continue;
    for (const it of m.content) {
      if (!it || typeof it !== 'object') continue;
      if (it.type === 'tool_use') p.contentToolUse += 1;
      else if (it.type === 'toolCall') p.contentToolCall += 1;
      else if (it.type === 'tool_result') p.contentToolResult += 1;
      else if (it.type === 'text') p.contentText += 1;
    }
  }
  return p;
}

const report = {
  runtimeFile,
  sessionId,
  sha256_32: hash,
  fixtureFile: outFile,
  runtime: profile(runtimeFile),
  fixture: profile(outFile),
  donorTopKeysUse: Object.keys(donorUse),
  donorTopKeysResult: Object.keys(donorResult),
  donorUseItemKeys: Object.keys(donorUse.message.content.find((x) => x && x.type === 'tool_use')),
  donorResultItemKeys: Object.keys(donorResult.message.content.find((x) => x && x.type === 'tool_result')),
  fixtureTopKeysUse: Object.keys(mkUse(1)),
  fixtureTopKeysResult: Object.keys(mkResult(1)),
  fixtureUseItemKeys: Object.keys(mkUse(1).message.content[0]),
  fixtureResultItemKeys: Object.keys(mkResult(1).message.content[0])
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
