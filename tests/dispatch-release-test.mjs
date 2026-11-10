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
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'release-slot.mjs');
// D-77/D-73 的新增断言锚在**仓库副本**上：
// 本单改的是仓库副本，安装副本由父会话发版时同步 ——
// 若新增断言跟着安装副本走，同步前直接跑本套件会看到**假红**（测的是旧代码）。
// SAR_D77_PLUGIN_ROOT 供变异矩阵指向副本（矩阵里改的是副本，不是仓库）。
const { fileURLToPath: _fileURLToPath } = await import('node:url');
const REPO_PLUGIN = path.resolve(path.dirname(_fileURLToPath(import.meta.url)), '..', 'plugin');
const D77_PLUGIN = process.env.SAR_D77_PLUGIN_ROOT || REPO_PLUGIN;
const DISPATCH = path.join(D77_PLUGIN, 'scripts', 'dispatch.mjs');


let fail = 0;

// 变异矩阵入口（独立开关 SAR_MUTATION_D77=1）：
// 打开时**只**跑矩阵并退出 —— 矩阵跑的是「被重跑的套件」的输出，
// 本进程自己的正常断言混进同一份输出里，第三方就分不清哪条红是变异造成的。
if (process.env.SAR_MUTATION_D77 === '1') {
  await runD77MutationMatrix();
}
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


// ══════════════════════════════════════════════════════════
// D-77：派工台账的「读-改-写」必须整体串行化
// ══════════════════════════════════════════════════════════
//
// 复现方式（确定性，不靠撞概率）：
//   两个子进程各派一单（各读一次台账、各加一条、各写一次），
//   用「起跑号牌」消除错峰：每个进程读完台账后写一个 read-<pid>-<n> 标记并等 go 文件；
//   父进程看到两个**不同 pid** 的标记后才发 go。
//   ⇒ go 之前没有人能落盘（落盘在同步点之后），
//     所以「两个写者拿到同一份旧快照」这件事是确定的，不是概率。
//
// 改前：后写的那个把先写的整条覆盖掉 —— 台账里少一条，文件格式合法、内容看着正常。
// 改后：整个「读-改-写」在跨进程锁里串行化，后到的那个锁内重读 ⇒ 两条都在。

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* ignore */ }
  }
}

function mkD77Env(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const PROJ = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src', 'a.ts'), 'export const a = 1;', 'utf8');
  fs.writeFileSync(path.join(PROJ, 'src', 'b.ts'), 'export const b = 2;', 'utf8');
  const DATA = path.join(tmp, 'data');
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'),
    JSON.stringify({ dispatches: [], bindings: [], counters: {}, scope_requests: [] }, null, 2), 'utf8');
  const ACCT = path.join(tmp, 'acct');
  fs.mkdirSync(path.join(ACCT, 'worker-a'), { recursive: true });
  fs.mkdirSync(path.join(ACCT, 'worker-b'), { recursive: true });
  const SYNC = path.join(tmp, 'sync');
  fs.mkdirSync(SYNC, { recursive: true });
  return { tmp, PROJ, DATA, ACCT, SYNC };
}

function d77Env(env, extra) {
  return Object.assign({}, process.env, {
    PLUGIN_DATA: env.DATA,
    MINIMAX_PROJECT_DIR: env.PROJ,
    SAR_ACCOUNT_AGENTS_DIR: env.ACCT,
    SAR_LEDGER_SYNC_DIR: env.SYNC
  }, extra || {});
}

function d77Payload(turn, agent, scope) {
  return JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'mvs_conc', turn_id: turn,
    tool_input: { agent_name: agent, prompt: 'SCOPE: ' + scope + '\n干活' }
  });
}

function spawnDispatch(env, payload) {
  const p = spawn(process.execPath, [DISPATCH], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = { code: -1, stdout: '', stderr: '' };
  p.stdout.on('data', (b) => { out.stdout += b.toString(); });
  p.stderr.on('data', (b) => { out.stderr += b.toString(); });
  const done = new Promise((resolve) => {
    p.on('close', (code) => { out.code = code; resolve(out); });
  });
  p.stdin.write(payload);
  p.stdin.end();
  return { proc: p, out, done };
}

// 等「不同 pid 的读者标记」。
//
// 为什么不能死等 want 个：
//   **新实现（正确实现）下第二个写者拿不到锁**，它根本到不了读台账那一步 ——
//   这正是串行化生效的证据。等它会永远等不到。
// 所以策略是：先等到**至少一个**写者进入临界区，再给一个宽限窗口看第二个能不能到；
// 到齐 ⇒ 立刻发 go（两个写者拿到的是**同一份**旧快照 —— 丢记录因此是确定的）；
// 没到齐 ⇒ 窗口结束照样发 go（此时新实现已经能保证不丢）。
//
// 返回实际到达的 pid 数（调用方用它断言「并发确实发生了」）。
async function waitDistinctReaders(syncDir, want, timeoutMs, graceMs) {
  const readPids = () => {
    let files = [];
    try { files = fs.readdirSync(syncDir); } catch { /* 目录还没建出来 */ }
    return new Set(files.filter((f) => f.startsWith('read-'))
      .map((f) => f.slice(5).split('-')[0]));
  };
  // 必须**异步**等：同步阻塞（Atomics.wait）会把事件循环卡住，
  // 而 spawn 是异步的 —— 主线程一卡，子进程根本还没被创建，
  // 于是「两个写者」变成**错峰**串行，「两条都在」就成了假绿。
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + timeoutMs;
  let pids = readPids();
  while (pids.size < 1 && Date.now() < deadline) {
    await nap(20);
    pids = readPids();
  }
  if (pids.size >= want) return pids.size;
  const graceEnd = Date.now() + (graceMs || 0);
  while (Date.now() < graceEnd) {
    await nap(20);
    pids = readPids();
    if (pids.size >= want) break;
  }
  return pids.size;
}

function d77Ledger(env) {
  try { return JSON.parse(fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8')); }
  catch { return null; }
}

// ── D-77-1：两个并发写者各加一条记录 ⇒ 两条都在 ─────────────
{
  const env = mkD77Env('sar-d77-conc-');
  const e = d77Env(env);
  const p1 = spawnDispatch(e, d77Payload('t1', 'worker-a', 'src/a.ts'));
  const p2 = spawnDispatch(e, d77Payload('t2', 'worker-b', 'src/b.ts'));
  // 起跑号牌：先等至少一个写者进入临界区，再给宽限窗口看第二个能不能到
  const readers = await waitDistinctReaders(env.SYNC, 2, 8000, 1200);
  fs.writeFileSync(path.join(env.SYNC, 'go'), 'go');
  const [o1, o2] = await Promise.all([p1.done, p2.done]);
  const led = d77Ledger(env);
  const recs = (led && led.dispatches) || [];
  // 并发确实发生了 —— 没有这一条，下面的「两条都在」可能是**错峰**跑出来的假绿。
  let syncFiles = [];
  try { syncFiles = fs.readdirSync(env.SYNC); } catch (e) { syncFiles = ['ERR ' + e.message]; }
  ok('D-77 并发确实发生了（写者到达了临界区）', readers >= 1,
    'readers=' + readers + ' syncDir=' + env.SYNC + ' files=' + JSON.stringify(syncFiles) +
    ' out1code=' + o1.code + ' out2code=' + o2.code + ' out1=' + String(o1.stdout).slice(0, 120));
  ok('D-77 两个并发写者各加一条记录 ⇒ 两条都在',
    readers >= 1 && recs.length === 2 &&
    recs.some((d) => d.agent === 'worker-a') && recs.some((d) => d.agent === 'worker-b'),
    '台账记录数=' + recs.length + ' readers=' + readers +
    ' | out1=' + String(o1.stdout).slice(0, 90) + ' | out2=' + String(o2.stdout).slice(0, 90));
  ok('D-77 并发写者两条记录各自带自己的 scope（没被覆盖成同一条）',
    readers >= 1 && recs.length === 2 &&
    new Set(recs.map((d) => String((d.scope || [])[0]))).size === 2,
    JSON.stringify(recs.map((d) => [d.agent, (d.scope || [])[0]])));
  ok('D-77 并发写者的台账仍是合法 JSON', !!led, 'readLedger=' + JSON.stringify(led).slice(0, 120));
}

// ── D-77-2：写到一半被中断 ⇒ 台账仍是合法 JSON 且原有记录一条不少 ──
{
  const env = mkD77Env('sar-d77-crash-');
  // 先正常登记一条，作为「原有记录」
  const seed = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('t0', 'worker-a', 'src/a.ts'), encoding: 'utf8',
    env: d77Env(env, { SAR_LEDGER_SYNC_DIR: '' })
  });
  const before = d77Ledger(env);
  const beforeText = fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8');
  const beforeCount = (before.dispatches || []).length;
  // 故障注入：写完临时文件、原子替换之前**直接退出进程**（模拟被 kill）
  const crash = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('t1', 'worker-b', 'src/b.ts'), encoding: 'utf8',
    env: d77Env(env, { SAR_LEDGER_SYNC_DIR: '', SAR_FAULT_INJECT: 'ledger-crash-mid-write', SAR_FAULT_RUN: 'd77-crash' })
  });
  let after = null, parseOk = false;
  try { after = JSON.parse(fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8')); parseOk = true; } catch { parseOk = false; }
  ok('D-77 写到一半被中断 ⇒ 进程非零退出', crash.status !== 0, 'status=' + crash.status);
  ok('D-77 写到一半被中断 ⇒ 台账仍是合法 JSON', parseOk, fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8').slice(0, 120));
  ok('D-77 写到一半被中断 ⇒ 原有记录一条不少',
    parseOk && (after.dispatches || []).length === beforeCount &&
    (after.dispatches || []).every((d) => (before.dispatches || []).some((b) => b.dispatch_id === d.dispatch_id)),
    'before=' + beforeCount + ' after=' + (after ? (after.dispatches || []).length : 'n/a'));
  ok('D-77 写到一半被中断 ⇒ 台账内容未被改动（逐字一致）',
    fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8') === beforeText,
    'beforeLen=' + beforeText.length);
  ok('D-77 写入前已有记录（前置条件自检）', beforeCount === 1 && !String(seed.stdout || '').includes('deny'),
    'count=' + beforeCount);
}

// ── D-77-3：回读校验失败 ⇒ 回滚到写前状态并报错 ────────────
{
  const env = mkD77Env('sar-d77-verify-');
  const seed = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('t0', 'worker-a', 'src/a.ts'), encoding: 'utf8',
    env: d77Env(env, { SAR_LEDGER_SYNC_DIR: '' })
  });
  const beforeText = fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8');
  const res = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('t1', 'worker-b', 'src/b.ts'), encoding: 'utf8',
    env: d77Env(env, { SAR_LEDGER_SYNC_DIR: '', SAR_FAULT_INJECT: 'ledger-verify-fail', SAR_FAULT_RUN: 'd77-verify' })
  });
  const out = String(res.stdout || '');
  ok('D-77 回读校验失败 ⇒ 派工被拒并报出规则编号',
    out.includes('deny') && out.includes('R-LEDGER-VERIFY-FAILED'), out.slice(0, 220));
  const afterText = fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8');
  ok('D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致）', afterText === beforeText,
    'beforeLen=' + beforeText.length + ' afterLen=' + afterText.length);
  let parsed = null;
  try { parsed = JSON.parse(afterText); } catch { parsed = null; }
  ok('D-77 回读校验失败后 ⇒ 台账仍是合法 JSON 且原有记录还在',
    !!parsed && (parsed.dispatches || []).length === 1, JSON.stringify(parsed && parsed.dispatches && parsed.dispatches.length));
  ok('D-77 回读校验失败 ⇒ 前置登记成功（前置条件自检）', !String(seed.stdout || '').includes('deny'), '');
}

// ── D-77-4：五个写方全部走统一写入口（结构自检）────────────
{
  const S = path.join(D77_PLUGIN, 'scripts');
  const writers = ['dispatch.mjs', 'guard.mjs', 'scope-amend.mjs', 'release-slot.mjs', 'watchdog.mjs'];
  const srcs = {};
  for (const w of writers) srcs[w] = fs.readFileSync(path.join(S, w), 'utf8');
  const naked = writers.filter((w) => /writeLedger\s*\(/.test(srcs[w]));
  ok('D-77 五个写方全部走统一写入口（无裸 writeLedger 调用）', naked.length === 0,
    '仍调用 writeLedger 的：' + naked.join(','));
  const libSrc = fs.readFileSync(path.join(S, 'lib.mjs'), 'utf8');
  ok('D-77 统一写入口存在（updateLedger）', /export function updateLedger\s*\(/.test(libSrc), '');
  // 台账写路径唯一：只有 lib.mjs 知道 dispatches.json 在哪
  const all = fs.readdirSync(S).filter((f) => f.endsWith('.mjs'));
  const withLedgerPath = all.filter((f) => /dispatches\.json/.test(fs.readFileSync(path.join(S, f), 'utf8')));
  ok('D-77 台账文件路径只在 lib.mjs 里出现（写路径唯一）',
    withLedgerPath.length === 1 && withLedgerPath[0] === 'lib.mjs', withLedgerPath.join(','));
  // 台账不得被裸 writeFileSync 直写
  const nakedWriters = all.filter((f) => {
    const s = fs.readFileSync(path.join(S, f), 'utf8');
    return /writeFileSync\s*\([^)]*dispatches\.json/.test(s);
  });
  ok('D-77 没有脚本用裸 writeFileSync 直写台账', nakedWriters.length === 0, nakedWriters.join(','));
}

// ── D-77-5：锁参数之间的关系可被验算（契约 S7.5）───────────
{
  const { pathToFileURL } = await import('node:url');
  const libUrl = pathToFileURL(path.join(D77_PLUGIN, 'scripts', 'lib.mjs')).href;
  const lib = await import(libUrl);
  const waitMs = lib.LEDGER_LOCK_WAIT_TIMEOUT_MS;
  const staleMs = lib.LEDGER_LOCK_STALE_MS;
  const window = lib.LEDGER_RENAME_RETRY_WINDOW_MS;
  ok('D-77 等待超时 ≥ 最大并发数 × rename 重试窗口（排队方不被误判失败）',
    waitMs >= lib.MAX_ACTIVE_DISPATCHES * window,
    '等待=' + waitMs + ' 需要>=' + (lib.MAX_ACTIVE_DISPATCHES * window));
  ok('D-77 偷锁阈值 > 等待超时（不偷还在用的锁）', staleMs > waitMs,
    '偷锁=' + staleMs + ' 等待=' + waitMs);
}

// ── D-77 + D-73 合起来：连续派两单 ⇒ 两条都在；组队冲突看得见第二条；
//      降级路径那一条不占名额、不堵后续派工 ──────────────────
{
  const env = mkD77Env('sar-d77-d73-');
  // 项目名录（有名录 ⇒ 降级口径成立）
  fs.mkdirSync(path.join(env.PROJ, '.superagent'), { recursive: true });
  fs.writeFileSync(path.join(env.PROJ, '.superagent', 'roster.json'), JSON.stringify({
    members: [{ name: 'worker-a', owns: 'x' }], updated: '2026-11-10'
  }, null, 2), 'utf8');
  const e = d77Env(env);
  const d1 = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('m1', 'worker-a', 'src/a.ts'), encoding: 'utf8', env: e
  });
  const d2 = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('m2', 'worker-b', 'src/b.ts'), encoding: 'utf8', env: e
  });
  let led = d77Ledger(env);
  ok('D-77+D-73 连续派两单 ⇒ 台账里两条都在',
    !String(d1.stdout || '').includes('deny') && !String(d2.stdout || '').includes('deny') &&
    (led.dispatches || []).length === 2, '记录数=' + (led.dispatches || []).length);
  // 组队冲突闸门看得见第一条 ⇒ 同 scope 的下一条被拦
  const d3 = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('m3', 'worker-b', 'src/a.ts'), encoding: 'utf8', env: e
  });
  ok('D-77+D-73 组队冲突闸门看得见在飞派工（同 scope 的下一条被拦）',
    String(d3.stdout || '').includes('deny') && String(d3.stdout || '').includes('组队冲突'),
    String(d3.stdout || '').slice(0, 160));
  // 降级路径（名单不可得 + 名录外成员）：不占名额、不堵后续派工
  const degradedEnv = d77Env(env, { SAR_ACCOUNT_AGENTS_DIR: '' });
  const d4 = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('m4', 'ghost-member', 'src/a.ts'), encoding: 'utf8', env: degradedEnv
  });
  ok('D-73 降级路径派工被放行（不拒派）',
    !String(d4.stdout || '').includes('deny'), String(d4.stdout || '').slice(0, 160));
  led = d77Ledger(env);
  const deg = (led.dispatches || []).find((d) => d.agent === 'ghost-member');
  ok('D-73 降级路径那条记录标了 degraded', !!deg && deg.degraded === true,
    JSON.stringify(deg && { agent: deg.agent, degraded: deg.degraded, existence: deg.member_existence }));
  const d5 = spawnSync(process.execPath, [DISPATCH], {
    input: d77Payload('m5', 'worker-b', 'src/a.ts'), encoding: 'utf8', env: degradedEnv
  });
  ok('D-73 降级路径那条不堵后续派工（同 scope 的下一条不被误拦）',
    !String(d5.stdout || '').includes('deny'), String(d5.stdout || '').slice(0, 200));
  led = d77Ledger(env);
  const counters = led.counters || {};
  ok('D-73 降级路径那条不占累计名额（计数器没有因为它增加）',
    Number(counters['mvs_conc'] || 0) === 2, 'counters=' + JSON.stringify(counters));
}


// ── D-77 变异自检（独立开关 SAR_MUTATION_D77=1）────────────────────
//
// 为什么要有这个：只跑「新实现全绿」不能证明修复有效 ——
// 必须把实现改回去，看目标断言会不会红（D-66 的教训：没有专属断言的修复，回退实现后一条都不红）。
//
// 做法沿用 tests/scope-amend-test.mjs 里 SAR_MUTATION_D75 的那一套：
//   ① 把插件副本装到**系统临时目录**（仓库工作树零改动，跑完即删）；
//   ② 在**副本**上做定向回退；
//   ③ 用副本重跑本套件的目标断言；
//   ④ 目标断言必须转红。
//
// 为什么用**独立开关**而不是复用 SAR_MUTATION=1：
//   总矩阵（SAR_MUTATION=1）归 tests/e2e-test.mjs 那一单独占。
//   两边的分档语义混在一起会让「总矩阵跑过了」被误读成「D-77 的变异体也跑过了」。
//   本单的变异体最终会由 tests/e2e-test.mjs 的下一位独占者归并进总矩阵，
//   在那之前本单先在自己的专属套件里自证。
//
// 用法：node tests/dispatch-release-test.mjs   （设 SAR_MUTATION_D77=1）
async function runD77MutationMatrix() {
  const { fileURLToPath } = await import('node:url');
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SRC_PLUGIN = path.join(REPO, 'plugin');

  const mutRead = (p) => fs.readFileSync(p, 'utf8');
  const mutWrite = (p, s) => fs.writeFileSync(p, s, 'utf8');
  const mutReplace = (file, from, to) => {
    const src = mutRead(file);
    const idx = src.indexOf(from);
    if (idx < 0) throw new Error('变异点未命中：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    if (src.indexOf(from, idx + 1) >= 0) throw new Error('变异点不唯一：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    mutWrite(file, src.slice(0, idx) + to + src.slice(idx + from.length));
  };

  const MUTANTS = [
    {
      // M1：把整个写路径回退成「裸读-改-写」—— 无跨进程锁 + 裸 writeFileSync。
      // 这正是 D-77 的活体形态：后写的那个把先写的整条覆盖掉，
      // 而台账格式合法、内容看着正常，读侧检测不出来。
      // 它必须让「两个并发写者各加一条记录 ⇒ 两条都在」转红。
      id: 'M-D77a', defect: 'D-77',
      what: '回退整个写路径：无跨进程锁 + 裸 writeFileSync（无临时文件、无原子替换）',
      expect: [
        'D-77 两个并发写者各加一条记录 ⇒ 两条都在',
        'D-77 并发写者两条记录各自带自己的 scope（没被覆盖成同一条）'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "    out = withLedgerLock(p, () => updateLedgerLocked(p, mutator, opts));",
          "    // MUT-D77a：回退到无锁的读-改-写\n    out = updateLedgerLocked(p, mutator, opts);");
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "  const rr = replaceFileWithRetry(tmp, p);\n  if (!rr.ok) {\n    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }\n    return { ok: false, error: '台账原子替换失败：' + rr.error };\n  }",
          "  // MUT-D77a：回退到裸 writeFileSync（无临时文件、无原子替换）\n" +
          "  try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }\n" +
          "  fs.writeFileSync(p, text, 'utf8');\n" +
          "  const rr = { ok: true };");
        // 一起摘掉回读校验：历史形态就是「写完不校验、也不回滚」，
        // 否则并发下两个写者会互相回滚（失败形态变成「都没登记」而不是「丢一条」）。
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "  const back = readLedgerText(p);\n  if (back !== text) {",
          "  const back = readLedgerText(p);\n  if (false && back !== text) { // MUT-D77a：回读校验被摘掉");
      }
    },
    {
      // M2：把「回滚」摘掉 —— 回读校验失败时报错，但**不恢复写前状态**。
      // 它必须让「回滚到写前状态」那条断言转红。
      id: 'M-D77b', defect: 'D-77',
      what: '回退「回滚」：回读校验失败后不恢复到写前状态',
      expect: [
        'D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致）'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "    const rb = restoreLedgerFile(p, before.text);",
          "    const rb = { ok: true }; // MUT-D77b：回滚被摘掉");
      }
    },
    {
      // M3：把「回读校验」摘掉 —— 写完不校验就报成功。
      // 它必须让「回读校验失败 ⇒ 报错」那条断言转红。
      id: 'M-D77c', defect: 'D-77',
      what: '回退「回读校验」：写完不校验直接报成功',
      expect: [
        'D-77 回读校验失败 ⇒ 派工被拒并报出规则编号',
        'D-77 回读校验失败 ⇒ 台账回滚到写前状态（逐字一致）'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "  const back = readLedgerText(p);\n  if (back !== text) {",
          "  const back = readLedgerText(p);\n  if (false && back !== text) { // MUT-D77c：回读校验被摘掉");
      }
    }
  ];

  const mutRunSuite = (pluginRoot) => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tests', 'dispatch-release-test.mjs')], {
      encoding: 'utf8', timeout: 300000, cwd: REPO,
      // 必须清掉 SAR_MUTATION_D77：被重跑的套件里若再次打开本工装，就会**递归**跑自己。
      env: Object.assign({}, process.env, {
        SAR_PLUGIN_ROOT: pluginRoot, SAR_MUTATION_D77: '', SAR_D77_PLUGIN_ROOT: pluginRoot
      })
    });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const lines = out.split(/\r?\n/);
    return {
      red: lines.filter((l) => l.startsWith('FAIL ')),
      green: lines.filter((l) => l.startsWith('PASS ')).length
    };
  };

  console.log('| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |');
  console.log('|---|---|---|---|---|');
  for (const m of MUTANTS) {
    const mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mut-d77-' + m.id.toLowerCase() + '-'));
    const mutPlugin = path.join(mutRoot, 'plugin');
    try {
      fs.cpSync(SRC_PLUGIN, mutPlugin, { recursive: true });
      m.apply(mutPlugin);
      const r = mutRunSuite(mutPlugin);
      const missing = m.expect.filter((name) => !r.red.some((l) => l.indexOf(name) >= 0));
      const wronglyRed = (m.expectGreen || []).filter((name) => r.red.some((l) => l.indexOf(name) >= 0));
      const good = missing.length === 0 && r.red.length > 0 && wronglyRed.length === 0;
      if (!good) fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | ' + r.red.length + ' | ' + (good ? 'YES' : 'NO') + ' |');
      for (const l of r.red) console.log('    RED ' + l.slice(0, 150));
      if (missing.length) console.log('    MISS ' + missing.join(' / '));
      if (wronglyRed.length) console.log('    WRONG-RED ' + wronglyRed.join(' / '));
    } catch (e) {
      fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | 0 | NO（变异体本身失败：' + e.message + '） |');
    } finally {
      fs.rmSync(mutRoot, { recursive: true, force: true });
    }
  }
  console.log(fail === 0 ? '>>> D77 MUTATION MATRIX OK' : '>>> D77 MUTATION MATRIX FAILURES: ' + fail);
  process.exit(fail === 0 ? 0 : 1);
}

console.log(fail === 0 ? '>>> DISPATCH-RELEASE ALL PASS' : '>>> DISPATCH-RELEASE FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
