// 作用域验证：guard 只对「已登记 scope 的会话」生效，
// 不得误伤主会话（Router 自己）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = 'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-scope-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function run(script, payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload),
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA },
    encoding: 'utf8'
  });
  return (r.stdout || '').trim();
}

run('dispatch.mjs', {
  hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'worker-s1', turn_id: 't1',
  tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app/login.ts' }
});

{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'main-router', tool_input: { path: 'C:/anywhere/x.ts' } });
  ok('主会话读文件不被拦', o === '', o.slice(0, 80));
}

{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 'main-router', tool_input: { file_path: 'C:/anywhere/x.ts' } });
  ok('主会话写文件不被拦', o === '', o.slice(0, 80));
}

{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'worker-s1', tool_input: { path: 'config/prod.yaml' } });
  ok('派工会话读 scope 外被拦', o.includes('deny'), o.slice(0, 80));
}

{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 'worker-s1', tool_input: { file_path: 'config/prod.yaml' } });
  ok('派工会话写 scope 外被拦', o.includes('deny'), o.slice(0, 80));
}

{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'worker-s1', tool_input: { path: 'src/app/login.ts' } });
  ok('派工会话读 scope 内放行', o === '', o.slice(0, 80));
}

{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 'worker-s1', tool_input: { file_path: 'src/app/login.ts' } });
  ok('派工会话写 scope 内放行', o === '', o.slice(0, 80));
}

console.log(fail === 0 ? '>>> SCOPE ALL PASS' : '>>> SCOPE FAILURES: ' + fail);
process.exit(fail ? 1 : 0);