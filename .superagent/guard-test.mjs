import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = 'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
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

function guard(payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  return (r.stdout || '').trim();
}
function dispatch(scope, session) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: session, turn_id: 't',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: ' + scope }
    }),
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  return r.stdout || '';
}

// ── 场景 1：scope = src/app/login.ts（单文件） ──────────────────
dispatch('src/app/login.ts', 's1');

// 1a. 写 scope 内文件 → 放行
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 's1', tool_input: { file_path: 'src/app/login.ts' } });
  ok('写 scope 内文件放行', o === '', o.slice(0, 80));
}

// 1b. 写 scope 外文件 → deny
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 's1', tool_input: { file_path: 'config/prod.yaml' } });
  ok('写 scope 外文件 deny', o.includes('deny'), o.slice(0, 100));
}

// 1c. 绝对路径写 scope 内文件 → 放行（关键：路径归一化）
{
  const abs = path.join(PROJ, 'src', 'app', 'login.ts');
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 's1', tool_input: { file_path: abs } });
  ok('绝对路径写 scope 内放行', o === '', 'abs=' + abs + ' -> ' + o.slice(0, 100));
}

// 1d. 绝对路径写 scope 外文件 → deny
{
  const abs = path.join(PROJ, 'config', 'prod.yaml');
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 's1', tool_input: { file_path: abs } });
  ok('绝对路径写 scope 外 deny', o.includes('deny'), o.slice(0, 100));
}

// 1e. 读 scope 内文件 → 放行
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 's1', tool_input: { path: 'src/app/login.ts' } });
  ok('读 scope 内文件放行', o === '', o.slice(0, 80));
}

// 1f. 读同目录邻近文件 → 放行（读宽松：允许读 scope 所在目录树）
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 's1', tool_input: { path: 'src/app/session.ts' } });
  ok('读同目录邻近文件放行', o === '', o.slice(0, 80));
}

// 1g. 读完全无关目录 → deny
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 's1', tool_input: { path: 'config/prod.yaml' } });
  ok('读无关目录 deny', o.includes('deny'), o.slice(0, 100));
}

// 1h. glob 同目录 → 放行
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'glob', session_id: 's1', tool_input: { pattern: 'src/app/*.ts' } });
  ok('glob 同目录放行', o === '', o.slice(0, 80));
}

// 1i. glob 跨目录 → deny
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'glob', session_id: 's1', tool_input: { pattern: '**/*.ts' } });
  ok('glob 跨目录 deny', o.includes('deny'), o.slice(0, 100));
}

// ── 场景 2：账号级 / 对外不可逆操作 ────────────────────────────
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'mavis_agent_delete', session_id: 's1', tool_input: { agent_name: 'x' } });
  ok('删除成员被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 110));
}
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'website_deploy', session_id: 's1', tool_input: { path: 'x' } });
  ok('公网部署被拦', o.includes('deny') && o.includes('公网'), o.slice(0, 110));
}
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'mavis_agent_update', session_id: 's1', tool_input: { agent_name: 'x' } });
  ok('改账号级设置被拦', o.includes('deny'), o.slice(0, 110));
}

// 无 scope 会话时危险操作仍应被拦（账号级动作不受 scope 保护）
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'mavis_agent_delete', session_id: 'no-scope', tool_input: { agent_name: 'x' } });
  ok('无 scope 也拦账号级操作', o.includes('deny'), o.slice(0, 110));
}

// 未声明 scope 的会话，普通读操作不拦
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'no-scope', tool_input: { path: 'anything.ts' } });
  ok('无 scope 时读不拦', o === '', o.slice(0, 80));
}

console.log(fail === 0 ? '>>> GUARD2 ALL PASS' : '>>> GUARD2 FAILURES: ' + fail);
process.exit(fail ? 1 : 0);