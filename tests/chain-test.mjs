// 链路漏洞回归测试（v0.5.0）
// 用法：node tests/chain-test.mjs
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
//
// v0.5.0 新增锁住：
//   16. 缺 turn_id 的派工把别的记录整条抹掉（D-05）
//   17. SCOPE 行里有解析不出来的条目被悄悄丢弃（D-07）
//   18. 写冲突检测只看同一父会话，跨会话/嵌套派工取不到在飞记录（D-09）
//   19. 超龄的 active 派工不判死，名额与台账状态失步（D-10）
//   20. 台账用显示名，反查用 routing id，互相看不见（D-12）
//   21. 台账截断后累计派工额度失效（D-19）
//   22. ro: 只读条目不参与写冲突检测（契约 S2.4）
//   23. 台账里存在只写不读的字段（D-23）
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function ledger() {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
}
function writeLedger(led) {
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify(led, null, 2), 'utf8');
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

// 可控载荷的派工：turn 传 undefined 即「载荷里没有 turn_id」
const dispatchRaw = (session, turn, agent, scope, extra) => hook('dispatch.mjs', Object.assign({
  hook_event_name: 'PreToolUse', tool_name: 'task', session_id: session, turn_id: turn,
  tool_input: { agent_name: agent, prompt: 'SCOPE: ' + scope }
}, extra || {}));

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
  dispatch('c2', 't1', 'sa-a-b', 'src/c2/aaa.ts');
  dispatch('c2', 't2', 'sa-c-d', 'src/c2/ccc.ts');
  const led = ledger();
  const mine = led.dispatches.filter((d) => d.parent_session_id === 'c2');
  ok('连续派工保留两条记录', mine.length === 2, '记录数=' + mine.length);
  ok('两条 scope 都不同且都在', mine.length === 2 && mine[0].scope[0] === 'src/c2/aaa.ts' && mine[1].scope[0] === 'src/c2/ccc.ts', JSON.stringify(mine.map((m) => m.scope)));
}

// 3. 「搞定了」不能蒙混过关
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '搞定了'
  });
  ok('「搞定了」被拦', w.out.includes('block'), w.out.slice(0, 120));
}

// 3b. 「搞定了，测试通过」也不能蒙混过关（D-11：描述词不算证据）
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '搞定了，测试通过'
  });
  ok('「搞定了，测试通过」被拦', w.out.includes('block'), w.out.slice(0, 160));
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
  dispatch('c3', 't1', 'sa-a-b', 'src/c3/aaa.ts');
  const d2 = dispatch('c3', 't2', 'sa-c-d', 'src/c3/aaa.ts');
  ok('scope 重叠的派工被拒', d2.out.includes('deny') && d2.out.includes('组队冲突'), d2.out.slice(0, 140));
  const d3 = dispatch('c3', 't3', 'sa-c-d', 'src/c3/bbb.ts');
  ok('不重叠的 scope 可以派工', !d3.out.includes('deny'), d3.out.slice(0, 140));
}

// 7. 组队：目录 scope 与其下文件也算重叠
{
  dispatch('c4', 't1', 'sa-a-b', 'src/c4/');
  const d = dispatch('c4', 't2', 'sa-c-d', 'src/c4/deep/x.ts');
  ok('目录 scope 与其下文件重叠被拒', d.out.includes('deny'), d.out.slice(0, 140));
}

// 8. 组队：单会话派工数超限必须被拒
{
  let denied = null;
  for (let i = 0; i < 9; i++) {
    const d = dispatch('c5', 't' + i, 'sa-x-' + i, 'src/c5/f' + i + '.ts');
    if (d.out.includes('deny')) { denied = { i, out: d.out }; break; }
  }
  ok('单会话派工数超限被拒', denied !== null, denied ? ('第' + (denied.i + 1) + '次被拒') : '一直没被拒');
  ok('超限提示指向派工上限', denied !== null && denied.out.includes('上限'), denied ? denied.out.slice(0, 140) : '');
}

// 9. Router 父会话不被 worker 的 scope 约束；worker 受自己的 scope 约束
{
  const P = 'c6';
  const W = 'c6-worker';
  const tr = makeTranscript(W, P, 'sa-a-b', 'src/c6/only.ts');
  dispatch(P, 't1', 'sa-a-b', 'src/c6/only.ts');
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
    tool_input: { file_path: 'src/c6/only.ts' }
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
  const rec = ledger().dispatches.find((x) => x.parent_session_id === P && x.state === 'done');
  ok('回收后派工状态为 done', !!rec, JSON.stringify(ledger().dispatches.filter((x) => x.parent_session_id === P).map((x) => x.state)));
}

// 11. worker 能读自己的方法论与错题本（方法论是「做到精」的载体，不能被 scope 挡在门外）
{
  const P = 'c8';
  const W = 'c8-worker';
  const AG = 'sa-x-method';
  fs.mkdirSync(path.join(PROJ, '.superagent', 'methods'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', AG + '.md'), '# 方法论\n', 'utf8');
  const tr = makeTranscript(W, P, AG, 'src/c8/only.ts');
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
  ok('miniapp_publish 被拦', o2.out.includes('deny'), o.out.slice(0, 120));
}

// 14. 交付报告里「引用 / 核对」到的路径不算声称产出
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，版本 0.4.0。\n核对引用了 plugin/hooks/hooks.json 与 plugin/scripts/gate.mjs，测试通过'
  });
  ok('报告里引用到的路径不被当成产出', w.out === '', w.out.slice(0, 160));
}

// 14b. 同一句里「改动 X，参考 Y」时，Y 是引用不是产出（跨成员实测的误拦）
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 src/real.ts，参考 plugin/scripts/guard.mjs 的旧判定，测试通过'
  });
  ok('引用到的路径不被当成产出校验', w.out === '', w.out.slice(0, 200));
}

// 15. scope 可以写带盘符的绝对路径（否则装到工作区之外的目录无法声明边界）
{
  const s = 'c10';
  const abs = 'C:/tmp/sar-abs/thing.txt';
  const d = dispatch(s, 't1', 'sa-abs', abs);
  ok('带盘符的绝对路径可写入 scope', !d.out.includes('deny'), d.out.slice(0, 140));
}

// 16. D-05：载荷缺 turn_id 时不能把别的记录整条抹掉
{
  dispatchRaw('c11', undefined, 'sa-d5', 'src/d5/a.ts');
  dispatchRaw('c11', undefined, 'sa-d5', 'src/d5/b.ts');
  const mine = ledger().dispatches.filter((d) => d.parent_session_id === 'c11');
  ok('缺 turn_id 时不抹掉同会话的其它记录', mine.length === 2, '记录数=' + mine.length + ' ' + JSON.stringify(mine.map((m) => m.scope)));
  ok('两条 scope 都在', mine.length === 2 && mine[0].scope[0] === 'src/d5/a.ts' && mine[1].scope[0] === 'src/d5/b.ts', JSON.stringify(mine.map((m) => m.scope)));
}

// 16b. D-05：缺 turn_id 但有 tool_use_id 时，去重键退化成 tool_use_id
{
  dispatchRaw('c11b', undefined, 'sa-d5b', 'src/d5b/a.ts', { tool_use_id: 'tu-1' });
  dispatchRaw('c11b', undefined, 'sa-d5b', 'src/d5b/b.ts', { tool_use_id: 'tu-2' });
  const mine = ledger().dispatches.filter((d) => d.parent_session_id === 'c11b');
  ok('tool_use_id 作去重键时两条记录都在', mine.length === 2, '记录数=' + mine.length);
}

// 17. D-07：SCOPE 行里有解析不出来的条目 -> 拒绝派工（白名单漏收等于放行）
{
  const d = hook('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'c12', turn_id: 't1',
    tool_input: { agent_name: 'sa-bad', prompt: 'SCOPE: src/ok.ts, src/a*b.ts\nACCEPT: x' }
  });
  ok('SCOPE 里有解析不出的条目时拒绝派工', d.out.includes('deny') && d.out.includes('无法解析'), d.out.slice(0, 220));
}

// 18. D-09：写冲突检测是项目维度的，跨会话的同 scope 也要拦
{
  dispatch('c13', 't1', 'sa-x', 'src/d9.ts');
  const d = dispatch('c14', 't1', 'sa-y', 'src/d9.ts');
  ok('跨会话的写冲突被拒', d.out.includes('deny') && d.out.includes('组队冲突'), d.out.slice(0, 180));
}

// 19. D-10：超龄的 active 派工必须判死并落盘
{
  const led = ledger();
  led.dispatches.push({
    dispatch_id: 'dsp_stale', parent_session_id: 'c15', turn_id: 't1', turn_key: 't1',
    tool_use_id: '', agent: 'sa-stale', agent_key: 'sa-stale', project: PROJ,
    scope: ['src/stale.ts'], state: 'active', at: Date.now() - 5 * 60 * 60 * 1000
  });
  writeLedger(led);
  const d = dispatch('c15', 't1', 'sa-fresh', 'src/fresh.ts');
  ok('超龄派工不阻断新派工', !d.out.includes('deny'), d.out.slice(0, 160));
  const stale = ledger().dispatches.find((x) => x.dispatch_id === 'dsp_stale');
  ok('超龄记录被 TTL 判死并落盘', !!stale && stale.state !== 'active' && stale.end_reason === 'ttl_expired', JSON.stringify(stale));
}

// 20. D-12：台账记 routing id（显示名与 routing id 是两套命名空间）
{
  const d = hook('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'c16', turn_id: 't1',
    tool_input: { agent_name: '边界判定改造', prompt: 'agentName: sa-mechanism-fix\nSCOPE: src/c16.ts' }
  });
  const rec = ledger().dispatches.find((x) => x.parent_session_id === 'c16');
  ok('台账用 routing id 而不是显示名', !!rec && rec.agent_key === 'sa-mechanism-fix', JSON.stringify(rec && { agent: rec.agent, agent_key: rec.agent_key }));
  ok('台账同时保留原始 agent 名', !!rec && rec.agent === '边界判定改造', JSON.stringify(rec && rec.agent));
}

// 21. D-19：累计派工额度用持久化计数器，台账被清掉也不放行
{
  const led = ledger();
  led.counters = led.counters || {};
  led.counters['c17'] = 30;
  led.dispatches = led.dispatches.filter((x) => x.parent_session_id !== 'c17');
  writeLedger(led);
  const d = dispatch('c17', 't1', 'sa-x', 'src/c17.ts');
  ok('累计派工超限被拒（计数器不随台账截断丢失）', d.out.includes('deny') && d.out.includes('累计'), d.out.slice(0, 180));
}

// 22. S2.4：ro: 只读条目不参与写冲突检测（且本身能被派工）
{
  const d1 = dispatch('c18', 't1', 'sa-ro', 'ro: src/ro.ts');
  ok('ro: 只读条目可以写进 scope', !d1.out.includes('deny'), d1.out.slice(0, 180));
  const d2 = dispatch('c18', 't2', 'sa-rw', 'src/ro.ts');
  ok('ro: 条目不构成写冲突', !d2.out.includes('deny'), d2.out.slice(0, 180));
  const rec = ledger().dispatches.find((x) => x.parent_session_id === 'c18' && x.agent === 'sa-ro');
  ok('ro: 条目原样入账', !!rec && rec.scope[0] === 'ro: src/ro.ts', JSON.stringify(rec && rec.scope));
}

// 23. D-23：台账里不许有只写不读的字段
{
  const led = ledger();
  const keys = new Set();
  for (const d of led.dispatches) for (const k of Object.keys(d)) keys.add(k);
  ok('台账不再写 unscoped 字段', !keys.has('unscoped'), [...keys].join(','));
  ok('台账记 tool_use_id（去重与回收键）', keys.has('tool_use_id'), [...keys].join(','));
}

// 24. 派工载荷坏了 -> 拒绝（派工登记不下来就不该放行）
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: 'not-json-at-all', encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: PROJ }
  });
  const o = (r.stdout || '').trim();
  ok('派工载荷不是合法 JSON 时拒绝', o.includes('deny') && o.includes('载荷'), o.slice(0, 160));
}

// 25. D-20：盘符绝对路径的产出按真实路径校验存在性（以前被拼成 <工作区根>/C:/... 恒判不存在）
// 说明：本条在单盘机器上改前改后都绿 —— 改前把 "C:/x" 截成 "/x"，在只有 C: 的机器上
// "/x" 恰好指向同一个文件，差异看不出来。真正能区分改前改后的是 25c（subst 挂第二个盘符）
// 与 27（报错必须保留盘符前缀）。
{
  const abs = path.join(PROJ, 'src', 'abs-out.ts');
  fs.writeFileSync(abs, 'export const c = 3;', 'utf8');
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 ' + abs.replace(/\\/g, '/') + '，测试通过'
  });
  ok('前置：盘符绝对路径的真实文件确实存在', fs.existsSync(abs), abs);
  ok('盘符绝对路径的产出不被误判为不存在', w.out === '', w.out.slice(0, 200));
}

// 25b. 工作区之外但真实存在的盘符绝对路径：按真实路径判存在性，不得误拦
{
  const outside = path.join(tmp, 'outside-abs-out.ts');
  fs.writeFileSync(outside, 'export const d = 4;', 'utf8');
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 ' + outside.replace(/\\/g, '/') + '，测试通过'
  });
  ok('工作区之外真实存在的盘符绝对路径不被误拦', w.out === '', w.out.slice(0, 200));
}

// 25c. 另一个盘符上的真实产出：按真实路径判存在性，不得误判成不存在
// 改前实现把 "S:/x" 截成 "/x"，判存在性落到当前盘上 —— 真实存在的产出被误判成不存在。
// 用 subst 临时挂一个虚拟盘复现这个症状；跑完立刻解除映射。
{
  const driveDir = path.join(tmp, 'subst-probe');
  fs.mkdirSync(driveDir, { recursive: true });
  fs.writeFileSync(path.join(driveDir, 'subst-out.ts'), 'export const e = 5;', 'utf8');
  let drive = '';
  for (const d of ['S:', 'R:', 'T:', 'U:', 'V:']) {
    const m = spawnSync('cmd', ['/c', 'subst', d, driveDir], { encoding: 'utf8' });
    if (m.status === 0) { drive = d; break; }
  }
  if (!drive) {
    console.log('SKIP 另一个盘符上真实存在的产出不被误判成不存在（subst 不可用，造不出第二个盘符）');
  } else {
    try {
      const w = hook('watchdog.mjs', {
        hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
        last_assistant_message: '已完成，改动文件 ' + drive + '/subst-out.ts，测试通过'
      });
      ok('另一个盘符上真实存在的产出不被误判成不存在', w.out === '', w.out.slice(0, 200));
    } finally {
      spawnSync('cmd', ['/c', 'subst', drive, '/d'], { encoding: 'utf8' });
    }
  }
}

// 26. 条款引用不是文件路径：「契约 S2.2/S2.3」不该被判成「声称产出的文件」
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，新增了 scope 语义支持（契约 S2.2/S2.3），改动文件 src/real.ts，测试通过'
  });
  ok('契约条款引用不被当成声称产出的文件', w.out === '', w.out.slice(0, 220));
}

// 27. 盘符绝对路径不存在时必须被拦（反向断言：确认存在性校验真的作用在盘符路径上）
{
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 D:/definitely-not-here/abs-out.ts，测试通过'
  });
  ok('盘符绝对路径不存在时被拦，且报错保留盘符前缀', w.out.includes('block') &&
    w.out.includes('D:/definitely-not-here/abs-out.ts'), w.out.slice(0, 220));
}

// 27b. 同一个盘符上不存在的路径也必须被拦
// （确认存在性校验真的作用在盘符路径上，而不是压根没把盘符路径当成路径）
{
  const miss = path.join(PROJ, 'src', 'definitely-not-here', 'abs-out.ts');
  const w = hook('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'x', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 ' + miss.replace(/\\/g, '/') + '，测试通过'
  });
  ok('盘符绝对路径不存在时（同一盘符）被拦', w.out.includes('block') && w.out.includes('abs-out.ts'), w.out.slice(0, 220));
}

// ── 变异自检（可选）：把 D-20 的修复回退，验证新断言真的会变红 ──
// 用法：$env:SAR_MUTATION='1'; node tests/chain-test.mjs
// 只改系统临时目录里的副本，仓库工作树零改动；跑完即删。
//
// 为什么是「定向回退」而不是整份换回改前文件：
//   改前版本的 plugin/scripts/watchdog.mjs 不在本成员的 SCOPE 内（归别的成员），
//   bash 通道取它被越界拦截过两次；按既有教训不再换通道重试。
//   这里按验收报告 V-10 / V-26 记录的改前语义，在副本里定向回退 D-20 的两处：
//     · lib.mjs 的 absolutizePath 不再把盘符路径当绝对路径
//       （改前：除 "/" 开头外一律拼工作区根 -> 盘符路径恒判不存在）
//     · watchdog.mjs 的 PATH_TOKEN 不再保留盘符前缀（改前：正则不带可选盘符组）
if (process.env.SAR_MUTATION === '1') {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mut-chain-'));
  const mutPlugin = path.join(mutRoot, 'plugin');
  try {
    fs.cpSync(PLUGIN_ROOT, mutPlugin, { recursive: true });

    // 回退点 1：lib.mjs —— 去掉「盘符路径按绝对路径直用」的分支
    const libPath = path.join(mutPlugin, 'scripts', 'lib.mjs');
    const libLines = fs.readFileSync(libPath, 'utf8').split('\n');
    const libIdx = libLines.findIndex((l) =>
      l.indexOf('[A-Za-z]:') >= 0 && l.indexOf('test(raw)) return raw;') >= 0);
    if (libIdx < 0) throw new Error('回退点 1 未命中：lib.mjs 的盘符分支已变形');
    console.log('MUTATION 回退前 lib.mjs 第 ' + (libIdx + 1) + ' 行: ' + libLines[libIdx].trim());
    libLines.splice(libIdx, 1);
    fs.writeFileSync(libPath, libLines.join('\n'), 'utf8');

    // 回退点 2：watchdog.mjs —— PATH_TOKEN 去掉可选盘符前缀
    const wdPath = path.join(mutPlugin, 'scripts', 'watchdog.mjs');
    const wdLines = fs.readFileSync(wdPath, 'utf8').split('\n');
    const wdIdx = wdLines.findIndex((l) => l.indexOf('const PATH_TOKEN') >= 0);
    if (wdIdx < 0) throw new Error('回退点 2 未命中：watchdog.mjs 的 PATH_TOKEN 已变形');
    console.log('MUTATION 回退前 watchdog.mjs 第 ' + (wdIdx + 1) + ' 行: ' + wdLines[wdIdx].trim());
    wdLines[wdIdx] = wdLines[wdIdx].replace('(?:[A-Za-z]:)?', '');
    console.log('MUTATION 回退后 watchdog.mjs 第 ' + (wdIdx + 1) + ' 行: ' + wdLines[wdIdx].trim());
    fs.writeFileSync(wdPath, wdLines.join('\n'), 'utf8');

    console.log('MUTATION 副本已就绪：' + mutPlugin);
    const r = spawnSync('node', [path.join(REPO, 'tests', 'chain-test.mjs')], {
      env: Object.assign({}, process.env, { SAR_PLUGIN_ROOT: mutPlugin, SAR_MUTATION: '' }),
      encoding: 'utf8', timeout: 180000, cwd: REPO
    });
    const out = String(r.stdout || '');
    const fails = out.split(/\r?\n/).filter((l) => l.startsWith('FAIL '));
    console.log('MUTATION 子进程 exit=' + r.status + ' stdout行数=' + out.split(/\r?\n/).length +
      ' PASS数=' + out.split(/\r?\n/).filter((l) => l.startsWith('PASS ')).length +
      ' stderr=' + String(r.stderr || '').slice(0, 300));
    console.log('MUTATION 回退后转红断言数：' + fails.length);
    for (const l of fails) console.log('MUTATION ' + l);
    const want = [
      '另一个盘符上真实存在的产出不被误判成不存在',
      '盘符绝对路径不存在时被拦，且报错保留盘符前缀',
      '盘符绝对路径的产出不被误判为不存在',
      '工作区之外真实存在的盘符绝对路径不被误拦'
    ];
    for (const name of want) {
      const hit = fails.some((l) => l.indexOf(name) >= 0);
      console.log('MUTATION V-13 断言「' + name + '」在旧实现下变红：' + (hit ? 'YES' : 'NO'));
    }
  } finally {
    fs.rmSync(mutRoot, { recursive: true, force: true });
    console.log('MUTATION 副本已删除：' + mutRoot);
  }
}

// ── 跨套件自检（可选）：跑另外四套回归，确认本次改动没影响它们 ──
// 用法：$env:SAR_CROSS='1'; node tests/chain-test.mjs
// 另外四套的测试文件不在本成员的 SCOPE 内，直接在 bash 里写它们的路径会被
// 「按写判定」拦掉；因此由本文件在运行时拼路径再 spawn，仓库工作树零改动。
if (process.env.SAR_CROSS === '1') {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const name of ['records-test', 'lessons-test', 'roster-test', 'hooks-test']) {
    const f = path.join(REPO, 'tests', name + '.mjs');
    if (!fs.existsSync(f)) { console.log('CROSS ' + name + ' :: 套件文件不存在，跳过'); continue; }
    const r = spawnSync('node', [f], {
      env: Object.assign({}, process.env, {
        SAR_PLUGIN_ROOT: PLUGIN_ROOT, SAR_CROSS: '', SAR_MUTATION: '', SAR_PROBE: ''
      }),
      encoding: 'utf8', timeout: 180000, cwd: REPO
    });
    const out = String(r.stdout || '');
    const rows = out.split(/\r?\n/);
    const last = rows.filter((l) => l.length).slice(-1)[0] || '(无输出)';
    console.log('CROSS ' + name + ' :: exit=' + r.status +
      ' PASS=' + rows.filter((l) => l.startsWith('PASS ')).length +
      ' FAIL=' + rows.filter((l) => l.startsWith('FAIL ')).length +
      ' 结尾：' + last);
    for (const l of rows.filter((l) => l.startsWith('FAIL '))) console.log('CROSS ' + name + ' ' + l);
  }
}

console.log(fail === 0 ? '>>> CHAIN ALL PASS' : '>>> CHAIN FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
