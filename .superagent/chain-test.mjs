// 链路漏洞回归测试（v0.4.0）
// 用法：node .superagent/chain-test.mjs
//
// 锁住曾经真实存在的漏洞：
//   1. 派工不写 SCOPE 时，guard 形同虚设
//   2. 连续派工会覆盖前一条派工记录（前一个 worker 的 scope 丢失）
//   3. watchdog 被「搞定了」蒙混过关
//   4. watchdog 不验证声称的文件是否真的存在
//   5. worker 在子会话里查不到自己的 scope（越界管控对 worker 失效）
//   6. Router 父会话被 worker 的 scope 误伤
//   7. 组队时 scope 重叠无人检测
//   8. 单会话派工数无上限
//   9. worker 结束后在飞名额不回收，会话把自己锁死
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

const dispatch = (session, turn, agent, scope) => hook('dispatch.mjs', {
  hook_event_name: 'PreToolUse', tool_name: 'task', session_id: session, turn_id: turn,
  tool_input: { agent_name: agent, prompt: 'SCOPE: ' + scope }
});

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
  dispatch('c2', 't1', 'sa-a-b', 'src/aaa.ts');
  dispatch('c2', 't2', 'sa-c-d', 'src/ccc.ts');
  const led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const mine = led.dispatches.filter((d) => d.parent_session_id === 'c2');
  ok('连续派工保留两条记录', mine.length === 2, '记录数=' + mine.length);
  ok('两条 scope 都不同且都在', mine.length === 2 && mine[0].scope[0] === 'src/aaa.ts' && mine[1].scope[0] === 'src/ccc.ts', JSON.stringify(mine.map((m) => m.scope)));
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

// 6. 组队：scope 重叠的派工必须被拒
{
  dispatch('c3', 't1', 'sa-a-b', 'src/aaa.ts');
  const d2 = dispatch('c3', 't2', 'sa-c-d', 'src/aaa.ts');
  ok('scope 重叠的派工被拒', d2.out.includes('deny') && d2.out.includes('组队冲突'), d2.out.slice(0, 140));
  const d3 = dispatch('c3', 't3', 'sa-c-d', 'src/bbb.ts');
  ok('不重叠的 scope 可以派工', !d3.out.includes('deny'), d3.out.slice(0, 140));
}

// 7. 组队：目录 scope 与其下文件也算重叠
{
  dispatch('c4', 't1', 'sa-a-b', 'src/');
  const d = dispatch('c4', 't2', 'sa-c-d', 'src/deep/x.ts');
  ok('目录 scope 与其下文件重叠被拒', d.out.includes('deny'), d.out.slice(0, 140));
}

// 8. 组队：单会话派工数超限必须被拒
{
  let denied = null;
  for (let i = 0; i < 9; i++) {
    const d = dispatch('c5', 't' + i, 'sa-x-' + i, 'src/f' + i + '.ts');
    if (d.out.includes('deny')) { denied = { i, out: d.out }; break; }
  }
  ok('单会话派工数超限被拒', denied !== null, denied ? ('第' + (denied.i + 1) + '次被拒') : '一直没被拒');
  ok('超限提示指向派工上限', denied !== null && denied.out.includes('上限'), denied ? denied.out.slice(0, 140) : '');
}

// 9. Router 父会话不被 worker 的 scope 约束；worker 受自己的 scope 约束
{
  const P = 'c6';
  const W = 'c6-worker';
  const tr = makeTranscript(W, P, 'sa-a-b', 'src/only.ts');
  dispatch(P, 't1', 'sa-a-b', 'src/only.ts');
  const r = hook('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: P,
    tool_input: { file_path: 'config/prod.yaml' }
  });
  ok('Router 会话不被 worker scope 约束', r.out === '', r.out.slice(0, 120));
  const w2 = hook('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: W,
    agent_id: W, agent_type: 'sa-a-b', transcript_path: tr,
    tool_input: { file_path: 'config/prod.yaml' }
  });
  ok('worker 会话被自己的 scope 约束', w2.out.includes('deny'), w2.out.slice(0, 120));
  const w3 = hook('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: W,
    agent_id: W, agent_type: 'sa-a-b', transcript_path: tr,
    tool_input: { file_path: 'src/only.ts' }
  });
  ok('worker 写自己 scope 内放行', w3.out === '', w3.out.slice(0, 120));
}

// 10. worker 结束后在飞名额回收：同一 scope 可以再次派工
{
  const P = 'c7';
  const W = 'c7-worker';
  fs.writeFileSync(path.join(PROJ, 'src', 'recycle.ts'), 'export const a = 1;', 'utf8');
  const tr = makeTranscript(W, P, 'sa-a-b', 'src/recycle.ts');
  dispatch(P, 't1', 'sa-a-b', 'src/recycle.ts');
  // worker 的第一次工具调用建立绑定
  hook('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: W,
    agent_id: W, agent_type: 'sa-a-b', transcript_path: tr,
    tool_input: { file_path: 'src/recycle.ts' }
  });
  // worker 结束 -> 回收在飞名额
  hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', session_id: W, agent_id: W, agent_type: 'sa-a-b',
    transcript_path: tr,
    last_assistant_message: '已完成，改动文件 src/recycle.ts，测试通过'
  });
  const d = dispatch(P, 't2', 'sa-a-b', 'src/recycle.ts');
  ok('worker 结束后同一 scope 可再派工', !d.out.includes('deny'), d.out.slice(0, 140));
}

// 11. worker 能读自己的方法论与错题本（方法论是「做到精」的载体，不能被 scope 挡在门外）
{
  const P = 'c8';
  const W = 'c8-worker';
  const AG = 'sa-x-method';
  fs.mkdirSync(path.join(PROJ, '.superagent', 'methods'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', AG + '.md'), '# 方法论\n', 'utf8');
  const tr = makeTranscript(W, P, AG, 'src/only.ts');
  const m = path.join(PROJ, '.superagent', 'methods', AG + '.md');
  const o = hook('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: W,
    agent_id: W, agent_type: AG, transcript_path: tr,
    tool_input: { path: m }
  });
  ok('worker 能读自己的方法论文件', o.out === '', o.out.slice(0, 140));
}

// 12. 版本号与裸文件名不是「声称产出的文件」，不应触发拦截
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，版本升到 0.4.0，改动文件 plugin.json，hooks.json 已核对，测试通过'
  });
  ok('版本号/裸文件名不触发文件存在性拦截', w.out === '', w.out.slice(0, 160));
}

// 13. miniapp 发布被拦（工具名两种写法都要拦）
{
  const o = hook('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'miniapp', session_id: 'c9', agent_id: 'c9', agent_type: 'worker', tool_input: { action: 'publish' } });
  ok('miniapp 发布被拦', o.out.includes('deny'), o.out.slice(0, 120));
  const o2 = hook('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'miniapp_publish', session_id: 'c9', agent_id: 'c9', agent_type: 'worker', tool_input: { action: 'publish' } });
  ok('miniapp_publish 被拦', o2.out.includes('deny'), o2.out.slice(0, 120));
}

// 14. 交付报告里「引用 / 核对」到的路径不算声称产出
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，版本 0.4.0。\n核对引用了 plugin/hooks/hooks.json 与 plugin/scripts/gate.mjs，测试通过'
  });
  ok('报告里引用到的路径不被当成产出', w.out === '', w.out.slice(0, 160));
}

// 15. scope 可以写带盘符的绝对路径（否则装到工作区之外的目录无法声明边界）
{
  const s = 'c10';
  const abs = 'C:/tmp/sar-abs/thing.txt';
  const d = dispatch(s, 't1', 'sa-abs', abs);
  ok('带盘符的绝对路径可写入 scope', !d.out.includes('deny'), d.out.slice(0, 140));
}

console.log(fail === 0 ? '>>> CHAIN ALL PASS' : '>>> CHAIN FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
