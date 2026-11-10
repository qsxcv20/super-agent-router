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

function gate(payload, opts = {}) {
  // session_id 是「谁在写」的声明（D-49）：闸门拿它去台账查绑定，不靠载荷自称。
  const body = { session_id: opts.sessionId || PARENT, ...payload };
  const args = [path.join(PLUGIN_ROOT, 'scripts', 'lessons-gate.mjs')];
  if (opts.router) args.push('--router');
  args.push(JSON.stringify(body));
  const r = spawnSync('node', args, {
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = { raw: r.stdout, err: r.stderr }; }
  return out;
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
  // 并发数取 12、且跑 3 轮 —— 旧口径的丢条目是**概率性**的：
  // 进程启动错峰时，后起的进程读到的快照已经含前几条，就丢不了条目，
  // 断言会「碰巧绿」（变异检验实测：8 并发单轮时绿、红各出现过一次）。
  // 12 个进程 × 3 轮 = 36 次写入机会，任何一轮丢条目即判红；
  // 每轮用独立成员名，各轮互不干扰计数。
  //
  // **并发数必须小于错题本条数上限（15）**：上限判定在锁内生效，
  // 并发数一旦追平上限，第 N 个写入必然被「已达上限」拒掉 ——
  // 那是**正确行为**不是缺陷（实测：16 并发时第 16 个稳定报上限）。
  // 改并发数前先看 MAX_RULES。
  const N = 12;
  const ROUNDS = 3;
  const run = (agent, i) => new Promise((resolve) => {
    const child = spawn('node', [path.join(PLUGIN_ROOT, 'scripts', 'lessons-gate.mjs'),
      JSON.stringify({ session_id: PARENT, agent, task: '并发' + i, type: '数据错误',
        symptom: '现象' + i, cause: '根因' + i, rule: '必须回显口径' + i,
        next_time: '派工时必须带口径' + i, occurrence: 'single' })], {
      encoding: 'utf8',
      env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
    });
    let buf = '';
    child.stdout.on('data', (c) => { buf += c; });
    child.on('close', () => {
      let out = {};
      try { out = JSON.parse(buf); } catch {}
      resolve(out);
    });
  });
  let reported = 0;
  let allReported = true;
  let allCounted = true;
  let allPresent = true;
  let minEntries = Infinity;
  for (let round = 0; round < ROUNDS; round++) {
    const agent = 'sa-concurrent-r' + round;
    const results = await Promise.all(Array.from({ length: N }, (_, i) => run(agent, i)));
    const okCount = results.filter((x) => x.ok === true).length;
    reported += okCount;
    if (okCount + results.filter((x) => x.ok === false).length !== N) allReported = false;
    const raw = fs.readFileSync(path.join(PROJ, '.superagent', 'lessons', agent + '.md'), 'utf8');
    const entries = (raw.match(/^##\s+\d{4}-\d{2}-\d{2}\s+·/gm) || []).length;
    if (entries < minEntries) minEntries = entries;
    if (entries !== N) allCounted = false;
    // 逐条核对：不是「数对了但少了某几条」，而是每条都在
    if (!Array.from({ length: N }, (_, i) => raw.includes('并发' + i)).every(Boolean)) allPresent = false;
  }
  ok('D-52 并发写入全部返回成功或明确失败（不谎报）', allReported, 'ok=' + reported);
  ok('D-52 并发写入不丢条目（' + N + ' 次并发 × ' + ROUNDS + ' 轮 → 最少 ' + minEntries + ' 条）',
    allCounted && minEntries === N, '最少落盘条目数=' + minEntries);
  ok('D-52 并发写入的每一条都在文件里', allPresent, '');
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

console.log(fail === 0 ? '>>> LESSONS ALL PASS' : '>>> LESSONS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
