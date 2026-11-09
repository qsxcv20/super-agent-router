// super-agent-router 回归测试（v0.4.0）
// 用法：node .superagent/e2e-test.mjs
// 断言插件的 Hook 在真实 stdin/stdout 契约下的行为。
//
// v0.4.0 语义：派工发生在父会话，工具执行发生在子会话。
//   · 父会话 = Router（不受 worker 的 scope 约束）
//   · 子会话 = worker（载荷带 agent_type，scope 来自它自己 transcript 里的 brief）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-e2e-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });

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

// 1. UserPromptSubmit：普通提问静默放行，编排意图才注入
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '帮我看下这个错误', session_id: 'e1' });
  ok('普通提问静默放行', r.out === '');
}
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做，谁来负责？', session_id: 'e1' });
  ok('编排意图注入路由指令', r.out.includes('super-agent-router') && r.out.includes('直做'));
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
  const r4 = wguard('read', { path: 'any/x.ts' }, 'no-scope-w', null);
  ok('worker 无 scope 不拦', r4.out === '', r4.out.slice(0, 90));
  const r5 = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: scopeSession, tool_input: { file_path: 'any/x.ts' } });
  ok('Router 父会话不被 worker scope 约束', r5.out === '', r5.out.slice(0, 90));
}

// 4. Watchdog：空交付与无证据 block，有证据放行
{
  const a = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '' });
  ok('空交付 block', a.out.includes('block'));
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已经完成修复了' });
  ok('无证据声称完成 block', b.out.includes('block'));
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const a = 1;', 'utf8');
  const c = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已修复。改动文件 src/app.ts，测试命令 npm test 全部通过', cwd: tmp });
  ok('有证据放行', c.out === '');
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
  ok('glob 同目录放行', g('glob', { pattern: 'src/app/*.ts' }).out === '');
  ok('glob 跨目录 deny', g('glob', { pattern: '**/*.ts' }).out.includes('deny'));
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
}

console.log(fail === 0 ? '>>> E2E ALL PASS' : '>>> E2E FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
