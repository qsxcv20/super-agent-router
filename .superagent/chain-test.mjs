// 链路漏洞回归测试（v0.3.2）
// 用法：node .superagent/chain-test.mjs
//
// 锁住四个曾经真实存在的漏洞：
//   1. 派工不写 SCOPE 时，guard 形同虚设
//   2. 连续派工会覆盖前一条派工记录（前一个 worker 的 scope 丢失）
//   3. watchdog 被「搞定了」蒙混过关
//   4. watchdog 不验证声称的文件是否真的存在
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-chain-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function hook(script, payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: PROJ }
  });
  return { out: (r.stdout || '').trim(), code: r.status };
}

// 1. 派工必须写 SCOPE，否则拒绝派工
{
  const d = hook('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'c1', turn_id: 't1',
    tool_input: { agent_name: 'worker', prompt: '随便做点事，别管范围' }
  });
  ok('无 SCOPE 的派工被拒绝', d.out.includes('deny') || d.out.includes('ask'), d.out.slice(0, 160));
}

// 2. 连续派工不覆盖前一条
{
  hook('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'c2', turn_id: 't1',
    tool_input: { agent_name: 'sa-a-b', prompt: 'SCOPE: src/aaa.ts' }
  });
  hook('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'c2', turn_id: 't2',
    tool_input: { agent_name: 'sa-c-d', prompt: 'SCOPE: src/ccc.ts' }
  });
  const led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const mine = led.dispatches.filter(d => d.session_id === 'c2');
  ok('连续派工保留两条记录', mine.length === 2, '记录数=' + mine.length);
  ok('两条 scope 都不同且都在', mine.length === 2 && mine[0].scope[0] === 'src/aaa.ts' && mine[1].scope[0] === 'src/ccc.ts', JSON.stringify(mine.map(m => m.scope)));
}

// 3. 「搞定了」不能蒙混过关
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '搞定了'
  });
  ok('「搞定了」被拦', w.out.includes('block'), w.out.slice(0, 120));
}

// 4. 声称的文件不存在时必须拦
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 src/ghost-file.ts，测试通过'
  });
  ok('声称的文件不存在被拦', w.out.includes('block') && w.out.includes('ghost-file.ts'), w.out.slice(0, 160));
}

// 5. 文件真实存在时应放行
{
  fs.writeFileSync(path.join(PROJ, 'src', 'real.ts'), 'export const a = 1;', 'utf8');
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 src/real.ts，测试通过'
  });
  ok('文件真实存在则放行', w.out === '', w.out.slice(0, 120));
}

console.log(fail === 0 ? '>>> CHAIN ALL PASS' : '>>> CHAIN FAILURES: ' + fail);
process.exit(fail ? 1 : 0);