// guard 行为回归（v0.4.0）
// 覆盖：写严格 / 读宽松 / 绝对路径归一 / 危险操作一律拦 / 父会话不受约束
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-guard2-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, 'src', 'app'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'config'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'app', 'login.ts'), 'x', 'utf8');
fs.writeFileSync(path.join(PROJ, 'config', 'prod.yaml'), 'x', 'utf8');

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

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

function guard(payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  return (r.stdout || '').trim();
}
function dispatch(scope, session, turn) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: session, turn_id: turn || 't',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: ' + scope }
    }), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  return (r.stdout || '').trim();
}

const W = 'worker-s1';
const TR = makeTranscript(W, 'router-s1', 'worker', 'src/app/login.ts');
dispatch('src/app/login.ts', 'router-s1', 't1');

function w(tool, payload) {
  return guard(Object.assign({
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: W,
    agent_id: W, agent_type: 'worker', transcript_path: TR
  }, { tool_input: payload }));
}

// 1a. 写 scope 内文件 -> 放行
ok('写 scope 内文件放行', w('write', { file_path: 'src/app/login.ts' }) === '');
// 1b. 写 scope 外文件 -> deny
{
  const o = w('write', { file_path: 'config/prod.yaml' });
  ok('写 scope 外文件 deny', o.includes('deny'), o.slice(0, 100));
}
// 1c. 绝对路径写 scope 内 -> 放行
{
  const abs = path.join(PROJ, 'src', 'app', 'login.ts');
  const o = w('write', { file_path: abs });
  ok('绝对路径写 scope 内放行', o === '', 'abs=' + abs + ' -> ' + o.slice(0, 100));
}
// 1d. 绝对路径写 scope 外 -> deny
{
  const abs = path.join(PROJ, 'config', 'prod.yaml');
  const o = w('write', { file_path: abs });
  ok('绝对路径写 scope 外 deny', o.includes('deny'), o.slice(0, 100));
}
// 1e. 读 scope 内文件 -> 放行
ok('读 scope 内文件放行', w('read', { path: 'src/app/login.ts' }) === '');
// 1f. 读同目录邻近文件 -> 放行（读宽松）
ok('读同目录邻近文件放行', w('read', { path: 'src/app/session.ts' }) === '');
// 1g. 读完全无关目录 -> deny
{
  const o = w('read', { path: 'config/prod.yaml' });
  ok('读无关目录 deny', o.includes('deny'), o.slice(0, 100));
}
// 1h. glob 同目录 -> 放行
ok('glob 同目录放行', w('glob', { pattern: 'src/app/*.ts' }) === '');
// 1i. glob 跨目录 -> deny
{
  const o = w('glob', { pattern: '**/*.ts' });
  ok('glob 跨目录 deny', o.includes('deny'), o.slice(0, 100));
}

// ── 账号级 / 对外不可逆操作 ────────────────────────────
{
  const o = w('mavis_agent_delete', { agent_name: 'x' });
  ok('删除成员被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 110));
}
{
  const o = w('website_deploy', { path: 'x' });
  ok('公网部署被拦', o.includes('deny') && o.includes('公网'), o.slice(0, 110));
}
{
  const o = w('mavis_agent_update', { agent_name: 'x' });
  ok('改账号级设置被拦', o.includes('deny'), o.slice(0, 110));
}
// 子代理没解析出 scope 时，账号级动作仍应被拦（scope 不保护账号级操作）
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'mavis_agent_delete', session_id: 'no-scope', agent_type: 'worker', tool_input: { agent_name: 'x' } });
  ok('无 scope 也拦账号级操作', o.includes('deny'), o.slice(0, 110));
}
// 无 scope 的子代理，普通读操作不拦
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'no-scope', agent_type: 'worker', tool_input: { path: 'anything.ts' } });
  ok('无 scope 时读不拦', o === '', o.slice(0, 80));
}
// Router 父会话不受账号级拦截约束（那是用户与上层权限的事）
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'mavis_agent_delete', session_id: 'router-s1', tool_input: { agent_name: 'x' } });
  ok('Router 会话不被账号级规则拦', o === '', o.slice(0, 110));
}

console.log(fail === 0 ? '>>> GUARD2 ALL PASS' : '>>> GUARD2 FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
