// 作用域验证（v0.5.0）
// 核心断言：约束只落在「被派工的子代理」身上，Router 永远不被约束。
//
// v0.4.0 的语义变化（实测驱动）：
//   · 派工发生在父会话，工具执行发生在子会话
//   · worker 的 scope 来自它自己 transcript 里的派工原文（权威来源）
//   · 父会话的工具调用载荷没有 agent_type -> 直接放行
//
// v0.5.0 新增锁住契约 S2 的条目形态与读写口径：
//   · ro: 只读条目：只授读、不授写、不参与写冲突
//   · 可写条目与只读条目混用
//   · 文件条目的所在目录树可读（S2.1）
//   · 目录条目：读它本身放行、写它本身拒绝（授权只覆盖其「之下」）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-scope-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, 'src', 'app'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'app', 'login.ts'), 'x', 'utf8');

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function run(script, payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: PROJ }
  });
  return (r.stdout || '').trim();
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

const PARENT = 'router-s1';
const WORKER = 'worker-s1';
const SCOPE = 'src/app/login.ts';

run('dispatch.mjs', {
  hook_event_name: 'PreToolUse', tool_name: 'task', session_id: PARENT, turn_id: 't1',
  tool_input: { agent_name: 'worker', prompt: 'SCOPE: ' + SCOPE }
});
const TR = makeTranscript(WORKER, PARENT, 'worker', SCOPE);

function workerGuard(tool, payload, session, tr) {
  return run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: session || WORKER,
    agent_id: session || WORKER, agent_type: 'worker', transcript_path: tr || TR,
    tool_input: payload
  });
}

// 1. Router 父会话：刚派过工，但自己读写任何路径都不受约束
{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: PARENT, tool_input: { file_path: 'C:/anywhere/x.ts' } });
  ok('Router 父会话写文件不被拦', o === '', o.slice(0, 90));
}
{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'read', session_id: PARENT, tool_input: { path: 'C:/anywhere/x.ts' } });
  ok('Router 父会话读文件不被拦', o === '', o.slice(0, 90));
}

// 2. worker：写 scope 内 -> 放行
{
  const o = workerGuard('write', { file_path: 'src/app/login.ts' });
  ok('worker 写 scope 内放行', o === '', o.slice(0, 90));
}
// 3. worker：写 scope 外 -> deny
{
  const o = workerGuard('write', { file_path: 'config/prod.yaml' });
  ok('worker 写 scope 外被拦', o.includes('deny'), o.slice(0, 90));
}
// 4. worker：读同目录邻近文件 -> 放行（读宽松）
{
  const o = workerGuard('read', { path: 'src/app/session.ts' });
  ok('worker 读同目录邻近文件放行', o === '', o.slice(0, 90));
}
// 5. worker：读无关目录 -> deny
{
  const o = workerGuard('read', { path: 'config/prod.yaml' });
  ok('worker 读无关目录被拦', o.includes('deny'), o.slice(0, 90));
}
// 6. worker：绝对路径写 scope 内 -> 放行（路径归一化）
{
  const abs = path.join(PROJ, 'src', 'app', 'login.ts');
  const o = workerGuard('write', { file_path: abs });
  ok('worker 绝对路径写 scope 内放行', o === '', o.slice(0, 90));
}
// 7. worker：bash 命令里藏 scope 外路径 -> deny
{
  const o = workerGuard('bash', { command: 'node config/prod.yaml' });
  ok('worker bash 越界路径被拦', o.includes('deny'), o.slice(0, 90));
}
// 8. worker：bash 命令里只有 scope 内路径 -> 放行
{
  const o = workerGuard('bash', { command: 'node src/app/login.ts' });
  ok('worker bash scope 内路径放行', o === '', o.slice(0, 90));
}

// 9. S2.1：文件条目所在目录树可读
{
  const o = workerGuard('read', { path: 'src/app/sub/deep.ts' });
  ok('条目所在目录树可读', o === '', o.slice(0, 90));
}

// 10. ro: 只读条目 —— 只授读、不授写
{
  const W = 'worker-ro';
  const T = makeTranscript(W, 'router-ro', 'worker', 'ro: src/app/');
  const readOut = workerGuard('read', { path: 'src/app/other.ts' }, W, T);
  const writeOut = workerGuard('write', { file_path: 'src/app/other.ts' }, W, T);
  ok('ro: 条目授予读', readOut === '', readOut.slice(0, 120));
  ok('ro: 条目不授予写', writeOut.includes('deny'), writeOut.slice(0, 120));
}

// 11. S2.5：可写条目与只读条目混用
{
  const W = 'worker-mix';
  const T = makeTranscript(W, 'router-mix', 'worker', 'ro: src/app/, src/app/login.ts');
  const roRead = workerGuard('read', { path: 'src/app/other.ts' }, W, T);
  const rwWrite = workerGuard('write', { file_path: 'src/app/login.ts' }, W, T);
  const roWrite = workerGuard('write', { file_path: 'src/app/other.ts' }, W, T);
  ok('混用形态：只读部分授读', roRead === '', roRead.slice(0, 120));
  ok('混用形态：可写部分授写', rwWrite === '', rwWrite.slice(0, 120));
  ok('混用形态：只读部分不授写', roWrite.includes('deny'), roWrite.slice(0, 120));
}

// 12. 目录条目：读它本身放行、写它本身拒绝
{
  const W = 'worker-dir';
  const T = makeTranscript(W, 'router-dir', 'worker', 'src/app/');
  const readDir = workerGuard('read', { path: 'src/app' }, W, T);
  const writeDir = workerGuard('write', { file_path: 'src/app' }, W, T);
  const writeUnder = workerGuard('write', { file_path: 'src/app/login.ts' }, W, T);
  ok('读目录条目本身放行', readDir === '', readDir.slice(0, 120));
  ok('写目录条目本身拒绝', writeDir.includes('deny'), writeDir.slice(0, 120));
  ok('写目录条目之下放行', writeUnder === '', writeUnder.slice(0, 120));
}

// 13. S3：glob / grep 的判定对象是有效检索根
{
  const inRoot = workerGuard('glob', { pattern: '**/*.ts', path: 'src/app' });
  const outRoot = workerGuard('glob', { pattern: '**/*.ts', path: 'config' });
  const noPath = workerGuard('grep', { pattern: 'login' });
  ok('glob 检索根在读放行目录树内放行', inRoot === '', inRoot.slice(0, 120));
  ok('glob 检索根在范围外被拦', outRoot.includes('deny'), outRoot.slice(0, 120));
  ok('grep 无 path 时按工作区根判定并被拦', noPath.includes('deny'), noPath.slice(0, 120));
}

console.log(fail === 0 ? '>>> SCOPE ALL PASS' : '>>> SCOPE FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
