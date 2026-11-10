// super-agent-router 回归测试（v0.5.0）
// 用法：node .superagent/e2e-test.mjs
// 断言插件的 Hook 在真实 stdin/stdout 契约下的行为。
//
// v0.4.0 语义：派工发生在父会话，工具执行发生在子会话。
//   · 父会话 = Router（不受 worker 的 scope 约束）
//   · 子会话 = worker（载荷带 agent_type，scope 来自它自己 transcript 里的 brief）
//
// v0.5.0 新增锁住：
//   · codex 变体 transcript 的端到端链路（D-01）
//   · 解析不到边界一律拒绝（D-04）
//   · glob/grep 按有效检索根判定（D-22）
//   · watchdog 的收尾契约校验（S8）与证据判定（D-11）
//   · 名额回收的三条路（S6.2）
//   · 实战记录摘要的披露口径（S7.3）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-e2e-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const a = 1;', 'utf8');

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ' :: ' + extra : ''));
};

function run(script, payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload),
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: payload && payload.cwd ? payload.cwd : tmp },
    encoding: 'utf8'
  });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}

// 造一份子会话 transcript：第一条 user 消息里带父会话、成员名与 SCOPE
function makeTranscript(session, parent, agent, scope) {
  const text = [
    '<agent-context>',
    '  agentName: ' + agent,
    '  PARENT SESSION: ' + parent,
    '</agent-context>',
    '任务：按 brief 执行',
    'SCOPE: ' + scope
  ].join('\n');
  const p = path.join(tmp, 'tr-' + session + '.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    uuid: 'p-0', parentUuid: null, sessionId: session,
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] }
  }) + '\n', 'utf8');
  return p;
}

// codex 变体：type=response_item + payload.role=user + content[].type=input_text
function makeCodexTranscript(session, parent, agent, scope) {
  const text = [
    '<agent-context>',
    '  agentName: ' + agent,
    '  PARENT SESSION: ' + parent,
    '</agent-context>',
    '任务：按 brief 执行',
    'SCOPE: ' + scope
  ].join('\n');
  const p = path.join(tmp, 'tr-codex-' + session + '.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    timestamp: new Date().toISOString(), type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
  }) + '\n', 'utf8');
  return p;
}

// 1. UserPromptSubmit：普通提问静默放行，编排意图才注入
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '帮我看下这个错误', session_id: 'e1' });
  ok('普通提问静默放行', r.out === '');
}
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做，谁来负责？', session_id: 'e1' });
  ok('编排意图注入路由指令', r.out.includes('super-agent-router') && r.out.includes('直做'));
}
// 1b. gate 不得把用户文本里的路径说成「已声明的 SCOPE」（D-15）
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做？\nSCOPE: src/app.ts', session_id: 'e1b' });
  ok('gate 不把用户文本里的 SCOPE 说成授权', r.out.includes('未验证') && !r.out.includes('本轮 prompt 中声明的 SCOPE'), r.out.slice(0, 200));
}

// 2. 派工登记：scope 只收路径，自然语言被过滤
const scopeSession = 'e-task';
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: scopeSession, turn_id: 'et1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts, src/util.ts\n请实现登录超时修复' }
  });
  const led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const d = led.dispatches.find((x) => x.parent_session_id === scopeSession);
  ok('scope 只收路径', !!d && JSON.stringify(d.scope) === JSON.stringify(['src/app.ts', 'src/util.ts']), JSON.stringify(d && d.scope));
  ok('派工记录带 dispatch_id', !!d && !!d.dispatch_id, d ? String(d.dispatch_id) : 'no-record');
}

// 3. 越界拦截：worker 受自己 scope 约束，Router 不受约束
const workerSession = 'e-worker';
const TR = makeTranscript(workerSession, scopeSession, 'worker', 'src/app.ts');
function wguard(tool, payload, sid, tr) {
  return run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: sid || workerSession,
    agent_id: sid || workerSession, agent_type: 'worker',
    transcript_path: tr === undefined ? TR : tr,
    tool_input: payload
  });
}
{
  const r1 = wguard('write', { file_path: 'src/app.ts' });
  ok('worker scope 内文件放行', r1.out === '');
  const r2 = wguard('write', { file_path: 'config/prod.yaml' });
  ok('worker scope 外文件 deny', r2.out.includes('deny'), r2.out.slice(0, 90));
  const r3 = wguard('bash', { command: 'rm -rf config/prod.yaml' });
  ok('worker bash 越界 deny', r3.out.includes('deny'), r3.out.slice(0, 90));
  // 解析不到边界 -> 拒绝（D-04 / 契约 S4）
  const r4 = wguard('read', { path: 'any/x.ts' }, 'no-scope-w', null);
  ok('worker 解析不到边界时被拦', r4.out.includes('deny'), r4.out.slice(0, 120));
  const r5 = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: scopeSession, tool_input: { file_path: 'any/x.ts' } });
  ok('Router 父会话不被 worker scope 约束', r5.out === '', r5.out.slice(0, 90));
}

// 3b. D-01：codex 变体的完整链路（派工 -> 守卫按 scope 判定）
{
  const s = 'e-codex';
  const w = 'e-codex-worker';
  const t = makeCodexTranscript(w, s, 'worker', 'src/app.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'ct1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts' }
  });
  const g = (tool, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: w,
    agent_id: w, agent_type: 'worker', transcript_path: t, tool_input: input
  });
  ok('codex 变体：scope 内放行', g('write', { file_path: 'src/app.ts' }).out === '');
  ok('codex 变体：scope 外 deny', g('write', { file_path: 'config/prod.yaml' }).out.includes('deny'));
}

// 4. Watchdog：空交付与无证据 block，有证据放行
{
  const a = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '' });
  ok('空交付 block', a.out.includes('block'));
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已经完成修复了' });
  ok('无证据声称完成 block', b.out.includes('block'));
  const c = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已修复。改动文件 src/app.ts，测试命令 npm test 全部通过', cwd: tmp });
  ok('有证据放行', c.out === '');
}

// 4b. D-11：描述性词不算证据
{
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '搞定了，测试通过' });
  ok('「搞定了，测试通过」被拦', b.out.includes('block'), b.out.slice(0, 140));
}

// 4c. S8：条目型产出必须符合 S1 的 7 字段模板
{
  const bad = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a3', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n条目统计：总计 1 条；已复现 1 条，推断 0 条'
  });
  ok('条目缺字段时 block 并指明缺哪项', bad.out.includes('block') && bad.out.includes('缺字段'), bad.out.slice(0, 300));
  const good = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a4', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n- 复现步骤：z\n- 证据：e\n- 状态：已复现\n- 修法方向：f\n- 还需要什么：无，代码路径已确定\n条目统计：总计 1 条；已复现 1 条，推断 0 条'
  });
  ok('合规条目放行', good.out === '', good.out.slice(0, 200));
  const noStat = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a5', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n- 复现步骤：z\n- 证据：e\n- 状态：已复现\n- 修法方向：f\n- 还需要什么：无，代码路径已确定'
  });
  ok('条目缺统计行时 block', noStat.out.includes('block') && noStat.out.includes('条目统计'), noStat.out.slice(0, 300));
}

// 5. 读类工具纳入管控
{
  const scopeSession2 = 'e-read';
  const w2 = 'e-read-worker';
  const tr2 = makeTranscript(w2, scopeSession2, 'worker', 'src/app/login.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: scopeSession2, turn_id: 'rt1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app/login.ts' }
  });
  const g = (toolName, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: toolName, session_id: w2,
    agent_id: w2, agent_type: 'worker', transcript_path: tr2, tool_input: input
  });
  ok('读 scope 内放行', g('read', { path: 'src/app/login.ts' }).out === '');
  ok('读无关目录 deny', g('read', { path: 'config/prod.yaml' }).out.includes('deny'));
  // D-22：判定对象是有效检索根，不是 pattern
  ok('glob 检索根在读放行目录树内放行', g('glob', { pattern: '**/*.ts', path: 'src/app' }).out === '');
  ok('glob 检索根在范围外 deny', g('glob', { pattern: '**/*.ts', path: 'config' }).out.includes('deny'));
  ok('glob 无 path 时按工作区根判定并 deny', g('glob', { pattern: 'src/app/*.ts' }).out.includes('deny'));
}

// 6. 危险操作一律拦（子代理侧，不受 scope 保护）
{
  const g = (toolName, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: toolName, session_id: 'no-scope',
    agent_id: 'no-scope', agent_type: 'worker', tool_input: input
  });
  ok('删除成员被拦', g('mavis_agent_delete', { agent_name: 'x' }).out.includes('deny'));
  ok('公网部署被拦', g('website_deploy', { path: 'x' }).out.includes('deny'));
  ok('改成员配置被拦', g('mavis_agent_update', { agent_name: 'x' }).out.includes('deny'));
  ok('mavis 的 agent delete 被拦', g('mavis', { command: 'agent delete' }).out.includes('deny'));
}

// 7. 名额回收三条路（契约 S6.2）
{
  // 第 1 条：正常结束（SubagentStop）-> 立即回收
  const s = 'e-recycle';
  const w = 'e-recycle-worker';
  const t = makeTranscript(w, s, 'worker', 'src/recycle.ts');
  fs.writeFileSync(path.join(tmp, 'src', 'recycle.ts'), 'export const b = 2;', 'utf8');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'r1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/recycle.ts' }
  });
  run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: w,
    agent_id: w, agent_type: 'worker', transcript_path: t,
    tool_input: { file_path: 'src/recycle.ts' }
  });
  run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', session_id: w, agent_id: w, agent_type: 'worker',
    transcript_path: t, last_assistant_message: '已完成，改动文件 src/recycle.ts，测试通过'
  });
  let led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const rec = led.dispatches.find((x) => x.parent_session_id === s);
  ok('正常结束后派工状态为 done', !!rec && rec.state === 'done', JSON.stringify(rec && rec.state));

  // 第 2 条：超时兜底 —— 超龄的 active 记录判死并落盘
  led.dispatches.push({
    dispatch_id: 'dsp_e2e_stale', parent_session_id: 'e-stale', turn_id: 'x', turn_key: 'x',
    tool_use_id: '', agent: 'sa-stale', agent_key: 'sa-stale', project: tmp,
    scope: ['src/stale.ts'], state: 'active', at: Date.now() - 5 * 60 * 60 * 1000
  });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify(led, null, 2), 'utf8');
  run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'e-stale-worker', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 src/app.ts，测试通过'
  });
  led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const stale = led.dispatches.find((x) => x.dispatch_id === 'dsp_e2e_stale');
  ok('超龄派工被 TTL 判死并落盘', !!stale && stale.state !== 'active' && stale.end_reason === 'ttl_expired', JSON.stringify(stale));

  // 第 3 条：读时自愈 —— 读取在飞名单时把超龄记录判死
  led.dispatches.push({
    dispatch_id: 'dsp_e2e_selfheal', parent_session_id: 'e-selfheal', turn_id: 'y', turn_key: 'y',
    tool_use_id: '', agent: 'sa-selfheal', agent_key: 'sa-selfheal', project: tmp,
    scope: ['src/selfheal.ts'], state: 'active', at: Date.now() - 5 * 60 * 60 * 1000
  });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify(led, null, 2), 'utf8');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-selfheal2', turn_id: 'z',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/selfheal2.ts' }
  });
  led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const healed = led.dispatches.find((x) => x.dispatch_id === 'dsp_e2e_selfheal');
  ok('读取在飞名单时超龄记录被自愈判死', !!healed && healed.state !== 'active', JSON.stringify(healed && healed.state));
}

// 8. S7.3：实战记录摘要必须披露「已显示 N / 共 M」（调用方口径）
{
  fs.mkdirSync(path.join(tmp, '.superagent', 'methods'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-01-01',
    members: [{ name: 'sa-e2e', kind: 'specialist', owns: '端到端回归', method: '.superagent/methods/sa-e2e.md' }]
  }), 'utf8');
  fs.writeFileSync(path.join(tmp, '.superagent', 'methods', 'sa-e2e.md'), [
    '# sa-e2e', '', '## 实战记录', '', '### 端到端回归用例',
    '- 做法：先写断言再改实现', '- 证据：五套回归全绿', '- 验收：独立验收通过', ''
  ].join('\n'), 'utf8');
  const g = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做，谁来负责？', session_id: 'e-disclose' });
  ok('gate 披露已显示/共有的成员数', g.out.includes('已显示 1 / 共 1'), g.out.slice(0, 240));
  const ss = run('session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'e-ss' });
  ok('session-start 披露已显示/共有的成员数', ss.out.includes('已显示 1 / 共 1'), ss.out.slice(0, 240));
}

// 9. D-06 / D-18：历史教训必须真的到达 worker（不能只挂在父会话的 additionalContext 上）
{
  const s = 'e-lessons';
  const w = 'e-lessons-worker';
  fs.mkdirSync(path.join(tmp, '.superagent', 'lessons'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.superagent', 'lessons', 'sa-lesson.md'),
    '# 错题本\n\n## 2026-01-01 · 某次\n- **规则**：先写回归断言再改实现\n', 'utf8');
  const t = makeTranscript(w, s, 'sa-lesson', 'src/lesson.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'l1',
    tool_input: { agent_name: 'sa-lesson', prompt: 'SCOPE: src/lesson.ts' }
  });
  const g = run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: w,
    agent_id: w, agent_type: 'sa-lesson', transcript_path: t,
    tool_input: { path: 'src/lesson.ts' }
  });
  ok('历史教训被送进 worker 上下文', g.out.includes('历史教训') && g.out.includes('先写回归断言再改实现'), g.out.slice(0, 260));
}

console.log(fail === 0 ? '>>> E2E ALL PASS' : '>>> E2E FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
