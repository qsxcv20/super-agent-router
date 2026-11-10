// 派工名额显式释放（release-slot.mjs）回归测试
// 用法：node tests/dispatch-release-test.mjs
//   默认跑安装副本；跑仓库副本请显式指定：
//   $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\dispatch-release-test.mjs
//
// 验证这些事（D-28）：
//   1. 缺 payload / 非法 JSON / 台账读不出来 → 报错退出，不静默成功
//   2. 释放单条 active → state 变 aborted、end_reason 落盘、在飞数减少
//   3. done / aborted 的记录一个字节都不动（不重复释放、不改写历史）
//   4. 未知 dispatch_id → 报错，且在飞数不变（不许「以为放掉了其实还占着」）
//   5. parent_session_id 释放该父会话下全部 active，别人的不动
//   6. agent 收窄生效
//   7. --data-dir 与 PLUGIN_DATA 两种入口都认
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'release-slot.mjs');

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function seed(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-release-'));
  fs.writeFileSync(path.join(dir, 'dispatches.json'), JSON.stringify({ dispatches: records, bindings: [], counters: {} }, null, 2), 'utf8');
  return dir;
}
function readLedger(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'dispatches.json'), 'utf8')); } catch { return null; }
}
function run(dir, args, env = {}) {
  const r = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: dir, ...env }
  });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = { raw: r.stdout, err: r.stderr }; }
  return { code: r.status, out };
}

const NOW = Date.now();
const base = (id, over = {}) => Object.assign({
  dispatch_id: id,
  parent_session_id: 'mvs_parent_a',
  turn_id: 't1',
  tool_use_id: 'call_' + id,
  agent: 'sa-mechanism-fix',
  scope: ['a.ts'],
  unscoped: false,
  lessons: [],
  lesson_count: 0,
  records: [],
  record_count: 0,
  state: 'active',
  at: NOW
}, over);

// ── 1. 参数与台账不可读 → 必须报错 ──────────────────────
{
  const dir = seed([base('dsp_a')]);
  const r = run(dir, []);
  ok('缺 payload 报错退出', r.code === 1 && r.out.ok === false, 'code=' + r.code);
}
{
  const dir = seed([base('dsp_a')]);
  const r = run(dir, ['{not json']);
  ok('非法 JSON 报错退出', r.code === 1 && r.out.ok === false, 'code=' + r.code);
}
{
  const missing = path.join(os.tmpdir(), 'sar-release-missing-' + Date.now());
  const r = run(missing, ['{"dispatch_id":"dsp_x"}']);
  ok('台账目录不存在 → 报错不释放', r.code === 1 && r.out.ok === false, 'code=' + r.code);
}

// ── 2. 释放单条 active ────────────────────────────────
{
  const dir = seed([base('dsp_a'), base('dsp_b', { agent: 'sa-gate-integrity' })]);
  const r = run(dir, [JSON.stringify({ dispatch_id: 'dsp_a', reason: 'parent_cancelled' })]);
  const led = readLedger(dir);
  const a = led.dispatches.find((d) => d.dispatch_id === 'dsp_a');
  const b = led.dispatches.find((d) => d.dispatch_id === 'dsp_b');
  ok('释放成功', r.code === 0 && r.out.ok === true, JSON.stringify(r.out).slice(0, 200));
  ok('目标 state 变 aborted', a.state === 'aborted', 'state=' + a.state);
  ok('end_reason 落盘', a.end_reason === 'parent_cancelled', 'end_reason=' + a.end_reason);
  ok('ended_at 落盘', typeof a.ended_at === 'number' && a.ended_at > 0);
  ok('别的在飞记录不受影响', b.state === 'active', 'b.state=' + b.state);
  ok('在飞数 2 -> 1', r.out.active_before === 2 && r.out.active_after === 1,
    'before=' + r.out.active_before + ' after=' + r.out.active_after);
}

// ── 3. done / aborted 不动 ─────────────────────────────
{
  const dir = seed([
    base('dsp_done', { state: 'done', ended_at: NOW - 1000 }),
    base('dsp_aborted', { state: 'aborted', end_reason: 'ttl_expired' })
  ]);
  const r = run(dir, [JSON.stringify({ dispatch_id: 'dsp_done' })]);
  const led = readLedger(dir);
  const d = led.dispatches.find((x) => x.dispatch_id === 'dsp_done');
  ok('已完成的派工不重复释放', r.code === 1 && d.state === 'done' && d.ended_at === NOW - 1000,
    'state=' + d.state + ' code=' + r.code);
  ok('已完成的记录没有 end_reason', !d.end_reason, 'end_reason=' + d.end_reason);
}

// ── 4. 未知 dispatch_id → 报错，在飞数不变 ─────────────
{
  const dir = seed([base('dsp_a')]);
  const r = run(dir, [JSON.stringify({ dispatch_id: 'dsp_nope' })]);
  const led = readLedger(dir);
  ok('未知 dispatch_id 报错', r.code === 1 && r.out.ok === false, 'code=' + r.code);
  ok('未知 id 不改在飞数', led.dispatches[0].state === 'active', 'state=' + led.dispatches[0].state);
}

// ── 5. parent_session_id 释放该父会话全部 active ──────
{
  const dir = seed([
    base('dsp_a1'),
    base('dsp_a2', { agent: 'sa-gate-integrity' }),
    base('dsp_other', { parent_session_id: 'mvs_parent_b' })
  ]);
  const r = run(dir, [JSON.stringify({ parent_session_id: 'mvs_parent_a' })]);
  const led = readLedger(dir);
  const st = (id) => led.dispatches.find((d) => d.dispatch_id === id).state;
  ok('同父会话两条都释放', st('dsp_a1') === 'aborted' && st('dsp_a2') === 'aborted');
  ok('别的父会话不受影响', st('dsp_other') === 'active', 'state=' + st('dsp_other'));
  ok('释放数量 = 2', (r.out.released || []).length === 2, 'n=' + (r.out.released || []).length);
}

// ── 6. agent 收窄 ─────────────────────────────────────
{
  const dir = seed([base('dsp_a1'), base('dsp_a2', { agent: 'sa-gate-integrity' })]);
  const r = run(dir, [JSON.stringify({ parent_session_id: 'mvs_parent_a', agent: 'sa-gate-integrity' })]);
  const led = readLedger(dir);
  const st = (id) => led.dispatches.find((d) => d.dispatch_id === id).state;
  ok('只释放指定成员的那条', st('dsp_a2') === 'aborted' && st('dsp_a1') === 'active',
    'a1=' + st('dsp_a1') + ' a2=' + st('dsp_a2'));
}

// ── 7. --data-dir 入口 ────────────────────────────────
{
  const dir = seed([base('dsp_a')]);
  const r = spawnSync('node', [SCRIPT, JSON.stringify({ dispatch_id: 'dsp_a' }), '--data-dir', dir], {
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: '' }
  });
  let out; try { out = JSON.parse(r.stdout); } catch { out = {}; }
  const led = readLedger(dir);
  ok('--data-dir 入口生效', out.ok === true && led.dispatches[0].state === 'aborted',
    'ok=' + out.ok + ' state=' + led.dispatches[0].state);
}

// ── 8. 安全属性：worker 不能通过 bash 通道调释放入口 ──────
{
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-release-worker-'));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'app.ts'), 'export const a = 1;', 'utf8');

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-release-wdata-'));
  fs.writeFileSync(path.join(data, 'dispatches.json'), JSON.stringify({
    dispatches: [{
      dispatch_id: 'dsp_worker_target', parent_session_id: 'mvs_parent', turn_id: 't', tool_use_id: 'c',
      agent: 'sa-x', scope: ['src/app.ts'], state: 'active', at: Date.now()
    }], bindings: [], counters: {}
  }, null, 2), 'utf8');

  // 真 transcript：worker 的 scope 只有 src/app.ts
  const trText = ['<agent-context>', '  agentName: worker', '  PARENT SESSION: mvs_parent', '</agent-context>',
    '任务：按 brief 执行', 'SCOPE: src/app.ts'].join('\n');
  const tr = path.join(proj, 'tr.jsonl');
  fs.writeFileSync(tr, JSON.stringify({
    uuid: 'p-0', parentUuid: null, sessionId: 'mvs_child',
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: trText }] }
  }) + '\n', 'utf8');

  function wguard(tool, input) {
    const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
      input: JSON.stringify({
        hook_event_name: 'PreToolUse', tool_name: tool, session_id: 'mvs_child',
        agent_id: 'mvs_child', agent_type: 'worker', transcript_path: tr,
        cwd: proj, tool_input: input
      }),
      env: { ...process.env, PLUGIN_DATA: data, MINIMAX_PROJECT_DIR: proj },
      encoding: 'utf8'
    });
    let j = null; try { j = JSON.parse(r.stdout); } catch {}
    return { decision: (j && j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision) || '' };
  }

  const relCmd = 'node "' + path.join(PLUGIN_ROOT, 'scripts', 'release-slot.mjs') + '" ' +
    "'{\"dispatch_id\":\"dsp_worker_target\"}'";
  const g1 = wguard('bash', { command: relCmd });
  ok('worker 调释放入口被 scope 拦下', g1.decision === 'deny', 'decision=' + g1.decision);

  const g2 = wguard('bash', { command: 'node "' + path.join(PLUGIN_ROOT, 'scripts', 'release-slot.mjs') + '" --all' });
  ok('worker 用 --all 也被拦下', g2.decision === 'deny', 'decision=' + g2.decision);

  const g3 = wguard('write', { file_path: 'src/app.ts' });
  ok('对照：worker 写自己 scope 内文件放行（边界确实建立了）', g3.decision === '', 'decision=' + g3.decision);

  const led2 = readLedger(data);
  ok('worker 尝试后台账未被释放', led2.dispatches[0].state === 'active', 'state=' + led2.dispatches[0].state);
}

// ── 8b. 开关形式（F2）：PowerShell 会吃掉 JSON 里的双引号，
//        所以文档推荐的写法必须是不含引号的开关形式 ─────────────
{
  const dir = seed([base('dsp_a'), base('dsp_b')]);
  const r = run(dir, ['--dispatch', 'dsp_a']);
  const led = readLedger(dir);
  const st = (id) => led.dispatches.find((d) => d.dispatch_id === id).state;
  ok('开关形式 --dispatch 释放成功', r.code === 0 && r.out.ok === true && st('dsp_a') === 'aborted',
    'code=' + r.code + ' state=' + st('dsp_a'));
  ok('开关形式不影响别的在飞记录', st('dsp_b') === 'active', 'state=' + st('dsp_b'));
}
{
  const dir = seed([base('dsp_a1'), base('dsp_a2'), base('dsp_other', { parent_session_id: 'mvs_parent_b' })]);
  const r = run(dir, ['--parent', 'mvs_parent_a']);
  const led = readLedger(dir);
  const st = (id) => led.dispatches.find((d) => d.dispatch_id === id).state;
  ok('开关形式 --parent 释放同父会话全部', st('dsp_a1') === 'aborted' && st('dsp_a2') === 'aborted' && st('dsp_other') === 'active',
    'a1=' + st('dsp_a1') + ' a2=' + st('dsp_a2') + ' other=' + st('dsp_other'));
  ok('开关形式 --parent 释放数量 = 2', (r.out.released || []).length === 2, 'n=' + (r.out.released || []).length);
}
{
  const dir = seed([base('dsp_a')]);
  const r = run(dir, ['--bogus', 'x']);
  ok('未知开关报错退出', r.code === 1 && r.out.ok === false, 'code=' + r.code);
  ok('未知开关不改台账', readLedger(dir).dispatches[0].state === 'active', '');
}

// ── 9. 台账结构完整（写回不丢字段） ────────────────────
{
  const dir = seed([base('dsp_a')]);
  run(dir, [JSON.stringify({ dispatch_id: 'dsp_a' })]);
  const led = readLedger(dir);
  const d = led.dispatches[0];
  ok('写回不丢 scope / lessons 字段', Array.isArray(d.scope) && Array.isArray(d.lessons) && d.agent === 'sa-mechanism-fix');
  ok('写回保留 bindings 与 counters', Array.isArray(led.bindings) && !!led.counters);
}

// ── D-37：被拒的派工不占名额、不留记录（台账生命周期视角）────
//
// 派工到一个账号里不存在的成员时，子会话不会启动 —— 但台账以前照样写一条
// state:'active'，于是占住一个并发名额与一个累计名额，
// 同 SCOPE 的后续派工被「组队冲突」误拦 ⇒ 静默失效。
{
  const acct = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-acct-'));
  fs.mkdirSync(path.join(acct, 'worker'), { recursive: true });
  const dir = seed([]);
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'mvs_d37', turn_id: 't1',
      tool_input: { agent_name: 'sa-ghost-member', prompt: 'SCOPE: docs/audit/d37.md' }
    }),
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: dir, MINIMAX_PROJECT_DIR: dir, SAR_ACCOUNT_AGENTS_DIR: acct }
  });
  const out = String(r.stdout || '');
  ok('D-37 派工到不存在的成员被拒', out.includes('deny') && out.includes('在账号里不存在'), out.slice(0, 200));
  const led = readLedger(dir);
  ok('D-37 被拒的派工不留台账记录', led.dispatches.length === 0, '记录数=' + led.dispatches.length);
  ok('D-37 被拒的派工不占累计名额', !led.counters || !led.counters['mvs_d37'], JSON.stringify(led.counters || {}));
}

console.log(fail === 0 ? '>>> DISPATCH-RELEASE ALL PASS' : '>>> DISPATCH-RELEASE FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
