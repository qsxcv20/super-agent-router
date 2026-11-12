// D-86：无进展重复调用闸门（loop-gate）回归
//
// 覆盖：
//   阳性：连续相同调用达到阈值 ⇒ 本次被拦（deny 文案带规则编号 R-LOOP-SAME-CALL）
//   误伤控制 5 条：连跑 4 次不拦 / 中间插入别的调用不拦 / 同文件不同 offset·limit 不拦 /
//                   父会话永不拦 / transcript 缺失或损坏一律放行（fail-open）
//   指纹归一：命令空白折叠、read 路径大小写与斜杠、其余工具按稳定 JSON（键序无关）
//   性能：大 transcript 上单次 hook 调用的耗时量级
//
// 夹具用**真实子会话形状的 JSONL**：工具调用在 assistant 消息的 message.content[] 里，
// message.parts[] 里放 thinking —— 用来证明闸门不会把「思考」当成「调用」。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = path.resolve(process.env.SAR_PLUGIN_ROOT || path.join(REPO, 'plugin'));
const GATE = path.join(PLUGIN_ROOT, 'scripts', 'loop-gate.mjs');

// 动态 import（**必须**指向 GATE 而不是固定相对路径）：GATE 跟随 SAR_PLUGIN_ROOT，
// 变异自检会把插件副本放到别处 ⇒ 静态 import 会绕过副本，测到的是没被改坏的文件。
const gateMod = await import(pathToFileURL(GATE).href);
const { fingerprint, innerCallsOf, innerComparable, pickNamespace, callsFromLines, attributionKey, incomparableFp } = gateMod;

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-loopgate-'));
const SESSION = 'sess-loop-1';
// 真实行形状（本机实测 431 个 transcript）：顶层键只有 {message, message_id, turn_id}，
// **没有 sessionId** ⇒ 夹具必须按真实形状造，否则断言等于在给「按 sessionId 归属」这个
// 死过滤喂数据（上一版的夹具正是这样，F3 查出的注释与代码不一致就出在这里）。
// 任务轮的 turn_id 真实形态：turn_task_bg_bg_<uuid>（归属键 = 末尾 uuid 段）。
const TURN = 'turn_task_bg_bg_11111111-2222-4333-8444-555555555555';
const OTHER_TURN = 'turn_task_bg_bg_99999999-8888-4777-8666-555555555555';

let seq = 0;
// 第三个参数 turnId：默认本子会话的 turn_id；传 null 表示「行内没有 turn_id」；
// 传别的 turn_id 表示「这一行属于别的子会话」。
function toolCallLine(name, args, turnId) {
  seq += 1;
  const line = {
    message_id: 'm-' + seq,
    turn_id: turnId === undefined ? TURN : turnId,
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tc-' + seq, name: name, arguments: args }],
      // parts[] 装的是 thinking / image —— **不是工具调用**。
      parts: [{ type: 'thinking', thinking: 'thinking-' + seq }]
    }
  };
  if (turnId === null) delete line.turn_id;
  return JSON.stringify(line);
}

function userLine(text) {
  seq += 1;
  return JSON.stringify({
    message_id: 'm-' + seq,
    turn_id: TURN,
    message: { role: 'user', content: [{ type: 'text', text: text }] }
  });
}

// 工具结果行（真实形态：role=toolResult，内容是一大块文本）。
function toolResultLine(text) {
  seq += 1;
  return JSON.stringify({
    message_id: 'm-' + seq,
    turn_id: TURN,
    message: { role: 'toolResult', content: [{ type: 'text', text: text }] }
  });
}

function writeTranscript(name, lines) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  return p;
}

function gate(payloadObj, env) {
  const r = spawnSync('node', [GATE], {
    input: JSON.stringify(payloadObj), encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, env || {})
  });
  return { out: String(r.stdout || '').trim(), err: String(r.stderr || ''), code: r.status };
}

function payload(tool, toolInput, opts) {
  const o = opts || {};
  return {
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: toolInput,
    session_id: o.session_id === undefined ? SESSION : o.session_id,
    agent_type: o.agent_type === undefined ? 'worker' : o.agent_type,
    transcript_path: o.transcript_path === undefined ? '' : o.transcript_path,
    turn_id: o.turn_id === undefined ? TURN : o.turn_id,
    tool_use_id: 'tu-1'
  };
}

const BASH = { command: 'cat package.json' };
const READ = { path: 'src/app/login.ts' };

// ── 阳性：连续相同调用达到阈值 ⇒ 本次被拦 ──────────────────────────
{
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('same5.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 连续相同调用达到阈值后被拦（历史 5 次 ⇒ 本次第 6 次 deny）',
    r.out.includes('deny'), r.out.slice(0, 200) + ' | err=' + r.err.slice(0, 120));
  ok('D-86 deny 文案写明命中规则编号 R-LOOP-SAME-CALL',
    r.out.includes('R-LOOP-SAME-CALL'), r.out.slice(0, 200));
  let shape = null;
  try { shape = JSON.parse(r.out); } catch (e) { shape = null; }
  ok('D-86 deny 输出形状与 guard 一致（hookSpecificOutput.permissionDecision=deny）',
    !!shape && shape.hookSpecificOutput && shape.hookSpecificOutput.hookEventName === 'PreToolUse' &&
    shape.hookSpecificOutput.permissionDecision === 'deny' &&
    String(shape.hookSpecificOutput.permissionDecisionReason || '').length > 0,
    r.out.slice(0, 200));
  ok('D-86 deny 文案要求交付结论或说明卡点',
    r.out.includes('交付') && r.out.includes('卡'), r.out.slice(0, 240));
}

// ── 误伤控制 1：同一命令连跑 4 次 ⇒ 不拦 ─────────────────────────
{
  const lines = [];
  for (let i = 0; i < 4; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('same4.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 误伤控制：同一命令连跑 4 次不拦（边界值内侧）',
    r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 160) + ' code=' + r.code);
}

// ── 误伤控制 2：中间插了别的工具调用 ⇒ 连续计数断开 ⇒ 不拦 ──────────
{
  const lines = [];
  for (let i = 0; i < 4; i++) {
    lines.push(toolCallLine('bash', BASH));
    lines.push(toolCallLine('read', READ));   // 中间插了别的调用 ⇒ 计数断开
  }
  const p = writeTranscript('interleaved.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 误伤控制：中间插入别的工具调用后连续计数断开不拦',
    r.out === '', 'out=' + r.out.slice(0, 160));
}

// ── 误伤控制 3：读同一文件的不同 offset/limit ⇒ 指纹不同 ⇒ 不拦 ────
{
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push(toolCallLine('read', { path: READ.path, offset: i * 100, limit: 100 }));
  }
  const p = writeTranscript('read-offsets.jsonl', lines);
  const r = gate(payload('read', { path: READ.path, offset: 500, limit: 100 }, { transcript_path: p }));
  ok('D-86 误伤控制：读同一文件的不同 offset/limit 不拦（是新信息不是重复）',
    r.out === '', 'out=' + r.out.slice(0, 160));
}

// ── 误伤控制 4：父会话（无 agent_type）⇒ 永不拦 ────────────────────
{
  const lines = [];
  for (let i = 0; i < 8; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('parent.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p, agent_type: '' }));
  ok('D-86 误伤控制：父会话（无 agent_type）永不拦',
    r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 160) + ' code=' + r.code);
}

// ── 误伤控制 5：transcript 缺失 / 损坏 ⇒ 放行（fail-open）────────────
{
  const r = gate(payload('bash', BASH, { transcript_path: path.join(tmp, 'no-such-file.jsonl') }));
  ok('D-86 误伤控制：transcript 缺失时放行（fail-open）',
    r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 160));
  ok('D-86 transcript 读不到时 stderr 有留痕（静默放行 = 机制没跑）',
    r.err.includes('loop-gate'), 'err=' + r.err.slice(0, 160));
  const bad = writeTranscript('broken.jsonl', ['{ 这不是 JSON', 'garbage {{{', 'still not json']);
  const r2 = gate(payload('bash', BASH, { transcript_path: bad }));
  ok('D-86 误伤控制：transcript 损坏时放行（fail-open）',
    r2.out === '' && r2.code === 0, 'out=' + r2.out.slice(0, 160));
}

// ── 阈值可用环境变量覆盖 ─────────────────────────────────────────
{
  const lines = [];
  for (let i = 0; i < 2; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('n2.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }), { SAR_LOOP_GATE_MAX_SAME: '2' });
  ok('D-86 阈值可用环境变量覆盖（MAX_SAME=2 ⇒ 历史 2 次即拦）',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
  const r2 = gate(payload('bash', BASH, { transcript_path: p }), { SAR_LOOP_GATE_MAX_SAME: '9' });
  ok('D-86 阈值调大后同一夹具不再拦（阈值真的生效）',
    r2.out === '', 'out=' + r2.out.slice(0, 160));
}

// ── 指纹归一 ─────────────────────────────────────────────────────
{
  // 命令的空白/换行不同 ⇒ 仍是同一次调用。
  const variants = [
    { command: 'cat package.json' },
    { command: '  cat package.json  ' },
    { command: 'cat package.json\n' },
    { command: 'cat   package.json' },
    { command: 'cat package.json\r\n' }
  ];
  const lines = variants.map((v) => toolCallLine('bash', v));
  const p = writeTranscript('ws.jsonl', lines);
  const r = gate(payload('bash', { command: 'cat package.json' }, { transcript_path: p }));
  ok('D-86 指纹归一：命令的空白与换行不同算同一次调用',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // read 的路径：Windows 下大小写不敏感 + 斜杠归一。
  const lines = [
    toolCallLine('read', { path: 'src/App/Login.ts' }),
    toolCallLine('read', { path: 'src\\App\\Login.ts' }),
    toolCallLine('read', { path: 'src/App/Login.ts' }),
    toolCallLine('read', { path: 'src\\App\\Login.ts' }),
    toolCallLine('read', { path: 'src/App/Login.ts' })
  ];
  const p = writeTranscript('readcase.jsonl', lines);
  const r = gate(payload('read', { path: 'src/App/Login.ts' }, { transcript_path: p }));
  ok('D-86 指纹归一：read 的路径大小写与斜杠归一算同一次调用',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // 其余工具：稳定 JSON（键序无关）。
  const lines = [
    toolCallLine('write', { file_path: 'a.ts', content: 'x' }),
    toolCallLine('write', { content: 'x', file_path: 'a.ts' }),
    toolCallLine('write', { file_path: 'a.ts', content: 'x' }),
    toolCallLine('write', { content: 'x', file_path: 'a.ts' }),
    toolCallLine('write', { file_path: 'a.ts', content: 'x' })
  ];
  const p = writeTranscript('stablejson.jsonl', lines);
  const r = gate(payload('write', { content: 'x', file_path: 'a.ts' }, { transcript_path: p }));
  ok('D-86 其余工具按稳定 JSON 取指纹（键序不同算同一次调用）',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // parts[] 里的 thinking 不算工具调用：否则连续计数被插断 ⇒ 闸门永远不触发。
  const p = writeTranscript('parts.jsonl', [
    toolCallLine('bash', BASH), toolCallLine('bash', BASH), toolCallLine('bash', BASH),
    toolCallLine('bash', BASH), toolCallLine('bash', BASH)
  ]);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 message.parts[] 里的 thinking 不被当成工具调用（否则计数被插断）',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // run_code 的命令正文在载荷里叫 code —— 认错键会让指纹恒空 ⇒ 正常形态被整片误伤。
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('run_code', { code: 'const r = 1 + 2; return r;' }));
  const p = writeTranscript('runcode.jsonl', lines);
  const r = gate(payload('run_code', { code: 'const r = 1 + 2; return r;' }, { transcript_path: p }));
  ok('D-86 run_code 的命令正文取 code 字段（不是 command）',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
  const lines2 = [];
  for (let i = 0; i < 5; i++) lines2.push(toolCallLine('run_code', { code: 'step-' + i }));
  const p2 = writeTranscript('runcode-diff.jsonl', lines2);
  const r2 = gate(payload('run_code', { code: 'step-9' }, { transcript_path: p2 }));
  ok('D-86 run_code 正文不同 ⇒ 指纹不同 ⇒ 不拦',
    r2.out === '', 'out=' + r2.out.slice(0, 160));
}

// ── 放行形状：stdout 必须留空 ───────────────────────────────────
{
  const p = writeTranscript('allow.jsonl', [toolCallLine('bash', BASH)]);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 放行时 stdout 为空且 exit 0（与 guard 的放行形状一致）',
    r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 120) + ' code=' + r.code);
}

// ── 真实形态：大体积工具结果行把重复请求挤出尾窗 ⇒ 仍要能拦（尾窗自适应扩读）────
// 实测依据：真实 transcript 里请求行与工具结果行交替，一次大结果（实测最大行 132 KB）
// 就能把重复请求挤出固定尾窗 ⇒ 连续数被少算 ⇒ 闸门**静默放行**（D-86 这一族缺陷的形态）。
{
  const big = 'x'.repeat(300000);
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push(toolCallLine('bash', BASH));
    lines.push(toolResultLine(big));
  }
  const p = writeTranscript('big-result-between.jsonl', lines);
  const size = fs.statSync(p).size;
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 大体积工具结果行隔开重复请求时仍能拦（尾窗自适应扩读，不静默放行）',
    r.out.includes('R-LOOP-SAME-CALL'),
    'size=' + size + ' out=' + r.out.slice(0, 160) + ' err=' + r.err.slice(0, 140));
  ok('D-86 该夹具的重复请求确实落在 256KB 尾窗之外（断言测的是扩读路径，不是老路径）',
    size > 262144, 'size=' + size);
}
{
  // 同样结构但只有 4 次 ⇒ 不拦（阈值边界在新读取路径下依然成立，不误伤）。
  const big = 'x'.repeat(300000);
  const lines = [];
  for (let i = 0; i < 4; i++) {
    lines.push(toolCallLine('bash', BASH));
    lines.push(toolResultLine(big));
  }
  const p = writeTranscript('big-result-between4.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 大体积结果行隔开时未达阈值（4 次）依然不拦（扩读不误伤）',
    r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 160));
}
{
  // 扩读触顶且连续数不精确 ⇒ 放行（少拦一次，不误伤），但必须 stderr 留痕（不能静默）。
  const big = 'x'.repeat(300000);
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push(toolCallLine('bash', BASH));
    lines.push(toolResultLine(big));
  }
  const p = writeTranscript('big-result-cap.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }), { SAR_LOOP_GATE_MAX_SCAN_BYTES: '4096' });
  ok('D-86 扩读触顶且连续数不精确时放行（宁可少拦也不误伤）',
    r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 160));
  ok('D-86 扩读触顶且连续数不精确时 stderr 留痕（静默放行 = 机制看起来在跑其实没跑）',
    r.err.includes('loop-gate') && r.err.includes('下界'), 'err=' + r.err.slice(0, 200));
}

// ── F3：归属语义（「同一子会话内」）必须真的成立 ────────────────────────
//
// 缺陷背景：上一版代码里有 `if (c.sessionId && sessionId && c.sessionId !== sessionId) continue;`，
// 但**本机 431 个真实 transcript 里 0 个带 sessionId 键** ⇒ 这个比较永不生效，
// 而它上面的注释却宣称「别的会话的行不参与计数」—— 注释与代码不一致 = 静默失效家族。
// 现在的归属键 = turn_id 的末尾 uuid 段（attributionKey），并且**每条规则都有断言**：
//   A1 行内没有 turn_id ⇒ 计入
//   A2 载荷没有 turn_id ⇒ 计入
//   A3 归属键相同 ⇒ 计入
//   A4 归属键不同 ⇒ 不计入（别的子会话的行不参与本子会话的连续计数）
{
  // A1 + A3：同归属 ⇒ 计入 ⇒ 拦
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('attr-same.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 F3 归属 A1/A3：行的归属键与载荷一致 ⇒ 计入（本子会话内 5 次相同 ⇒ 拦）',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
  const shape = JSON.parse(lines[0]);
  ok('D-86 F3 夹具用真实行形状（顶层只有 message/message_id/turn_id，没有 sessionId 键）',
    !('sessionId' in shape) && 'turn_id' in shape && 'message_id' in shape,
    'keys=' + Object.keys(shape).join(','));
}
{
  // A4：归属键不同 ⇒ 不计入 ⇒ 不拦
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH, OTHER_TURN));
  const p = writeTranscript('attr-foreign.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 F3 归属 A4：行的归属键与载荷不同 ⇒ 不计入 ⇒ 不拦（别的子会话的行不算本子会话的连续）',
    r.out === '', 'out=' + r.out.slice(0, 160));
}
{
  // A2：载荷没有 turn_id ⇒ 不据此排除 ⇒ 仍拦
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('attr-nopayload.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p, turn_id: '' }));
  ok('D-86 F3 归属 A2：载荷没有 turn_id ⇒ 不据此排除 ⇒ 仍拦',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // A1：行内没有 turn_id ⇒ 计入
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH, null));
  const p = writeTranscript('attr-norow.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 F3 归属 A1：行没有 turn_id ⇒ 计入（没有归属信息不据此排除）⇒ 仍拦',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // 归一：':compaction' 后缀与无后缀同归属
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH, TURN + ':compaction'));
  const p = writeTranscript('attr-compaction.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 F3 归一：turn_id 的 :compaction 后缀与无后缀视为同一归属 ⇒ 仍拦',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // 归一：行内 turn_task_bg_bg_<uuid> 与载荷裸 <uuid> 同归属
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('attr-bare.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p, turn_id: '11111111-2222-4333-8444-555555555555' }));
  ok('D-86 F3 归一：行内 turn_task_bg_bg_<uuid> 与载荷裸 <uuid> 视为同一归属 ⇒ 仍拦',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // 组合：别的子会话的行插在中间 ⇒ 被排除 ⇒ 本子会话的连续仍数得出来 ⇒ 拦
  const lines = [];
  for (let i = 0; i < 4; i++) {
    lines.push(toolCallLine('bash', BASH));
    lines.push(toolCallLine('bash', BASH, OTHER_TURN));
  }
  lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('attr-mixed.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 F3 归属：别的子会话的行插在中间被排除 ⇒ 本子会话内 5 次连续仍被拦',
    r.out.includes('R-LOOP-SAME-CALL'), 'out=' + r.out.slice(0, 160));
}
{
  // 反向：同归属但指纹不同 ⇒ 仍然断开连续 ⇒ 不拦（证明排除是有条件的，不是无脑排除）
  const lines = [];
  for (let i = 0; i < 4; i++) {
    lines.push(toolCallLine('bash', BASH));
    lines.push(toolCallLine('read', READ));
  }
  lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('attr-same-diff.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 F3 归属：同归属但指纹不同的调用仍会断开连续计数 ⇒ 不拦',
    r.out === '', 'out=' + r.out.slice(0, 160));
}
{
  // 归属键一个都对不上 ⇒ 放行，但必须 stderr 留痕（不能静默：机制看起来在跑其实没跑）
  const lines = [];
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH, OTHER_TURN));
  const p = writeTranscript('attr-mismatch.jsonl', lines);
  const r = gate(payload('bash', BASH, { transcript_path: p }));
  ok('D-86 F3 归属键全对不上时放行且 stderr 留痕（不静默放行）',
    r.out === '' && r.err.includes('归属键'),
    'out=' + r.out.slice(0, 120) + ' err=' + r.err.slice(0, 200));
}

// ── D-91：PTC 真实形态夹具（字节级取自真实 transcript，不是自造）─────────────
//
// 为什么必须用真实字节：上一轮的夹具**两侧同源自造**（载荷与 transcript 都用外层形态）
// ⇒ 37 条断言只能证明「解析器对自造形态成立」，证明不了它认得真实运行时的形态 ——
// D-91（闸门在 PTC 模式下恒不触发）就是这么漏出去的。
// 本夹具 = 真实 PTC 会话 messages.jsonl 的**字节前缀**：外层 run_code 与内层 child_calls 交替。
const PTC_FIXTURE = path.join(REPO, 'tests', 'fixtures', 'd91-ptc-real-prefix.jsonl');

function ptcParse(line) { try { return JSON.parse(line); } catch (e) { return null; } }
function ptcInnerCalls(line) {
  const o = ptcParse(line);
  const m = o && o.message;
  const cc = m && m.details && m.details.ptc && Array.isArray(m.details.ptc.child_calls) ? m.details.ptc.child_calls : [];
  return cc.map((c) => ({ name: String(c.tool_name || ''), input: (c.input && typeof c.input === 'object') ? c.input : {} }));
}
function ptcOuterCall(line) {
  const o = ptcParse(line);
  const m = o && o.message;
  if (!m || !Array.isArray(m.content)) return null;
  const tc = m.content.find((x) => x && x.type === 'toolCall');
  return tc ? { name: String(tc.name || ''), args: (tc.arguments && typeof tc.arguments === 'object') ? tc.arguments : {} } : null;
}
function ptcTurnId(line) {
  const o = ptcParse(line);
  return String((o && (o.turn_id || o.turnId)) || '');
}
function ptcLongestRun(items, keyFn) {
  let run = 1, bestStart = 0, bestLen = items.length ? 1 : 0;
  for (let i = 1; i < items.length; i++) {
    if (keyFn(items[i]) === keyFn(items[i - 1])) run++; else run = 1;
    if (run > bestLen) { bestLen = run; bestStart = i - run + 1; }
  }
  return { start: bestStart, len: bestLen };
}
{
  const lines = fs.readFileSync(PTC_FIXTURE, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const inners = [], outers = [];
  lines.forEach((l, i) => {
    for (const c of ptcInnerCalls(l)) inners.push({ ...c, idx: i });
    const o = ptcOuterCall(l);
    if (o) outers.push({ ...o, idx: i });
  });
  const innerFp = (c) => c.name + '|' + JSON.stringify(c.input);
  const outerFp = (c) => c.name + '|' + JSON.stringify(c.args);
  const ir = ptcLongestRun(inners, innerFp);
  const or_ = ptcLongestRun(outers, outerFp);
  console.log('PTC 夹具：行数=' + lines.length + ' 内层调用=' + inners.length + ' 最长逐字相同内层段=' + ir.len +
    ' 外层toolCall=' + outers.length + ' 最长逐字相同外层段=' + or_.len);
  ok('D-91 PTC 夹具形状正确：既有外层 run_code toolCall、又有内层 child_calls（真混合形态）',
    outers.length > 0 && inners.length > 0 && outers[0].name === 'run_code',
    '外层=' + outers.length + ' 内层=' + inners.length + ' 外层名=' + (outers[0] && outers[0].name));
  ok('D-91 PTC 夹具里有 >=5 次逐字相同的内层调用（够触发阈值）',
    ir.len >= 5, '最长段=' + ir.len);

  // 内层：截断到第 5 次逐字相同内层调用之后 ⇒ 第 6 次应当被拦
  {
    const fifth = inners[ir.start + 4], fourth = inners[ir.start + 3];
    const cut5 = writeTranscript('ptc-inner-cut5.jsonl', lines.slice(0, fifth.idx + 1));
    const cut4 = writeTranscript('ptc-inner-cut4.jsonl', lines.slice(0, fourth.idx + 1));
    const turnId = ptcTurnId(lines[fifth.idx]);
    const r = gate(payload(fifth.name, fifth.input, { transcript_path: cut5, turn_id: turnId }));
    ok('D-91 PTC 真实形态：内层载荷在第 6 次被拦（内层序列单独计数，未与外层混数）',
      r.out.includes('deny') && r.out.includes('第 6 次'), 'out=' + r.out.slice(0, 220) + ' err=' + r.err.slice(0, 120));
    const r4 = gate(payload(fourth.name, fourth.input, { transcript_path: cut4, turn_id: turnId }));
    ok('D-91 PTC 真实形态：内层载荷连跑 4 次不拦（阈值边界不误伤）',
      r4.out === '' && r4.code === 0, 'out=' + r4.out.slice(0, 160));
    const foreign = gate(payload(fifth.name, fifth.input, {
      transcript_path: cut5, turn_id: 'turn_task_bg_bg_00000000-0000-4000-8000-000000000000'
    }));
    ok('D-91 PTC 真实形态：归属键不同 ⇒ 不计入 ⇒ 放行（A4 只少拦不误伤）',
      foreign.out === '' && foreign.code === 0, 'out=' + foreign.out.slice(0, 160));
  }

  // 外层（非 PTC 形态）：同一真实 transcript 上，外层序列仍按原逻辑在第 6 次被拦
  {
    const fifth = outers[or_.start + 4];
    const cut5 = writeTranscript('ptc-outer-cut5.jsonl', lines.slice(0, fifth.idx + 1));
    const turnId = ptcTurnId(lines[fifth.idx]);
    const r = gate(payload(fifth.name, fifth.args, { transcript_path: cut5, turn_id: turnId }));
    ok('D-91 非 PTC 外层形态不回归：外层载荷在第 6 次仍被拦',
      r.out.includes('deny') && r.out.includes('第 6 次'), 'out=' + r.out.slice(0, 220));
  }
}

// ── D-91：内层记录的可比性（参数没落全 ⇒ 不可比 ⇒ 打断连续段但不计入）─────────
//
// 为什么这条要单独断言：宿主落盘的内层 input 是**参数子集**（read 只记 path）。
// 若不判可比性，「read(path)」会被当成「read(path, offset, limit)」相同 ⇒ 把读同一文件的
// 不同段错判成重复 ⇒ 误伤正常分段读取。这条断言就是那个错法的锚点。
{
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push(JSON.stringify({
      message_id: 'm-ptc-' + i,
      turn_id: TURN,
      message: {
        role: 'toolResult',
        content: [{ type: 'text', text: 'ok' }],
        details: {
          ptc: {
            child_calls: [{
              child_tool_call_id: 'cc-' + i,
              parent_tool_call_id: 'pc-' + i,
              tool_name: 'read',
              input: { path: 'src/app/login.ts' },   // 宿主只落盘 path（没有 offset/limit）
              status: 'completed'
            }]
          }
        }
      }
    }));
  }
  const p = writeTranscript('ptc-inner-read.jsonl', lines);
  const r = gate(payload('read', { path: 'src/app/login.ts', offset: 1, limit: 10 },
    { transcript_path: p, turn_id: TURN }));
  ok('D-91 PTC 内层 read：载荷带 offset/limit ⇒ 与只落盘 path 的内层记录不可比 ⇒ 不拦',
    r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 160));
}


// ════════════════════════════════════════════════════════════════════════════
// D-91 收尾轮：把「不可比边界」与「PTC 路径」两处语义补成**可定位**的断言
// ════════════════════════════════════════════════════════════════════════════
//
// 为什么要拆（复审实测，我已独立复现）：
//   · 把实现改坏成「不可比分支不生效 / 哨兵改正常指纹 / 不可比记录丢弃」三种语义后，
//     仓库套件**全部 44 PASS / 0 FAIL** ⇒ 「不可比」这条语义零断言钉住。
//   · PTC 路径三种语义破坏（择一失效 / 取错层级 / 可比性恒假）全部红**同一条**断言
//     ⇒ 红绿无法定位是哪一层坏了。
// 本轮只补断言，**不改判定逻辑的行为**（loop-gate.mjs 只多导出内部函数供白盒观察 ——
// 导出清单以该文件里的注释为准，不在本文件复述函数个数：复述即分叉）。
//
// 断言分两层：
//   · 黑盒（跑闸门看 allow/deny）：钉住「用户可观测的行为」；
//   · 白盒（直接调导出的内部函数）：钉住「是哪一层坏了」—— 按层命名，
//     每一层只被自己那层的语义破坏打红，不牵连其它层。
//
// 夹具全部在 tests/fixtures/ 下，由**真实 PTC transcript 字节**派生
// （生成脚本：tests/fixtures/d91-make-fixtures.mjs —— 随夹具一起入库，父会话可复跑核对）。
// ⚠ 诚实边界（实测，纠正复审方的一处转述）：真实 PTC transcript 里「同一行同含外层
// toolCall + 内层 child_calls」的行数 = **0**；真实形态是 assistant 行（外层 toolCall）
// 与 toolResult 行（details.ptc.child_calls[]）**跨行交替**。主夹具按这个真实形态派生；
// 另有一份「同含行」夹具（真实中不存在，单独标注）只用来防宿主改形态。
{
  const FIXT = path.join(REPO, 'tests', 'fixtures');
  const readFix = (name) => fs.readFileSync(path.join(FIXT, name), 'utf8')
    .split(/\r?\n/).filter((l) => l.trim());
  const REAL_BASH = 'echo d86-live-probe';            // 真实 transcript 里出现 9 次的原值
  const REAL_READ = 'docs/audit/defect-ledger.md';   // 真实 transcript 里出现过的内层 read path
  const PTC_TURN = 'turn_task_bg_bg_7a891c21-2ba7-492d-99cb-e743af822b98';  // 真实行的 turn_id
  const SENTINEL = '\u0000incomparable:';

  // 夹具形状自检：主夹具必须是**真混合形态**（既有外层 toolCall 行、又有内层 child_calls 行）
  {
    const lines = readFix('d91-ptc-inner-read-repeat.jsonl');
    let outer = 0, inner = 0;
    for (const l of lines) {
      const m = (JSON.parse(l).message) || {};
      if (Array.isArray(m.content) && m.content.some((x) => x && x.type === 'toolCall')) outer += 1;
      if (m.details && m.details.ptc && Array.isArray(m.details.ptc.child_calls)) inner += 1;
    }
    ok('D-91 收尾 夹具形状：真混合形态（既有外层 toolCall 行、又有内层 child_calls 行）',
      outer > 0 && inner > 0, '外层行=' + outer + ' 内层行=' + inner);
  }

  // ── 不可比边界 · 第 1 条：参数没落全 ⇒ 不可比 ⇒ 放行（不得凭空造出「重复」）────
  // 载荷 read{path}（不带 offset/limit）+ 5 条内层 read{path}（宿主只落 path）
  //   ⇒ 键集不一致 ⇒ 不可比 ⇒ 不得被当成连续重复 ⇒ 放行。
  //   锚点：M2（不可比分支不生效 ⇒ 照常计入）与 M4（哨兵改用正常指纹 ⇒ 照常计入）。
  {
    const p = writeTranscript('r5-inner-read-repeat.jsonl', readFix('d91-ptc-inner-read-repeat.jsonl'));
    const r = gate(payload('read', { path: REAL_READ }, { transcript_path: p, turn_id: PTC_TURN }));
    ok('D-91 收尾 不可比①：内层参数没落全 ⇒ 不可比 ⇒ 放行（不得凭空造出「重复」）',
      r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 200) + ' err=' + r.err.slice(0, 160));
  }

  // ── 不可比边界 · 第 2 条：不可比记录**打断连续段但不计入** ──────────────────
  // 内层序列 bash×3 + 不可比 read + bash×2，载荷 = bash{REAL_BASH}
  //   ⇒ 末尾连续 bash 只有 2 次（被那条不可比 read 打断）⇒ 不到阈值 ⇒ 放行。
  //   不可比记录若被**丢弃**（M8）而不是打断，连续数会一路数到 5 ⇒ 应被拦 ⇒ 放行即错。
  {
    const p = writeTranscript('r5-inner-read-breaks-run.jsonl', readFix('d91-ptc-inner-read-breaks-run.jsonl'));
    const r = gate(payload('bash', { command: REAL_BASH }, { transcript_path: p, turn_id: PTC_TURN }));
    ok('D-91 收尾 不可比②：不可比记录打断连续段但不计入（末尾连续数不得跨过它累计）',
      r.out === '' && r.code === 0, 'out=' + r.out.slice(0, 200) + ' err=' + r.err.slice(0, 160));
  }

  // ── 不可比边界 · 第 3 条：不可比记录不得被当成正常记录计入 ──────────────────
  // 白盒：直接看 callsFromLines 组装出来的序列 —— 不可比记录必须**占一个位置**
  //   （它要能打断连续段），且它的指纹必须是**哨兵**（不是任何真实调用的指纹）。
  //   锚点：M8（不可比记录直接丢弃 ⇒ 序列里没有它 ⇒ 这条必须红）。
  {
    const lines = readFix('d91-ptc-inner-read-breaks-run.jsonl');
    // 载荷取 bash（与内层 bash 记录**键集一致** ⇒ 可比）⇒ 只有那条内层 read 不可比。
    const payArgs = { command: REAL_BASH };
    const pay = { tool: 'bash', args: payArgs, fp: fingerprint('bash', payArgs) };
    // 参照物**独立判定**：直接从夹具字节里解析内层记录（不走 innerCallsOf，
    // 免得把「取内层」那一层的坏带进来），再用 innerComparable 判定哪些不可比。
    const innerRecs = [];
    for (const l of lines) {
      const o = JSON.parse(l);
      const cc = o.message && o.message.details && o.message.details.ptc && o.message.details.ptc.child_calls;
      if (!Array.isArray(cc)) continue;
      for (const c of cc) {
        const args = (c.input && typeof c.input === 'object') ? c.input : {};
        innerRecs.push({ name: String(c.tool_name || ''), args: args });
      }
    }
    const parsed = callsFromLines(lines, attributionKey(PTC_TURN), pay);
    const seq = parsed.calls || [];
    // 「不可比记录占位」= 不可比记录**没有从序列里消失** ⇒ 序列长度守恒
    //   （内层记录 6 条 ⇒ 序列必须也是 6 条；不可比的那条也得占位，
    //     否则它就不能打断连续段 ⇒ 末尾连续数会跨过它累计）。
    // 不可比记录若被直接丢弃（M8）⇒ 序列少一条 ⇒ 这里必须红。
    // 判据只用**长度**：哨兵计数与「哪些记录不可比」都随被测实现走 ⇒ 拿它们当判据
    // 会让别的层（择一 / 取内层 / 可比性）坏掉时也误红，定位就废了。
    ok('D-91 收尾 不可比③a：不可比记录在计数序列里**占位**（不得被直接丢弃）',
      seq.length === innerRecs.length,
      '序列长度=' + seq.length + ' 内层记录数=' + innerRecs.length +
      ' 指纹=' + JSON.stringify(seq.map((c) => String(c.fp).slice(0, 46))));

    // ③b：哨兵**表示**本身 —— 不可比记录的占位指纹必须与它的真实指纹不同。
    //   这条钉住「哨兵被换成正常指纹」（M4）这个语义，且只被它打红。
    const readRec = { name: 'read', args: { path: REAL_READ } };
    const readRealFp = fingerprint('read', readRec.args);
    const readSentinel = incomparableFp(readRec);
    ok('D-91 收尾 不可比③b：不可比记录的占位指纹是哨兵（与真实指纹不同，不得被当成正常记录计入）',
      String(readSentinel).indexOf(SENTINEL) === 0 && readSentinel !== readRealFp &&
      String(readSentinel).indexOf(String(readRealFp)) < 0,
      '哨兵=' + JSON.stringify(readSentinel) + ' 真实指纹=' + JSON.stringify(readRealFp));
  }

  // ── PTC 路径 · 第 1 层：择一（pickNamespace）────────────────────────────────
  // 白盒：载荷工具名**只出现在内层** ⇒ 必须数内层；只出现在外层 ⇒ 必须数外层。
  //   锚点：M1（择一恒返回 outer）。
  {
    const one = [{ name: 'bash', args: { command: REAL_BASH } }];
    const r1 = pickNamespace(one, one, 'bash');   // 两边都有 ⇒ 取内层
    const r2 = pickNamespace([], one, 'bash');      // 只有内层 ⇒ 取内层
    const r3 = pickNamespace(one, [], 'bash');      // 只有外层 ⇒ 取外层
    ok('D-91 收尾 PTC·择一层：按载荷工具名所在的那套序列计数（两边都有⇒内层）',
      r1 === 'inner' && r2 === 'inner' && r3 === 'outer',
      '两边都有⇒' + r1 + ' 只有内层⇒' + r2 + ' 只有外层⇒' + r3);
  }

  // ── PTC 路径 · 第 2 层：取内层（innerCallsOf）───────────────────────────────
  // 白盒：必须从 message.details.ptc.child_calls[] 取内层记录（不是 m.ptc）。
  //   锚点：M6（读 m.ptc 取错层级）。
  {
    const line = readFix('d91-ptc-inner-read-breaks-run.jsonl')
      .map((l) => JSON.parse(l))
      .find((o) => o.message && o.message.details && o.message.details.ptc &&
        Array.isArray(o.message.details.ptc.child_calls) && o.message.details.ptc.child_calls.length);
    const recs = line ? innerCallsOf(line) : [];
    ok('D-91 收尾 PTC·取内层层：从 message.details.ptc.child_calls[] 取到内层记录',
      recs.length === 1 && recs[0].name === 'bash' &&
      String(recs[0].args.command || '') === REAL_BASH,
      '取到=' + recs.length + ' 记录=' + JSON.stringify(recs.map((r) => ({ n: r.name, a: r.args }))));
  }

  // ── PTC 路径 · 第 3 层：可比性（innerComparable）────────────────────────────
  // 白盒：参数齐 ⇒ 可比；参数缺 ⇒ 不可比。
  //   锚点：M7（可比性恒 false）。
  {
    const bashRec = { name: 'bash', args: { command: REAL_BASH } };
    const bashPay = { tool: 'bash', args: { command: REAL_BASH } };
    const readRec = { name: 'read', args: { path: REAL_READ } };          // 宿主只落 path
    const readPay = { tool: 'read', args: { path: REAL_READ, offset: 1, limit: 10 } };
    const c1 = innerComparable(bashRec, bashPay);
    const c2 = innerComparable(readRec, readPay);
    ok('D-91 收尾 PTC·可比性层：参数齐⇒可比、参数缺⇒不可比',
      c1 === true && c2 === false, '参数齐⇒' + c1 + ' 参数缺⇒' + c2);
  }

  // ── PTC 路径 · 黑盒端到端：真混合形态下内层 bash 连跑 5 次 ⇒ 第 6 次被拦 ────
  // 这是「用户可观测行为」的锚点（白盒三层各自定位，见上）。
  {
    const objs = readFix('d91-ptc-inner-read-breaks-run.jsonl').map((l) => JSON.parse(l));
    const outerTpl = objs.filter((o) => o.message && Array.isArray(o.message.content) &&
      o.message.content.some((x) => x && x.type === 'toolCall'));
    const innerTpl = objs.filter((o) => o.message && o.message.details && o.message.details.ptc &&
      Array.isArray(o.message.details.ptc.child_calls));
    const built = [];
    for (let i = 0; i < 5; i++) {
      built.push(JSON.stringify(outerTpl[i]));                    // 外层 run_code 行（真实形态）
      const io = JSON.parse(JSON.stringify(innerTpl[i]));        // 内层 toolResult 行（真实形态）
      io.message.details.ptc.child_calls[0].tool_name = 'bash';
      io.message.details.ptc.child_calls[0].input = { command: REAL_BASH };
      io.message.details.ptc.child_calls[0].child_tool_call_id = 'r5-bash-' + i;
      built.push(JSON.stringify(io));
    }
    const p = writeTranscript('r5-inner-bash5.jsonl', built);
    const r = gate(payload('bash', { command: REAL_BASH }, { transcript_path: p, turn_id: PTC_TURN }));
    ok('D-91 收尾 PTC·端到端：真混合形态下内层 bash 连跑 5 次 ⇒ 第 6 次被拦',
      r.out.includes('deny') && r.out.includes('第 6 次'), 'out=' + r.out.slice(0, 220));
  }

  // ── PTC 路径 · 防御性：同一行同含两套序列时，仍必须按载荷形态择一 ──────────
  // ⚠ 诚实边界：这种「同含行」在真实 transcript 里**不存在**（实测 0 行）——
  //   本夹具是**合成**的，只用来防宿主将来改成同含形态时闸门认不出来。
  {
    const p = writeTranscript('r5-same-line-mixed.jsonl', readFix('d91-ptc-same-line-mixed.jsonl'));
    const r = gate(payload('bash', { command: REAL_BASH }, { transcript_path: p, turn_id: PTC_TURN }));
    // 该夹具有 6 条逐字相同的内层 bash ⇒ 末尾连续数 6 ⇒ 拦在**第 7 次**
    ok('D-91 收尾 PTC·防御性：同一行同含外层+内层时仍按载荷形态择一（合成形态，真实中不存在）',
      r.out.includes('deny') && r.out.includes('第 7 次'), 'out=' + r.out.slice(0, 220));
  }
}
// ── 性能读数：大 transcript 上单次 hook 调用的耗时量级 ────────────────
//
// D-93（本轮修）：这条断言原是**单次采样**，在并发负载下实测 2921ms ⇒ 触发一条
// **与语义无关**的红点；空闲复测 78~96ms ⇒ 绿。后果不是「慢」，而是
// **变异体矩阵结论被噪声污染**：同一个语义变异体在两种负载下红点条数不同
// （多红要人工排除它，MISS 判定也可能被干扰）⇒ 矩阵不可复现。
//
// 修法（**不抬阈值** —— 抬阈值会把「秒级」这个保证一起放松）：
//   ① **同条件下重复采样取最小值**（min-of-N）：调度抢占 / GC / 磁盘抖动只会把
//      某一次采样推高，不会推高**最小值** ⇒ 最小值反映的是机制自身的耗时上界。
//   ② **与同规模小基线相对比较**：整机被别的负载占满时，**小 transcript 的调用
//      也会一起变慢**（实测满载：小基线 52ms → 1223ms）⇒ 单看绝对值分不清
//      「机制变慢」与「机器变慢」。比值（大盘 min / 小盘 min）把机器慢排除掉。
//   阈值 2000ms **不变**（保住「秒级」保证），判据改为「min-of-N 的最小值达标」
//   **或**「相对小基线的倍数在合理范围内」。
//
// N 的取值与理由：N=7。理由 —— 本机实测（2026-11-12，8 核）满载下单次采样
// 最高 1989ms、最小 777ms、最小/小基线 = 0.6 ⇒ 一次采样可能踩到 1989ms 这个
// 接近阈值的值（再高一点就误红），而 min-of-7 稳在 777ms。N=7 的采样成本
// （空闲约 7×90ms ≈ 0.6s）相对整套件可忽略；N 再小（N=3）遇到连续 3 次抢占
// 就会取到被推高的值，N 过大则拖慢回归。7 是「足够摊平抢占」与「成本可忽略」的折中。
const PERF_SAMPLES = 7;
{
  const lines = [];
  const filler = 'x'.repeat(4000);
  for (let i = 0; i < 5000; i++) lines.push(userLine('历史噪声 ' + i + ' ' + filler));
  for (let i = 0; i < 5; i++) lines.push(toolCallLine('bash', BASH));
  const p = writeTranscript('big.jsonl', lines);
  const size = fs.statSync(p).size;
  // 小基线：同样 5 次相同 bash，但 transcript 很小 ⇒ 测的是「进程启动 + 机器负载」
  // 的固定开销，不是「读 20MB 的成本」。
  const smallP = writeTranscript('big-small-baseline.jsonl', [toolCallLine('bash', BASH)]);
  const timeOnce = (tp) => {
    const t0 = Date.now();
    const r = gate(payload('bash', BASH, { transcript_path: tp }));
    return { ms: Date.now() - t0, out: r.out };
  };
  const bigSamples = [];
  let lastOut = '';
  for (let i = 0; i < PERF_SAMPLES; i++) {
    const t = timeOnce(p);
    bigSamples.push(t.ms);
    lastOut = t.out;
  }
  const smallSamples = [];
  for (let i = 0; i < PERF_SAMPLES; i++) smallSamples.push(timeOnce(smallP).ms);
  const bigMin = Math.min(...bigSamples);
  const smallMin = Math.min(...smallSamples);
  // 相对倍数：大盘最小耗时 ÷ 小基线最小耗时。
  // 机制本身的开销（读 20MB + 解析）应当只比「空跑」贵一个有限倍数；
  // 若整机被占满，两者一起变慢 ⇒ 比值保持稳定（实测满载 0.6、空闲 1.6）。
  const ratio = smallMin > 0 ? bigMin / smallMin : Infinity;
  const absOk = bigMin < 2000;
  const relOk = ratio <= 20;
  console.log('PERF transcript=' + Math.round(size / 1048576) + 'MB 样本(' + PERF_SAMPLES + '次)=' +
    bigSamples.join('/') + 'ms  最小=' + bigMin + 'ms  小基线最小=' + smallMin + 'ms  相对倍数=' +
    (ratio === Infinity ? 'inf' : ratio.toFixed(2)));
  ok('D-86 大 transcript 上单次调用耗时在可接受量级（< 2000ms，取 ' + PERF_SAMPLES + ' 次采样最小值）',
    absOk, 'min=' + bigMin + 'ms 全部样本=' + bigSamples.join('/') + 'ms size=' + size);
  ok('D-86 性能读数对负载不敏感（相对同规模小基线的倍数 <= 20 ⇒ 变慢来自机器而非机制）',
    relOk, '相对倍数=' + (ratio === Infinity ? 'inf' : ratio.toFixed(2)) +
    '  大盘min=' + bigMin + 'ms 小基线min=' + smallMin + 'ms');
  ok('D-86 大 transcript 上判定仍正确（末尾 5 次相同 ⇒ 拦）',
    lastOut.includes('R-LOOP-SAME-CALL'), lastOut.slice(0, 120));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? '>>> LOOP-GATE ALL PASS' : '>>> LOOP-GATE FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
