// super-agent-router 回归测试
// 用法：node .superagent/e2e-test.mjs
// 断言插件的三个 Hook 在真实 stdin/stdout 契约下的行为。
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
  const d = led.dispatches.find(x => x.session_id === scopeSession);
  ok('scope 只收路径', JSON.stringify(d.scope) === JSON.stringify(['src/app.ts', 'src/util.ts']), JSON.stringify(d.scope));
}

// 3. 越界拦截
{
  const r1 = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: scopeSession, tool_input: { file_path: 'src/app.ts' } });
  ok('scope 内文件放行', r1.out === '');
  const r2 = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: scopeSession, tool_input: { file_path: 'config/prod.yaml' } });
  ok('scope 外文件 deny', r2.out.includes('deny'));
  const r3 = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'bash', session_id: scopeSession, tool_input: { command: 'rm -rf config/prod.yaml' } });
  ok('bash 越界 deny', r3.out.includes('deny'));
}
{
  const r = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: 'no-scope', tool_input: { file_path: 'any/x.ts' } });
  ok('无 scope 不拦', r.out === '');
}

// 4. Watchdog：空交付与无证据 block，有证据放行
{
  const a = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '' });
  ok('空交付 block', a.out.includes('block'));
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已经完成修复了' });
  ok('无证据声称完成 block', b.out.includes('block'));
  // watchdog 现在会校验声称的文件是否真的存在，先把文件造出来
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const a = 1;', 'utf8');
  const c = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已修复。改动文件 src/app.ts，测试命令 npm test 全部通过', cwd: tmp });
  ok('有证据放行', c.out === '');
}

// 5. 读类工具纳入管控
{
  const scopeSession = 'e-read';
  const dr = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: scopeSession, turn_id: 'rt1',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app/login.ts' }
    }),
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA }
  });
  const g = (toolName, input) => {
    const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, session_id: scopeSession, tool_input: input }),
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA }
    });
    return (r.stdout || '').trim();
  };
  ok('读 scope 内文件放行', g('read', { path: 'src/app/login.ts' }) === '');
  ok('读同目录邻近文件放行', g('read', { path: 'src/app/session.ts' }) === '');
  ok('读无关目录 deny', g('read', { path: 'config/prod.yaml' }).includes('deny'));
  ok('glob 同目录放行', g('glob', { pattern: 'src/app/*.ts' }) === '');
  ok('glob 跨目录 deny', g('glob', { pattern: '**/*.ts' }).includes('deny'));
}

// 6. 危险操作一律拦（不受 scope 保护）
{
  const g = (toolName, input, sid) => {
    const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, session_id: sid || 'no-scope', tool_input: input }),
      encoding: 'utf8',
      env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA }
    });
    return (r.stdout || '').trim();
  };
  ok('删除成员被拦', g('mavis_agent_delete', { agent_name: 'x' }).includes('deny'));
  ok('公网部署被拦', g('website_deploy', { path: 'x' }).includes('deny'));
  ok('改成员配置被拦', g('mavis_agent_update', { agent_name: 'x' }).includes('deny'));
}

console.log(fail === 0 ? '>>> E2E ALL PASS' : '>>> E2E FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
