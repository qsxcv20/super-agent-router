// 错题本闸门回归测试
// 用法：node tests/lessons-test.mjs
//   默认跑安装副本；跑仓库副本请显式指定：
//   $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\lessons-test.mjs
//
// 验证这些事：
//   1. 合规条目写入成功、文件格式正确
//   2. 四类重大错误之外的类型被拒
//   3. 归因公平：编排层的锅写进成员错题本要被拒 —— **逐个语序**各测一次
//   4. 归因公平不越界：成员自己承认失误（根因在成员侧）必须仍能写进去
//   5. 感想式规则被拒、缺字段被拒
//   6. 派工时能读到规则（自我进化闭环）
//   7. 无错题本的成员不产生噪音
//   8. 「_router」保留名被拒（Router 自己的错题本用 S1 的 7 字段模板）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-lesson-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, '.superagent', 'lessons'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

// ── 派工台账夹具（D-49 的判据来源）───────────────────────────
// 写入者身份由「会话 id → 台账」核对，不靠载荷自称。
// 这里造三条：
//   PARENT  = 父会话（Router），可以给本项目任何成员记账
//   WORKER  = 绑定成员 sa-worker-one 的子会话，只能写自己的账本
//   WORKER2 = 绑定成员 sa-worker-two 的子会话
// 父会话 id 必须出现在台账的 parent_session_id 字段里，否则身份无法核对 → 一律拒。
const PARENT = 'mvs-parent-lesson';
const WORKER = 'sess-worker-one';
const WORKER2 = 'sess-worker-two';
function ledgerFile() { return path.join(DATA, 'dispatches.json'); }
function writeLedger(obj) {
  fs.writeFileSync(ledgerFile(), JSON.stringify(obj, null, 2), 'utf8');
}
writeLedger({
  dispatches: [
    { dispatch_id: 'dsp_p1', parent_session_id: PARENT, turn_id: 't1', agent: 'sa-worker-one', agent_key: 'sa-worker-one', scope: [], state: 'done', at: Date.now() }
  ],
  bindings: [
    { session_id: WORKER, parent_session_id: PARENT, agent: 'sa-worker-one', agent_key: 'sa-worker-one', scope: [], at: Date.now() },
    { session_id: WORKER2, parent_session_id: PARENT, agent: 'sa-worker-two', agent_key: 'sa-worker-two', scope: [], at: Date.now() }
  ]
});

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };
// 错误数组可能整体缺失（成功时没有 errors 字段）—— 断言文案统一走这个助手，
// 免得「断言本身抛异常」把真正的红绿信息吃掉。
const errs = (r) => JSON.stringify((r && r.errors) || []);

// 故障注入的批次号：每条用例换一个批次号，额度随之归零
// （否则上一条用例把 rename-eperm 的额度用光，下一条就注入不到）。
let faultRunSeq = 0;

function gate(payload, opts = {}) {
  // session_id 是「谁在写」的声明（D-49）：闸门拿它去台账查绑定，不靠载荷自称。
  const body = { session_id: opts.sessionId || PARENT, ...payload };
  const args = [path.join(PLUGIN_ROOT, 'scripts', 'lessons-gate.mjs')];
  if (opts.router) args.push('--router');
  args.push(JSON.stringify(body));
  const env = { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA };
  // 故障注入（D-59/D-60/D-61 的断言必须确定性 —— 见第 17 节的说明）。
  // 只有显式传 opts.fault 才开；不传时环境里根本没有这两个变量 ⇒ 生产路径不变。
  if (opts.fault) {
    env.SAR_FAULT_INJECT = opts.fault;
    env.SAR_FAULT_RUN = opts.faultRun || ('f02-run-' + (faultRunSeq++));
  }
  const r = spawnSync('node', args, {
    encoding: 'utf8',
    env
  });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = { raw: r.stdout, err: r.stderr }; }
  return out;
}

// 异步版闸门（D-62 的行为断言要等锁，用同步版会把整个测试进程卡住）。
function gateAsync(payload, opts = {}) {
  const body = { session_id: opts.sessionId || PARENT, ...payload };
  const args = [path.join(PLUGIN_ROOT, 'scripts', 'lessons-gate.mjs')];
  if (opts.router) args.push('--router');
  args.push(JSON.stringify(body));
  return new Promise((resolve) => {
    const child = spawn('node', args, {
      encoding: 'utf8',
      env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
    });
    let buf = '';
    child.stdout.on('data', (c) => { buf += c; });
    child.on('close', () => {
      let out = null;
      try { out = JSON.parse(buf); } catch { out = { raw: buf.slice(0, 200) }; }
      resolve(out);
    });
  });
}

// ── 起跑号牌（并发断言的确定性来源）───────────────────────────
// 为什么需要：旧口径的丢条目是**概率性**的 —— 写入方错峰起跑时，后起的进程
// 读到的快照已经含前几条，就丢不了条目，断言会「碰巧绿」
// （上一轮实测：同一个变异体一次跑出 2 条红、另一次 0 条红）。
// 号牌把所有写入方卡在同一条起跑线上，号令一发同时冲 ——
// 读快照的窗口必然重叠，旧口径必然丢条目 ⇒ 红了就是稳定红。
//
// 号牌脚本写在临时目录里（不进仓库）：它只是「等号 → 再调闸门」的一层壳。
function makeBarrierRunner(dir, name) {
  const p = path.join(dir, name + '.mjs');
  fs.writeFileSync(p, [
    "import fs from 'node:fs';",
    "import { spawn } from 'node:child_process';",
    "const [goFile, script, payload] = process.argv.slice(2);",
    "process.stdout.write('READY\\n');",
    "const t0 = Date.now();",
    "while (!fs.existsSync(goFile)) {",
    "  if (Date.now() - t0 > 120000) { process.stdout.write('TIMEOUT\\n'); process.exit(3); }",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);",
    "}",
    "const child = spawn(process.execPath, [script, payload], { stdio: ['ignore', 'pipe', 'pipe'] });",
    "let out = '';",
    "child.stdout.on('data', (c) => { out += c; });",
    "child.stderr.on('data', (c) => { out += c; });",
    "child.on('close', () => { process.stdout.write(out); });"
  ].join('\n'), 'utf8');
  return p;
}

// 起跑一个「等号牌」写入方：ready 在号牌文件出现前兑现，done 在闸门退出后兑现。
function spawnBarrier(runner, goFile, script, payload) {
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  // 环境必须**显式**带上沙箱路径：不带的话闸门会按 cwd 定位项目目录
  // （D-64 同族 —— 夹具漏传环境变量会写到真实项目里去）。
  const child = spawn('node', [runner, goFile, script, payload], {
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  let buf = '';
  let isReady = false;
  child.stdout.on('data', (c) => {
    buf += c;
    if (!isReady && buf.indexOf('READY') !== -1) { isReady = true; resolveReady(); }
  });
  // stderr 也要收进来：子进程自己起不来时，只有 stderr 说得清原因
  child.stderr.on('data', (c) => { buf += '[stderr]' + c; });
  const done = new Promise((resolve) => {
    child.on('close', () => {
      if (!isReady) { isReady = true; resolveReady(); }   // 进程提前退出：别死等
      let out = null;
      const i = buf.indexOf('{');
      if (i !== -1) { try { out = JSON.parse(buf.slice(i)); } catch { out = null; } }
      resolve(out);
    });
  });
  return { ready, done };
}

const GOOD = {
  agent: 'sa-spreadsheet-extract',
  task: '月度对比图',
  type: '数据错误',
  symptom: '出图时沿用了上月的筛选条件，未回显实际口径',
  cause: '取数与出图之间没有强制回显生效条件',
  rule: '出图前必须回显实际生效的筛选条件，并与 brief 中的口径逐条核对',
  next_time: 'brief 的 ACCEPT 未含「口径已回显」时，不予派发',
  occurrence: 'single'
};

// 1. 合规条目应通过
{
  const r = gate(GOOD);
  ok('合规条目写入成功', r.ok === true, JSON.stringify(r).slice(0, 120));
}

// 2. 文件真的生成了，且格式正确
{
  const p = path.join(PROJ, '.superagent', 'lessons', 'sa-spreadsheet-extract.md');
  const raw = fs.readFileSync(p, 'utf8');
  ok('条目已落盘', raw.includes('类型：数据错误') && raw.includes('**规则**'), raw.slice(0, 80));
}

// 3. 非重大错误类型应被拒
{
  const r = gate({ ...GOOD, type: '网络抖动' });
  ok('非重大错误类型被拒', r.ok === false && r.errors.some(e => e.includes('四类')), JSON.stringify(r.errors));
}

// 4. 归因甩锅给 Router 应被拒（原始语序：brief 给错）
{
  const r = gate({ ...GOOD, agent: 'sa-x-y', cause: 'Router brief 给错了', rule: '必须按 brief 做' });
  ok('甩锅给 Router 被拒', r.ok === false && r.errors.some(e => e.includes('Router')), JSON.stringify(r.errors));
}

// 4b. 归因公平必须按**语序**逐个拦到（契约 S7.2）。
// 只测一种语序等于没测 —— 换个语序就漏，是这条规则原本失效的原因。
const BLAME_CASES = [
  ['brief 给错', 'Router brief 给错了口径来源'],
  ['给错的 brief', '上游给错的 brief 导致取数口径不对'],
  ['派工给错', '派工给错了任务范围'],
  ['派工 brief 有误', '派工 brief 有误，要求与实际数据不符'],
  ['Router 的锅', '这是 Router 的锅，需求从来没讲清楚'],
  ['需求本身自相矛盾', '需求本身自相矛盾，两个口径互相冲突']
];
for (const [label, cause] of BLAME_CASES) {
  const r = gate({ ...GOOD, agent: 'sa-blame-' + label.replace(/\s/g, '-'), cause, rule: '必须按 brief 做' });
  ok('归因语序被拦：' + label,
    r.ok === false && r.errors.some(e => e.includes('归因指向 Router')),
    JSON.stringify(r.errors));
}

// 4c. 但闸门是拦**甩锅**，不是拦**认错** —— 成员自身失误必须仍能写进去。
{
  const r = gate({
    ...GOOD,
    agent: 'sa-own-fault',
    cause: '按 brief 给错了口径，取数时没有回显生效筛选条件',
    rule: '出图前必须回显实际生效的筛选条件，并与 brief 中的口径逐条核对'
  });
  ok('成员自身失误（执行给错）仍能写入', r.ok === true, JSON.stringify(r.errors));
}
{
  const r = gate({
    ...GOOD,
    agent: 'sa-own-fault-2',
    cause: '取数与出图之间没有强制回显生效条件，沿用了上月的筛选条件',
    rule: '出图前必须回显实际生效的筛选条件'
  });
  ok('成员自身失误（纯执行根因）仍能写入', r.ok === true, JSON.stringify(r.errors));
}
{
  const r = gate({
    ...GOOD,
    agent: 'sa-own-fault-3',
    cause: '不是 brief 给错，是我取数时没有回显生效口径',
    rule: '出图前必须回显实际生效的筛选条件'
  });
  ok('否定语境（澄清自己背锅）仍能写入', r.ok === true, JSON.stringify(r.errors));
}

// 5. 缺 next_time 应被拒
{
  const r = gate({ ...GOOD, agent: 'sa-x-y', next_time: '' });
  ok('缺下次派工被拒', r.ok === false && r.errors.some(e => e.includes('next_time')), JSON.stringify(r.errors));
}

// 6. 感想式规则应被拒
{
  const r = gate({ ...GOOD, agent: 'sa-x-y', rule: '下次注意口径问题' });
  ok('感想式规则被拒', r.ok === false && r.errors.some(e => e.includes('不可执行')), JSON.stringify(r.errors));
}

// 7. 派工时能读到规则（自我进化闭环）
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'ls1', turn_id: 'lt1',
      tool_input: { agent_name: 'sa-spreadsheet-extract', prompt: 'SCOPE: a.ts' }
    }),
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: path.join(tmp, 'data') }
  });
  const out = r.stdout || '';
  ok('派工时注入历史教训', out.includes('additionalContext') && out.includes('口径'), out.slice(0, 160));
}

// 8. 无错题本的成员不产生噪音
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'ls2', turn_id: 'lt2',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: a.ts' }
    }),
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: path.join(tmp, 'data') }
  });
  ok('无错题本则静默', !(r.stdout || '').includes('additionalContext'), (r.stdout || '').slice(0, 80));
}

// 9. 「_router」是保留名：Router 自己的错题本用 S1 的 7 字段模板，
//    成员格式写进去会把两套模板搅在一起。
{
  const r = gate({ ...GOOD, agent: '_router' });
  ok('「_router」保留名被拒', r.ok === false && r.errors.some(e => e.includes('_router')), JSON.stringify(r.errors));
  ok('「_router」错题本未被成员写入',
    !fs.existsSync(path.join(PROJ, '.superagent', 'lessons', '_router.md')));
}

// ── 10. D-49：写入者身份（写入目标不由载荷独断）────────────────
// 载荷说写谁的账本不算数 —— 闸门拿 session_id 去台账查这个会话绑定的是谁。
{
  const r = gate({ ...GOOD, agent: 'sa-victim' }, { sessionId: WORKER });
  ok('D-49 冒用他人身份写入被拒',
    r.ok === false && r.errors.some(e => e.includes('写入者身份不符')),
    errs(r).slice(0, 160));
  const victim = path.join(PROJ, '.superagent', 'lessons', 'sa-victim.md');
  ok('D-49 受害成员的错题本未被创建', !fs.existsSync(victim), victim);
}
{
  // 成员写自己 → 放行（身份一致，不是身份缺失）
  const r = gate({ ...GOOD, agent: 'sa-worker-one' }, { sessionId: WORKER });
  ok('D-49 成员写自己的错题本放行', r.ok === true, errs(r).slice(0, 160));
}
{
  // 缺 session_id → 无法核对身份 → 不放行（旧调用方补上即可）
  const r = gate({ ...GOOD, agent: 'sa-worker-one', session_id: '' });
  ok('D-49 缺 session_id 不放行',
    r.ok === false && r.errors.some(e => e.includes('session_id')),
    errs(r).slice(0, 160));
}
{
  // 父会话身份同样要可核对：会话既没有子会话绑定、也不是任何派工的父会话 →
  // 身份无法核对 → 不放行（不能「载荷说我是父会话就算父会话」）
  const r = gate({ ...GOOD, agent: 'sa-rogue' }, { sessionId: 'sess-not-in-ledger' });
  ok('D-49 身份无法核对的会话被拒',
    r.ok === false && errs(r).includes('身份无法核对'),
    errs(r).slice(0, 200));
}
{
  // 条目里写进「写入者」，便于事后追责
  const raw = fs.readFileSync(path.join(PROJ, '.superagent', 'lessons', 'sa-worker-one.md'), 'utf8');
  ok('D-49 条目内记录写入者',
    raw.includes('- 写入者：') && raw.includes('sess-worker-one') && raw.includes('会话'),
    JSON.stringify(raw.slice(-200)));
}

// ── 11. D-53：归因判定覆盖全部自由文本字段 ───────────────────
// 旧口径只查 cause + rule —— 把「Router 的锅」写进 symptom 就能绕过。
{
  const r = gate({ ...GOOD, agent: 'sa-attrib-symptom', symptom: 'Router 给错了 brief，我只是照做，返工了', cause: '我漏了回显口径' }, { sessionId: PARENT });
  ok('D-53 symptom 字段里的甩锅被拒',
    r.ok === false && r.errors.some(e => e.includes('归因指向 Router') && e.includes('symptom')),
    errs(r).slice(0, 200));
}
{
  const r = gate({ ...GOOD, agent: 'sa-attrib-rule', rule: 'Router 的锅，不该由我背' }, { sessionId: PARENT });
  ok('D-53 rule 字段里的甩锅被拒',
    r.ok === false && r.errors.some(e => e.includes('归因指向 Router') && e.includes('rule')),
    errs(r).slice(0, 200));
}
{
  const r = gate({ ...GOOD, agent: 'sa-attrib-next', next_time: '派工给错了要求时先退回给 Router' }, { sessionId: PARENT });
  ok('D-53 next_time 字段里的甩锅被拒',
    r.ok === false && r.errors.some(e => e.includes('归因指向 Router') && e.includes('next_time')),
    errs(r).slice(0, 200));
}
{
  // 豁免位逐字段适用：现象里提到 brief ≠ 甩锅（成员在描述自己看到的现象）
  const r = gate({ ...GOOD, agent: 'sa-attrib-ok', symptom: 'brief 要求回显口径，出图时漏了这一步', cause: '取数与出图之间没有强制回显生效条件' }, { sessionId: PARENT });
  ok('D-53 现象里提到 brief 不算甩锅（豁免逐字段生效）', r.ok === true, errs(r).slice(0, 200));
}

// ── 12. D-52：并发写同一错题本不丢条目 ───────────────────────
// 旧口径是「读全文 → 拼串 → 整体覆盖」，8 个并发最多落 5 条，且每次都返回 ok:true。
// 现在：跨进程锁 + 锁内重读 + 原子替换 + 落盘回读校验。
//
// 关键：**必须真并发**。用 spawnSync（同步阻塞）包在 Promise 里仍是串行 ——
// 那样即使把写锁整个去掉，断言照样绿 —— 恒绿的断言等于没测。
// 这里用异步 spawn 让 8 个进程真正同时起跑，再统计落盘条目数。
{
  // 并发数取 12、且跑 3 轮 —— 每轮用独立成员名，各轮互不干扰计数。
  //
  // **并发数必须小于错题本条数上限（15）**：上限判定在锁内生效，
  // 并发数一旦追平上限，第 N 个写入必然被「已达上限」拒掉 ——
  // 那是**正确行为**不是缺陷（实测：16 并发时第 16 个稳定报上限）。
  // 改并发数前先看 MAX_RULES。
  //
  // 三个关键（缺一个，这条断言就废了）：
  //  1) **必须真并发**：spawnSync 包在 Promise 里仍是串行，去掉写锁照样绿。
  //  2) **必须同时起跑**（起跑号牌）：旧口径的丢条目是概率性的 ——
  //     进程错峰起跑时后起的进程读到的快照已含前几条，就丢不了条目，
  //     断言会「碰巧绿」（上一轮实测：同一变异体一次 2 红、另一次 0 红）。
  //     号牌把大家卡在同一条起跑线上 ⇒ 读快照窗口必然重叠 ⇒ 红了就是稳定红。
  //  3) **判据用不变量**（说成功的 == 落盘的），不用「条数 == 固定值」：
  //     固定条数把「静默丢条目」与「明确失败」混成同一个红，而明确失败在
  //     Windows 上偶发（杀毒软件占用文件）⇒ 断言会时敏。
  //     不变量把两件事分开：静默丢 ⇒ 集合不相等（红）；明确失败 ⇒ 集合仍相等，
  //     由「无明确失败」那条断言单独盯着。
  const N = 12;
  const ROUNDS = 3;
  const GATE = path.join(PLUGIN_ROOT, 'scripts', 'lessons-gate.mjs');
  const runner = makeBarrierRunner(tmp, 'd52-barrier');
  // 标记带「号」字：'并发标记1号' 不是 '并发标记10号' 的子串（否则逐条核对会串）
  const marker = (i) => '并发标记' + i + '号';
  let allReported = true;
  let invariantOk = true;
  let allPresent = true;
  let totalOk = 0;
  let totalFail = 0;
  let minEntries = Infinity;
  const failReasons = [];
  for (let round = 0; round < ROUNDS; round++) {
    const agent = 'sa-concurrent-r' + round;
    const goFile = path.join(tmp, 'go-r' + round + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.flag');
    const pend = [];
    for (let i = 0; i < N; i++) {
      const payload = { session_id: PARENT, agent, task: marker(i), type: '数据错误',
        symptom: '现象' + i, cause: '根因' + i, rule: '必须回显口径' + i,
        next_time: '派工时必须带口径' + i, occurrence: 'single' };
      pend.push(spawnBarrier(runner, goFile, GATE, JSON.stringify(payload)));
    }
    await Promise.all(pend.map((p) => p.ready));    // 全部就位
    fs.writeFileSync(goFile, 'go');                  // 号令一发，同时冲
    const results = await Promise.all(pend.map((p) => p.done));
    const okSet = new Set();
    const failSet = new Set();
    let ambiguous = 0;
    results.forEach((o, i) => {
      if (o && o.ok === true) okSet.add(i);
      else if (o && o.ok === false) {
        failSet.add(i);
        failReasons.push(JSON.stringify(o.errors || o).slice(0, 160));
      } else {
        ambiguous++;
        failReasons.push('无法判定成败：' + JSON.stringify(o).slice(0, 160));
      }
    });
    totalOk += okSet.size;
    totalFail += failSet.size;
    if (ambiguous > 0 || okSet.size + failSet.size !== N) allReported = false;
    // 文件不存在时**不要抛异常**：抛异常会让整个套件崩掉，
    // 把后面所有断言的结果一起吞掉（看不出到底哪一条坏了）。
    let raw = '';
    try {
      raw = fs.readFileSync(path.join(PROJ, '.superagent', 'lessons', agent + '.md'), 'utf8');
    } catch {
      failReasons.push('落盘文件不存在：' + agent + '.md');
    }
    const entries = (raw.match(/^##\s+\d{4}-\d{2}-\d{2}\s+·/gm) || []).length;
    if (entries < minEntries) minEntries = entries;
    const diskSet = new Set();
    for (let i = 0; i < N; i++) if (raw.includes(marker(i))) diskSet.add(i);
    // 不变量：说成功的集合 == 落盘的集合（一个不多、一个不少）
    if (okSet.size !== diskSet.size || Array.from(okSet).some((i) => !diskSet.has(i))) invariantOk = false;
    if (diskSet.size !== N) allPresent = false;
  }
  const diag = 'ok=' + totalOk + ' 明确失败=' + totalFail + ' 最少落盘条目数=' + minEntries +
    (failReasons.length ? ' 首条失败原因=' + failReasons[0] : '');
  ok('D-52 并发写入全部返回成功或明确失败（不谎报）', allReported, diag);
  ok('D-52 并发写入不丢条目（说成功的都真落盘：' + N + ' 并发 × ' + ROUNDS + ' 轮）', invariantOk, diag);
  ok('D-52 并发写入的每一条都在文件里', allPresent, diag);
  ok('D-52 并发写入无明确失败（每一次写入都真的落盘）', totalFail === 0, diag);
}

// ── 13. D-55：Router 私有账写入闸门 ──────────────────────────
// 以前 _router.md 只读不写：没有模板校验、没有编号校验、没有上限、没有留痕。
const ROUTER_OK = {
  id: 'RT-01',
  trigger: 'Router 给错 brief',
  impact: '成员返工',
  repro: '1) 派工 2) 看成员返工',
  evidence: '回归日志',
  status: '已复现',
  fix: '派工前复述口径',
  need: '无，代码路径已确定'
};
{
  const r = gate(ROUTER_OK, { router: true, sessionId: PARENT });
  ok('D-55 Router 私有账合规条目写入成功', r.ok === true, JSON.stringify(r).slice(0, 200));
  const raw = fs.readFileSync(path.join(PROJ, '.superagent', 'lessons', '_router.md'), 'utf8');
  ok('D-55 私有账条目按 S1 七字段落盘',
    raw.includes('- 触发条件：') && raw.includes('- 影响：') && raw.includes('- 复现步骤：') &&
    raw.includes('- 证据：') && raw.includes('- 状态：') && raw.includes('- 修法方向：') && raw.includes('- 还需要什么：'),
    raw.slice(0, 200));
  ok('D-55 私有账写入留痕（changes.log 有记录）',
    fs.readFileSync(path.join(PROJ, '.superagent', 'changes.log'), 'utf8').includes('RT-01'), '');
}
{
  const r = gate({ ...ROUTER_OK, id: 'RT-03' }, { router: true, sessionId: PARENT });
  ok('D-55 编号跳号被拒',
    r.ok === false && r.errors.some(e => e.includes('不跳号') || e.includes('递增')),
    errs(r).slice(0, 200));
}
{
  const r = gate({ ...ROUTER_OK, id: 'RT-02', trigger: '' }, { router: true, sessionId: PARENT });
  ok('D-55 缺 S1 字段被拒',
    r.ok === false && r.errors.some(e => e.includes('缺「触发条件」')),
    errs(r).slice(0, 200));
}
{
  const r = gate({ ...ROUTER_OK, id: 'X' }, { router: true, sessionId: PARENT });
  ok('D-55 编号格式非法被拒',
    r.ok === false && r.errors.some(e => e.includes('编号格式非法')),
    errs(r).slice(0, 200));
}
{
  // 成员子会话不得写编排层的账
  const r = gate({ ...ROUTER_OK, id: 'RT-02' }, { router: true, sessionId: WORKER });
  ok('D-55 成员子会话写私有账被拒',
    r.ok === false && r.errors.some(e => e.includes('只接受 Router 自己写')),
    errs(r).slice(0, 200));
}

// ── 14. D-51：段首定位口径统一 ───────────────────────────────
// 写入端曾用子串 indexOf('## 实战记录')，读取端按行首匹配 —— 正文里出现一次字面串，
// 新履历就落进前一个段，写进去却读不出来，条数还被提前触顶。
// 这里验证：读取端（lessons.mjs 的 locateRecordsSection）与写入端共用同一口径。
{
  const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lessons.mjs')).href);
  const tricky = ['# 成员', '', '## 归属', '详见 ## 实战记录 段的说明（这是正文里的字面串）', '',
    '## 实战记录', '', '### 2026-01-01 · 旧领域 · 旧任务', '- 做法：老做法', '',
    '## 验收清单', '- [ ] 口径已回显', ''].join('\n');
  const sec = mod.locateRecordsSection(tricky);
  ok('D-51 段首定位按行首锚定（不命中正文里的字面串）',
    sec.found && sec.title.trim() === '## 实战记录' && tricky.slice(sec.start).indexOf('## 归属') === -1,
    JSON.stringify({ title: sec.title, start: sec.start }));
  ok('D-51 段内只数真正的履历条（' + mod.countRecordsInSection(sec.body) + ' 条）',
    mod.countRecordsInSection(sec.body) === 1, sec.body.slice(0, 120));
  const appended = mod.appendRecordsEntry(tricky, '### 2026-02-02 · 新领域 · 新任务\n- 做法：新做法\n');
  ok('D-51 新条目插进真正的实战记录段（读得出来）',
    mod.locateRecordsSection(appended).body.includes('新任务') && !mod.locateRecordsSection(appended).body.includes('详见 ## 实战记录'),
    mod.locateRecordsSection(appended).body.slice(0, 160));
}

// ── 15. D-56 / D-57：取样名额与名录去重 ──────────────────────
// 这两条的落点在 records.mjs / roster.mjs，断言放在这里是因为它们与错题本同属「统计口径」。
{
  const recMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'records.mjs')).href);
  const rosterMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'roster.mjs')).href);
  ok('D-56 取样名额是单一常量（CLI 与注入层同源）',
    recMod.SUMMARY_MAX_MEMBERS === rosterMod.MAX_ROSTER,
    'SUMMARY_MAX_MEMBERS=' + recMod.SUMMARY_MAX_MEMBERS + ' MAX_ROSTER=' + rosterMod.MAX_ROSTER);
  ok('D-56 取样名额绑定名录上限（不可能有成员被名额挤掉）',
    recMod.SUMMARY_MAX_MEMBERS >= rosterMod.MAX_ROSTER,
    String(recMod.SUMMARY_MAX_MEMBERS));
  const dupRoster = { members: [{ name: 'sa-dup' }, { name: 'sa-dup' }, { name: 'sa-other' }] };
  const deduped = rosterMod.listMembers(dupRoster);
  ok('D-57 同名成员去重（只留一条）',
    deduped.length === 2 && deduped.filter(m => m.name === 'sa-dup').length === 1,
    JSON.stringify(deduped.map(m => m.name)));
  ok('D-57 重名被显式报出（不静默去重）',
    JSON.stringify(rosterMod.duplicateNames(dupRoster)) === JSON.stringify(['sa-dup']),
    JSON.stringify(rosterMod.duplicateNames(dupRoster)));
}

// ── 16. D-50：错题本状态三态（「0 条」不是一个状态，是三个） ────
// 旧口径只分「抽得出 / 抽不出」，抽不出就一律说成「0 条（还没栽过跟头）」——
// 把「文件在、有条目、却一条规则都抽不出来」这种**通道故障**谎报成**没有教训**，
// Router 据此以为该成员干净，继续派同类活。
// 这一组只验 lessons.mjs 侧的状态判定；注入层接线（dispatch.mjs）不在本轮范围内。
{
  const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lessons.mjs')).href);
  // 让进程内的 lessons.mjs 也指向沙箱（projectDir() 读 MINIMAX_PROJECT_DIR）
  process.env.MINIMAX_PROJECT_DIR = PROJ;
  const dir = path.join(PROJ, '.superagent', 'lessons');

  // (1) 没有错题本文件 —— 真空态
  const noFile = mod.readLessonsStatus('sa-d50-nofile');
  ok('D-50 无错题本文件 = 真空态（no-file）',
    noFile.state === 'no-file' && noFile.fileExists === false, JSON.stringify(noFile));

  // (2) 文件在但没有条目 —— 也是真空态，但必须与「读不出」分开
  fs.writeFileSync(path.join(dir, 'sa-d50-empty.md'), '# sa-d50-empty\n\n（还没记过）\n', 'utf8');
  const empty = mod.readLessonsStatus('sa-d50-empty');
  ok('D-50 文件在但无条目 = 真空态（empty）',
    empty.state === 'empty' && empty.fileExists === true && empty.entries === 0, JSON.stringify(empty));

  // (3) 有条目却抽不出规则 —— 规则行不是「- **规则**：」格式 → 异常态，不是真空态
  fs.writeFileSync(path.join(dir, 'sa-d50-odd.md'),
    '# sa-d50-odd\n\n## 2026-01-01 · 任务「x」· 类型：判断错\n- 规则：必须先回显口径\n', 'utf8');
  const odd = mod.readLessonsStatus('sa-d50-odd');
  ok('D-50 有条目却抽不出规则 = 异常态（unreadable），不是真空态',
    odd.state === 'unreadable' && odd.entries === 1 && odd.rules.length === 0, JSON.stringify(odd));

  // (4) 正常条目 —— 抽得出规则
  fs.writeFileSync(path.join(dir, 'sa-d50-good.md'),
    '# sa-d50-good\n\n## 2026-01-01 · 任务「x」· 类型：判断错\n- **规则**：必须先回显口径\n', 'utf8');
  const good = mod.readLessonsStatus('sa-d50-good');
  ok('D-50 有条目且抽得出规则 = 正常态（entries）',
    good.state === 'entries' && good.rules.length === 1, JSON.stringify(good));

  // (5) 三种「0 条」的措辞必须互不相同 —— 否则「读不出」又被说成「没栽过跟头」
  const lNoFile = mod.lessonsStatusLine('sa-d50-nofile');
  const lEmpty = mod.lessonsStatusLine('sa-d50-empty');
  const lOdd = mod.lessonsStatusLine('sa-d50-odd');
  ok('D-50 异常态明确标为通道异常待查（不谎报成真空态）',
    lOdd.includes('待查') && lOdd.includes('通道异常'), lOdd);
  ok('D-50 三态措辞互不相同（不会都塌成同一句）',
    lNoFile !== lEmpty && lEmpty !== lOdd && lNoFile !== lOdd,
    JSON.stringify([lNoFile, lEmpty, lOdd]));
}

// ── 17. D-59 / D-60 / D-61 / D-62：Windows 并发写四缺陷的**专属**断言 ──
//
// 这一组是本轮新增的专属断言。上一轮这四条修复**没有自己的断言**：
// 回退实现后回归一条都不红（独立验收 F-02 查实：D-59 / D-60 / D-62 回退后 0 红；
// D-61 只靠 D-52 的并发断言间接暴露，且**时敏** —— 一次跑出 2 红、另一次 0 红）。
//
// 为什么用**故障注入**而不是撞概率：
//   D-59（rename 报 EPERM）与 D-61（抢锁报 EPERM）在真实环境里是**偶发**的。
//   靠真实并发去撞，撞到与否看运气 —— 断言就成了概率性的。
//   所以 lessons.mjs 加了**仅测试可见**的故障注入钩子：
//     SAR_FAULT_INJECT = 逗号分隔的 token（rename-eperm / lock-eperm / verify-fail）
//     SAR_FAULT_RUN    = 批次号（变了就重新武装计数）
//   默认关闭：不设 SAR_FAULT_INJECT 时钩子是 no-op，生产路径一个字节都不变。
//   本节每条用例都**显式**传 fault + 批次号 —— 不传就没有注入。
//
// 每条断言都走**真实闸门**（lessons-gate.mjs 子进程），不是直接调内部函数：
//   钩子装在 writeFileLocked / withFileLock 里，闸门走的就是这条路径。
{
  // ── D-59：Windows 上 rename 覆盖被占用文件报 EPERM ──
  // 修法 = 重试。断言：注入一次 EPERM 后写入**仍然成功**，且条目**真的落盘**。
  // 回退实现（只 rename 一次、不重试）⇒ 写入失败 ⇒ 这两条断言转红。
  {
    const agent = 'sa-d59-rename';
    const r = gate({ ...GOOD, agent, task: 'D59 注入 EPERM' }, { fault: 'rename-eperm' });
    ok('D-59 rename 遇 EPERM 会重试（写入不静默少条目）', r.ok === true, errs(r).slice(0, 200));
    const p = path.join(PROJ, '.superagent', 'lessons', agent + '.md');
    const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    ok('D-59 重试后条目真的落盘', raw.includes('D59 注入 EPERM'), raw.slice(-120));
  }

  // ── D-60：落盘回读校验失败未回滚 ⇒ 一次失败写入抹掉前序条目 ──
  // 修法 = 回滚。断言：校验失败时判失败（不谎报），且**文件回到写入前的内容**
  // —— 前序条目还在、新条目没落。
  // 注入 verify-fail = 「另一个写入方用过期快照覆盖了文件」⇒ 校验必然失败，
  // 且失败时文件里已不含前序条目（这正是 D-60 的后果）。
  // 回退实现（不回滚）⇒ 文件停在被覆盖的状态 ⇒ 前序条目被抹掉 ⇒ 断言转红。
  {
    const agent = 'sa-d60-rollback';
    const p = path.join(PROJ, '.superagent', 'lessons', agent + '.md');
    const r0 = gate({ ...GOOD, agent, task: 'D60 存量条目' });
    ok('D-60 前置：存量条目写入成功', r0.ok === true, errs(r0).slice(0, 160));
    const before = fs.readFileSync(p, 'utf8');
    const r1 = gate({ ...GOOD, agent, task: 'D60 新增条目' }, { fault: 'verify-fail' });
    ok('D-60 回读校验失败时判失败（不谎报成功）', r1.ok === false, JSON.stringify(r1).slice(0, 200));
    const after = fs.readFileSync(p, 'utf8');
    ok('D-60 校验失败已回滚（前序条目未被这次失败写入抹掉）',
      after === before && after.includes('D60 存量条目') && !after.includes('D60 新增条目'),
      '写入前 ' + before.length + ' 字 / 写入后 ' + after.length + ' 字 / 仍含存量=' + after.includes('D60 存量条目'));
  }

  // ── D-61：Windows 抢锁报 EPERM 被误判成失败（锁本身是对的）──
  // 修法 = EEXIST / EPERM 一律当「暂时拿不到」，继续等。
  // 断言：注入一次抢锁 EPERM 后写入**仍然成功**（不误判失败），且条目真的落盘。
  // 回退实现（只认 EEXIST）⇒ 报「获取写锁失败：EPERM」⇒ 断言转红。
  {
    const agent = 'sa-d61-lock';
    const r = gate({ ...GOOD, agent, task: 'D61 抢锁 EPERM' }, { fault: 'lock-eperm' });
    ok('D-61 抢锁遇 EPERM 当作「暂时拿不到」继续等（不误判失败）', r.ok === true, errs(r).slice(0, 200));
    const p = path.join(PROJ, '.superagent', 'lessons', agent + '.md');
    const raw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    ok('D-61 等到锁之后写入真的落盘', raw.includes('D61 抢锁 EPERM'), raw.slice(-120));
  }

  // ── D-62：锁等待超时（15s）短于持有者的重试窗口（8.8s）──
  // 两条断言：一条**配置**（常量之间的关系，可验算）、一条**行为**（真排队）。
  {
    const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lessons.mjs')).href);
    const libMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs')).href);
    // (1) 偷锁阈值必须**大于**等待超时：否则会把「还在用的锁」当陈旧锁偷走，
    //     两个写入方同时进临界区。
    ok('D-62 偷锁阈值 > 等待超时（不能把还在用的锁当陈旧锁偷走）',
      mod.LOCK_STALE_MS > mod.LOCK_WAIT_TIMEOUT_MS,
      '偷锁阈值=' + mod.LOCK_STALE_MS + 'ms 等待超时=' + mod.LOCK_WAIT_TIMEOUT_MS + 'ms');
    // (2) 等待超时必须**长于**持有者一个临界区的最坏时长（rename 重试窗口 8.8s）：
    //     否则持有者还在重试，排队方已经超时 → 排队方被误判成失败。
    ok('D-62 等待超时 > 持有者最坏临界区（rename 重试窗口）',
      mod.LOCK_WAIT_TIMEOUT_MS > mod.RENAME_RETRY_WINDOW_MS,
      '等待超时=' + mod.LOCK_WAIT_TIMEOUT_MS + 'ms 重试窗口=' + mod.RENAME_RETRY_WINDOW_MS + 'ms');
    // (3) 排队容忍度：编排层同时最多 MAX_ACTIVE_DISPATCHES(=6) 个派工在飞，
    //     每个写入方的临界区最坏 RENAME_RETRY_WINDOW_MS ⇒ 等待超时要容得下这么多轮。
    //     旧口径 15s：15000 < 6×8800=52800 ⇒ 只容得下 1 轮 ⇒ 第二个排队方即被误判失败。
    const need = libMod.MAX_ACTIVE_DISPATCHES * mod.RENAME_RETRY_WINDOW_MS;
    ok('D-62 等待超时应容得下编排层最大并发数（' + libMod.MAX_ACTIVE_DISPATCHES + '）轮持有者',
      mod.LOCK_WAIT_TIMEOUT_MS >= need,
      '等待超时=' + mod.LOCK_WAIT_TIMEOUT_MS + 'ms 需要>=' + need + 'ms');
  }
  {
    // 行为断言：锁被别的写入方占着时，排队的一方必须**等**，不能被误判成失败。
    // 持锁时长必须**大于旧口径的等待超时（15s）**，否则旧口径也会绿 ⇒ 断言没有区分力。
    const HOLD_MS = 16000;
    const agent = 'sa-d62-queue';
    const target = path.join(PROJ, '.superagent', 'lessons', agent + '.md');
    fs.writeFileSync(target, '# ' + agent + '\n', 'utf8');
    // 持锁方：拿到锁后睡 HOLD_MS 再释放（子进程，不占本测试进程）
    const holderScript = path.join(tmp, 'd62-holder.mjs');
    fs.writeFileSync(holderScript, [
      "import { withFileLock } from " + JSON.stringify(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lessons.mjs')).href) + ";",
      "const target = process.argv[2];",
      "const holdMs = parseInt(process.argv[3] || '16000', 10);",
      "const r = withFileLock(target, () => {",
      "  process.stdout.write('HELD\\n');",
      "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);",
      "  return { ok: true };",
      "}, { timeoutMs: 5000 });",
      "process.stdout.write('DONE ' + JSON.stringify(r) + '\\n');"
    ].join('\n'), 'utf8');
    const holder = spawn('node', [holderScript, target, String(HOLD_MS)], { encoding: 'utf8' });
    let hbuf = '';
    holder.stderr.on('data', (c) => { hbuf += '[stderr]' + c; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('持锁方 10s 内没拿到锁：' + hbuf.slice(0, 120))), 10000);
      holder.stdout.on('data', (c) => {
        hbuf += c;
        if (hbuf.indexOf('HELD') !== -1) { clearTimeout(timer); resolve(); }
      });
      holder.on('close', () => { clearTimeout(timer); reject(new Error('持锁方提前退出：' + hbuf.slice(0, 120))); });
    });
    const t0 = Date.now();
    const r = await gateAsync({ ...GOOD, agent, task: 'D62 排队写入' });
    const waited = Date.now() - t0;
    ok('D-62 锁被占用时排队写入方不被误判失败', r && r.ok === true, JSON.stringify(r).slice(0, 200));
    ok('D-62 排队写入方确实等到了锁释放（等 ' + waited + 'ms ≥ 持锁 ' + HOLD_MS + 'ms）',
      waited >= HOLD_MS - 500, '实际等待=' + waited + 'ms');
    try { holder.kill(); } catch { /* 已经退出了 */ }
  }
}

console.log(fail === 0 ? '>>> LESSONS ALL PASS' : '>>> LESSONS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
