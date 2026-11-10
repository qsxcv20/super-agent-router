// 履历（实战记录）闭环回归测试
// 用法：node tests/records-test.mjs
//   默认跑安装副本；跑仓库副本请显式指定：
//   $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\records-test.mjs
//
// 验证这些事：
//   1. 验收通过的成果能写进方法论文件
//   2. 执行者不可自证
//   3. 缺证据 / 缺做法 / 缺领域 被拒
//   4. 方法论文件不存在被拒
//   5. 上限 20 条，只增不减的履历要被拦
//   6. 匹配阶段注入参考，但不改 owns
//   7. D-13：验收方必须在派工台账里有 state=done 的记录（不能凭空伪造）
//   8. D-13 向后兼容：历史履历（verified_by 不在台账里）仍能读出
//   9. D-21：段首定位口径统一 —— 长前导文件里 20 条上限真的会触发、计数正确
//   10. D-24：摘要取样不再按名录顺序截断，靠后的成员可见 + 省略者被披露
//   11. D-52：并发写履历不丢条目（真并发 + 起跑号牌 + 不变量判据）
//   12. D-59 / D-60：rename 重试与回读校验失败回滚（故障注入，专属断言）
//
// 每个用例用独立成员，避免用例之间互相污染记录池。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-rec-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, '.superagent', 'methods'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.superagent', 'lessons'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };
// 成功时返回里没有 errors 字段 —— 断言文案统一走这个助手，
// 免得「断言本身抛异常」把真正的红绿信息吃掉。
const errs = (r) => JSON.stringify((r && r.errors) || []);

// ── 派工台账（D-13 的凭据来源） ─────────────────────────────
// 契约 S7.1：verified_by 必须在台账里有一条 agent==它 且 state=='done' 的记录。
// 这里造一条已回收的验收派工当凭据；其余用例据此判定真伪。
function ledgerFile() { return path.join(DATA, 'dispatches.json'); }
function setLedger(dispatches) {
  let bindings = [];
  try { bindings = JSON.parse(fs.readFileSync(ledgerFile(), 'utf8')).bindings || []; } catch {}
  writeLedgerFull(dispatches, bindings);
}
function addDispatch(d) {
  let l = { dispatches: [], bindings: [] };
  try { l = JSON.parse(fs.readFileSync(ledgerFile(), 'utf8')); } catch {}
  if (!Array.isArray(l.dispatches)) l.dispatches = [];
  l.dispatches.push(d);
  writeLedgerFull(l.dispatches, l.bindings || []);
}
setLedger([
  { dispatch_id: 'dsp_v1', parent_session_id: 's1', turn_id: 't1', agent: 'verifier', scope: [], state: 'done', at: Date.now() }
]);

// ── 写入者身份夹具（D-49）──────────────────────────────────
// record-gate 现在也要核对「谁在写」：调用方带 session_id，
// 闸门拿它去派工台账查这个会话绑定的是谁，再与载荷里的 agent 比对。
// 这里造两条：
//   PARENT  = 父会话（Router），可以给本项目任何成员记履历
//   WORKER  = 绑定成员 sa-chart-plot 的子会话，只能写自己的履历
const PARENT = 'mvs-parent-record';
const WORKER = 'sess-record-worker';
// 注意：setLedger() 会把 bindings 重置为空数组 ——
// 所以每次改台账都要把 bindings 一起写回去，否则绑定凭空消失。
function writeLedgerFull(dispatches, bindings) {
  fs.writeFileSync(ledgerFile(), JSON.stringify({ dispatches, bindings }, null, 2), 'utf8');
}
// 父会话身份也要在台账里有据：既要有以它为 parent_session_id 的派工行，
// 也要有绑定表里 parent_session_id 指向它的行 —— 两条都认（resolveWriter 的口径）。
const BASE_DISPATCHES = [
  { dispatch_id: 'dsp_v1', parent_session_id: 's1', turn_id: 't1', agent: 'verifier', scope: [], state: 'done', at: Date.now() },
  { dispatch_id: 'dsp_p1', parent_session_id: PARENT, turn_id: 'tp1', agent: 'sa-chart-plot', agent_key: 'sa-chart-plot', scope: [], state: 'done', at: Date.now() }
];
const BASE_BINDINGS = [
  { session_id: WORKER, parent_session_id: PARENT, agent: 'sa-chart-plot', agent_key: 'sa-chart-plot', scope: [], at: Date.now() },
  { session_id: 'sess-other-child', parent_session_id: PARENT, agent: 'sa-other', agent_key: 'sa-other', scope: [], at: Date.now() }
];
writeLedgerFull(BASE_DISPATCHES, BASE_BINDINGS);

// 故障注入的批次号：每条用例换一个批次号，额度随之归零。
let faultRunSeq = 0;

function gate(payload, opts = {}) {
  // session_id = 「谁在写」的声明（D-49）：闸门拿它去台账查绑定，不靠载荷自称。
  const env = { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA };
  if (opts.noLedger) delete env.PLUGIN_DATA;
  // 故障注入（D-59/D-60 的断言要确定性 —— 错误由用例指定，不靠真实并发去撞）。
  // 不传 opts.fault 时环境里没有这两个变量 ⇒ 生产路径不变。
  if (opts.fault) {
    env.SAR_FAULT_INJECT = opts.fault;
    env.SAR_FAULT_RUN = opts.faultRun || ('f02-rec-run-' + (faultRunSeq++));
  }
  const body = { session_id: opts.sessionId || PARENT, ...payload };
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'record-gate.mjs'), JSON.stringify(body)], {
    encoding: 'utf8',
    env
  });
  try { return JSON.parse(r.stdout); } catch { return { raw: r.stdout, err: r.stderr }; }
}

// ── 起跑号牌（并发断言的确定性来源）───────────────────────────
// 为什么需要：旧口径的丢条目是**概率性**的 —— 写入方错峰起跑时，后起的进程
// 读到的快照已经含前几条，就丢不了条目，断言会「碰巧绿」。
// 号牌把所有写入方卡在同一条起跑线上，号令一发同时冲 ⇒ 红了就是稳定红。
// 脚本写在临时目录里（不进仓库）：它只是「等号 → 再调闸门」的一层壳。
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
  // 环境必须**显式**带上沙箱路径：不带的话闸门会按 cwd 定位项目目录（D-64 同族）。
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

function makeMember(name) {
  const p = path.join(PROJ, '.superagent', 'methods', name + '.md');
  fs.writeFileSync(p, '# ' + name + '\n\n## 归属\n做一件事\n\n## 方法\n1. 取数\n2. 产出\n\n## 验收清单\n- [ ] 口径已回显\n', 'utf8');
  return p;
}

// 「长前导 + 短记录段」的方法论文件：段首绝对索引远大于段内剩余长度。
// 旧口径（把相对偏移当绝对索引用）会 slice 出空串 → existing=0 → 上限永不触发。
function makeLongMethod(name, n) {
  const p = path.join(PROJ, '.superagent', 'methods', name + '.md');
  const lines = ['# ' + name, '', '## 归属', '背景。'.repeat(2000), '', '## 实战记录', ''];
  for (let k = 0; k < n; k++) {
    lines.push('### 2026-03-01 · 领域' + k + ' · 任务' + k);
    lines.push('- 做法：做法' + k);
    lines.push('- 证据：证据' + k);
    lines.push('- 验收：verifier');
    lines.push('');
  }
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  return p;
}

const GOOD = {
  task: '月度对比图',
  domain: '图表绘制',
  approach: '先回显生效筛选条件，再出图并把口径写进图注',
  evidence: 'output/monthly.png，由 verifier 比对口径确认',
  verified_by: 'verifier'
};

// 1. 合规成果写入成功
const AGENT = 'sa-chart-plot';
const METHOD = makeMember(AGENT);
{
  const r = gate({ ...GOOD, agent: AGENT });
  ok('合规成果写入成功', r.ok === true, JSON.stringify(r).slice(0, 140));
  const raw = fs.readFileSync(METHOD, 'utf8');
  ok('实战记录段已建', raw.includes('## 实战记录') && raw.includes('### '), raw.slice(-160));
  ok('记录含做法与证据', raw.includes('- 做法：') && raw.includes('- 证据：'), '');
}

// 2. 执行者不可自证
{
  const r = gate({ ...GOOD, agent: AGENT, task: '自证测试', verified_by: AGENT });
  ok('自证被拒', r.ok === false && r.errors.some(e => e.includes('执行人自己')), JSON.stringify(r.errors));
}

// 3. 缺证据被拒
{
  const r = gate({ ...GOOD, agent: AGENT, task: '缺证据', evidence: '' });
  ok('缺证据被拒', r.ok === false && r.errors.some(e => e.includes('evidence')), JSON.stringify(r.errors));
}

// 4. 缺做法被拒
{
  const r = gate({ ...GOOD, agent: AGENT, task: '缺做法', approach: '' });
  ok('缺做法被拒', r.ok === false && r.errors.some(e => e.includes('approach')), JSON.stringify(r.errors));
}

// 5. 缺领域被拒
{
  const r = gate({ ...GOOD, agent: AGENT, task: '缺领域', domain: '' });
  ok('缺领域被拒', r.ok === false && r.errors.some(e => e.includes('domain')), JSON.stringify(r.errors));
}

// 6. 方法论文件不存在被拒
{
  const r = gate({ ...GOOD, agent: 'sa-not-exist', task: '无方法论' });
  ok('无方法论文件被拒', r.ok === false && r.errors.some(e => e.includes('方法论')), JSON.stringify(r.errors));
}

// 7. 上限 20 条（用独立成员，不污染其他用例）
{
  const BATCH = 'sa-batch-fill';
  const BMETHOD = makeMember(BATCH);
  let lastErr = null;
  for (let i = 0; i < 22; i++) {
    const r = gate({ ...GOOD, agent: BATCH, task: '批量' + i, approach: '做法' + i });
    if (r.ok === false) lastErr = r;
  }
  const raw = fs.readFileSync(BMETHOD, 'utf8');
  const cnt = (raw.slice(raw.indexOf('## 实战记录')).match(/^###\s/gm) || []).length;
  ok('上限后被拦', !!lastErr && lastErr.errors.some(e => e.includes('上限')), JSON.stringify(lastErr && lastErr.errors));
  ok('记录数不超过 20', cnt <= 20, String(cnt));
}

// 8. 读取能还原记录
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'records.mjs'), AGENT], {
    encoding: 'utf8', env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  let out = {};
  try { out = JSON.parse(r.stdout); } catch {}
  ok('records.mjs 能读出记录', Array.isArray(out.records) && out.records.length > 0, JSON.stringify(out).slice(0, 120));
  ok('记录含做法与证据', !!(out.records && out.records[0].approach && out.records[0].evidence), '');
}

// 9. 匹配阶段注入参考（用独立成员）
const MATCH = 'sa-chart-match';
makeMember(MATCH);
gate({ ...GOOD, agent: MATCH, task: '趋势对比图', approach: '折线加同比基线' });
{
  const roster = {
    version: 1, updated: '2026-11-09',
    members: [{ name: MATCH, kind: 'specialist', source: 'runtime', owns: '出图', accepts: '需要出图', reject: '不取数' }]
  };
  fs.writeFileSync(path.join(PROJ, '.superagent', 'roster.json'), JSON.stringify(roster, null, 2), 'utf8');
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '这个需求拆成几个专项并行做，谁来负责？', session_id: 'rec1' }),
    encoding: 'utf8', env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  const out = r.stdout || '';
  ok('匹配阶段注入实战记录', out.includes('实战记录') && out.includes('趋势对比图'), out.slice(0, 220));
  ok('注入时声明不改归属', out.includes('不要据此自动改写归属声明'), out.slice(0, 500));
}

// 10. 注入后 owns 未被改写
{
  const j = JSON.parse(fs.readFileSync(path.join(PROJ, '.superagent', 'roster.json'), 'utf8'));
  ok('roster owns 未被自动改写', j.members[0].owns === '出图', j.members[0].owns);
}

// 11. 派工时注入履历与教训
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'rec2', turn_id: 'rt1',
      tool_input: { agent_name: MATCH, prompt: 'SCOPE: a.ts' }
    }),
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  const out = r.stdout || '';
  ok('派工时注入实战记录', out.includes('实战记录') && out.includes('additionalContext'), out.slice(0, 160));
}

// 12. 无实战记录时不产生噪音
{
  const QUIET = 'sa-quiet';
  makeMember(QUIET);
  // roster 只留这个没有履历的成员，避免上一用例的成员干扰
  fs.writeFileSync(path.join(PROJ, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-11-09',
    members: [{ name: QUIET, kind: 'specialist', source: 'runtime', owns: '静默检查', accepts: '无', reject: '无' }]
  }, null, 2), 'utf8');
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '这个需求拆成几个专项并行做，谁来负责？', session_id: 'rec3' }),
    encoding: 'utf8', env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  const out = r.stdout || '';
  ok('无履历则不注入该段', !out.includes('实战记录（匹配参考）'), out.slice(0, 200));
}

// ── 13. D-13：验收方必须真实存在（台账里有 state=done 的记录） ──────
{
  const r = gate({ ...GOOD, agent: AGENT, task: '伪造验收方', verified_by: 'sa-ghost-verifier' });
  ok('D-13 台账里不存在的验收方被拒', r.ok === false && r.errors.some(e => e.includes('验收方') && e.includes('台账')), JSON.stringify(r.errors));
}
{
  addDispatch({
    dispatch_id: 'dsp_a1', parent_session_id: 's1', turn_id: 't2',
    agent: 'sa-active-verifier', scope: [], state: 'active', at: Date.now()
  });
  const r = gate({ ...GOOD, agent: AGENT, task: '未回收的派工', verified_by: 'sa-active-verifier' });
  ok('D-13 state=active 的验收方不被认可', r.ok === false && r.errors.some(e => e.includes('state=done')), JSON.stringify(r.errors));
}
{
  const r = gate({ ...GOOD, agent: AGENT, task: '台账不可用', verified_by: 'verifier' }, { noLedger: true });
  ok('D-13 台账不可用时拒绝写入', r.ok === false && r.errors.some(e => e.includes('台账为空') || e.includes('不可用')), JSON.stringify(r.errors));
}

// ── 14. D-13 向后兼容：历史履历照常读出 ──────────────────────
// 历史条目里的验收方可能早已不在台账里（名字被清理、早期还没有台账）。
// 读取路径不做台账校验 → 这些履历必须照常读得出来。
{
  const LEGACY = 'sa-legacy-member';
  const lp = path.join(PROJ, '.superagent', 'methods', LEGACY + '.md');
  fs.writeFileSync(lp, '# ' + LEGACY + '\n\n## 实战记录\n\n### 2026-01-02 · 旧领域 · 旧任务\n- 做法：老做法\n- 证据：老证据\n- 验收：sa-legacy-verifier\n', 'utf8');
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'records.mjs'), LEGACY], {
    encoding: 'utf8', env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  let out = {};
  try { out = JSON.parse(r.stdout); } catch {}
  ok('D-13 历史履历（验收方不在台账）仍能读出',
    Array.isArray(out.records) && out.records.length === 1 && out.records[0].verified === 'sa-legacy-verifier',
    JSON.stringify(out).slice(0, 160));
}

// ── 15. D-21：段首定位口径统一 ─────────────────────────────
// 计数路径必须与写入路径同口径：段内 3 条存量 + 新写 1 条 = 4。
{
  const CNT = 'sa-count-caliber';
  const cp = makeLongMethod(CNT, 3);
  const r = gate({ ...GOOD, agent: CNT, task: '计数口径' });
  ok('D-21 计数按段内实际条数（3 条存量 + 1 条新增 = 4）', r.ok === true && r.records === 4, JSON.stringify(r).slice(0, 160));
  const raw = fs.readFileSync(cp, 'utf8');
  const cnt = (raw.slice(raw.indexOf('## 实战记录')).match(/^###\s/gm) || []).length;
  ok('D-21 写盘条数与闸门计数一致', cnt === 4, String(cnt));
  // 旧口径复算：把「相对偏移当绝对索引」这一步单独算一遍 ——
  // 同一份输入下旧口径得 0、新口径得 4，证明这次修复改的是口径本身。
  const ss = raw.indexOf('## 实战记录');
  const rest = raw.slice(ss + '## 实战记录'.length);
  const relNext = rest.indexOf('\n## ') === -1 ? rest.length : rest.indexOf('\n## ');
  const oldCount = (raw.slice(ss, relNext).match(/^###\s/gm) || []).length;
  ok('D-21 旧口径复算确实为 0（同一输入下新旧口径可对比）', oldCount === 0 && cnt === 4, '旧口径:' + oldCount + ' 新口径:' + cnt);
}
{
  const LIM = 'sa-limit-caliber';
  makeLongMethod(LIM, 21);
  const r = gate({ ...GOOD, agent: LIM, task: '上限口径' });
  ok('D-21 长前导文件里 20 条上限真的会触发', r.ok === false && r.errors.some(e => e.includes('上限')), JSON.stringify(r.errors));
}

// ── 16. D-24：摘要取样不再按名录顺序截断 ─────────────────────
// 8 名成员都有战绩，名录排位靠后的那位战绩最多（5 条 vs 1 条）。
// 旧口径按名录顺序凑满 6 名就 break → 靠后成员结构性不可见。
{
  const members = [];
  for (let i = 1; i <= 8; i++) {
    const name = 'sa-roster-0' + i;
    const n = (i === 8) ? 5 : 1;
    const lines = ['# ' + name, '', '## 实战记录', ''];
    for (let k = 0; k < n; k++) {
      lines.push('### 2026-02-0' + (k + 1) + ' · 领域' + k + ' · 任务' + k);
      lines.push('- 做法：做法' + k);
      lines.push('- 证据：证据' + k);
      lines.push('- 验收：verifier');
      lines.push('');
    }
    fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', name + '.md'), lines.join('\n'), 'utf8');
    members.push({ name, kind: 'specialist', source: 'runtime', owns: '专项' + i, accepts: 'a', reject: 'r' });
  }
  fs.writeFileSync(path.join(PROJ, '.superagent', 'roster.json'),
    JSON.stringify({ version: 1, updated: '2026-11-10', members }, null, 2), 'utf8');

  process.env.MINIMAX_PROJECT_DIR = PROJ;
  const recMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'records.mjs')).href);
  const detail = recMod.summarizeRecordsDetailed(3, 6);
  const shown = detail.members.map(m => m.name);
  ok('D-24 名录靠后的成员不再结构性不可见', shown.includes('sa-roster-08'), shown.join(','));
  ok('D-24 取样按战绩排序而非名录顺序', shown[0] === 'sa-roster-08', shown.join(','));
  ok('D-24 被省略的成员被显式披露',
    detail.truncated === true && detail.totalMembers === 8 && detail.shownMembers === 6 && detail.omitted.length === 2,
    JSON.stringify({ total: detail.totalMembers, shown: detail.shownMembers, omitted: detail.omitted }));
  ok('D-24 summarizeRecords 向后兼容仍返回数组', Array.isArray(recMod.summarizeRecords(3,  6)));
  // 旧口径复算：沿名录顺序凑满 6 名就 break —— 同一份名录下靠后成员确实不可见。
  const rosterOrder = JSON.parse(fs.readFileSync(path.join(PROJ, '.superagent', 'roster.json'), 'utf8')).members.map(m => m.name);
  const oldShown = rosterOrder.slice(0,  6);
  ok('D-24 旧口径复算看不见靠后成员（新口径看得见）',
    !oldShown.includes('sa-roster-08') && shown.includes('sa-roster-08'),
    '旧口径:' + oldShown.join(',') + ' | 新口径:' + shown.join(','));
}

// ── 17. D-49：履历的写入者身份 ───────────────────────────────
// 履历是 Router 匹配成员时的依据 —— 谁都能往兄弟成员的方法论文件里塞「成果」，
// 那份文件就成了可伪造的匹配依据。写入目标不再由载荷独断。
{
  const r = gate({ ...GOOD, agent: 'sa-victim', task: '冒名写入' }, { sessionId: WORKER });
  ok('D-49 冒用他人身份写履历被拒',
    r.ok === false && (r.errors || []).some(e => e.includes('写入者身份不符')),
    errs(r).slice(0, 200));
  ok('D-49 受害成员的履历未被写入',
    !fs.existsSync(path.join(PROJ, '.superagent', 'methods', 'sa-victim.md')), '');
}
{
  const r = gate({ ...GOOD, agent: 'sa-chart-plot', task: '写自己' }, { sessionId: WORKER });
  ok('D-49 成员写自己的履历放行', r.ok === true, errs(r).slice(0, 200));
}
{
  // 条目里写进写入者，便于事后追责
  const raw = fs.readFileSync(path.join(PROJ, '.superagent', 'methods', 'sa-chart-plot.md'), 'utf8');
  ok('D-49 履历条目内记录写入者', raw.includes('- 写入者：') && raw.includes('会话'), JSON.stringify(raw.slice(-160)));
}

// ── 18. D-51：履历段首定位口径统一 ─────────────────────────
// 写入端曾用子串 indexOf('## 实战记录')，读取端按行首匹配。
// 方法论文件正文里只要出现一次字面串，新履历就落进前一个段 —— 写进去却读不出来，
// 段里的其它「###」还被当成履历条数，20 条上限被提前触顶。
{
  const TRICKY = 'sa-locate-tricky';
  const p2 = path.join(PROJ, '.superagent', 'methods', TRICKY + '.md');
  fs.writeFileSync(p2, ['# ' + TRICKY, '', '## 归属', '详见 ## 实战记录 段的说明（正文里的字面串）', '',
    '## 实战记录', '', '### 2026-01-01 · 旧领域 · 旧任务', '- 做法：老做法', '- 证据：老证据', '- 验收：verifier', '',
    '## 验收清单', '- [ ] 口径已回显', ''].join('\n'), 'utf8');
  const r = gate({ ...GOOD, agent: TRICKY, task: '定位口径' });
  ok('D-51 段首定位统一后写入成功', r.ok === true, errs(r).slice(0, 200));
  const raw = fs.readFileSync(p2, 'utf8');
  const secStart = raw.indexOf('\n## 实战记录');
  const secEnd = raw.indexOf('\n## 验收清单');
  const secBody = raw.slice(secStart, secEnd === -1 ? raw.length : secEnd);
  ok('D-51 新履历落进真正的实战记录段（不在归属段）',
    secBody.includes('定位口径') && !raw.slice(0, secStart).includes('定位口径'),
    JSON.stringify(raw.slice(0, 200)));
  const cnt = (secBody.match(/^###\s/gm) || []).length;
  ok('D-51 段内条数正确（1 条存量 + 1 条新增 = 2）', cnt === 2, String(cnt));
  // 口径敏感点：写入端若用子串 indexOf('## 实战记录')，会命中正文里那处字面串，
  // 新条目就落进「归属」段 —— 上面的断言正是卡这一条。
  // 这里再钉一个「段内条数不含归属段里的 ###」的判据：
  const attrSection = raw.slice(raw.indexOf('\n## 归属'), secStart);
  ok('D-51 归属段里的 ### 不被算成履历条数',
    !/^###\s/m.test(attrSection), JSON.stringify(attrSection.slice(0, 120)));
  // 读取端也要读得到（写进去 ≠ 读得出来，这是 D-51 的要害）
  const out = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'records.mjs'), TRICKY], {
    encoding: 'utf8', env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  let parsed = {};
  try { parsed = JSON.parse(out.stdout); } catch {}
  ok('D-51 新履历能被读取端读出',
    Array.isArray(parsed.records) && parsed.records.length === 2 &&
    parsed.records.some(x => x.title.includes('定位口径')),
    JSON.stringify(parsed).slice(0, 200));
}

// ── 19. D-52：并发写同一成员的履历不丢条目 ─────────────────
// 履历也是读-改-写整体覆盖：并发写会静默丢条目，且每次都返回 ok:true。
// **必须真并发**：spawnSync 包在 Promise 里仍是串行，那样去掉写锁断言照样绿。
{
  // 并发数取 16、且跑 3 轮 —— 每轮用独立成员名与方法论文件，各轮互不干扰计数。
  // **并发数必须小于履历条数上限（20）**：上限判定在锁内生效，
  // 并发数一旦追平上限，第 N 个写入必然被「已达上限」拒掉 ——
  // 那是**正确行为**不是缺陷。改并发数前先看 MAX_RECORDS。
  //
  // 三个关键（缺一个，这条断言就废了）：
  //  1) **必须真并发**：spawnSync 包在 Promise 里仍是串行，去掉写锁照样绿。
  //  2) **必须同时起跑**（起跑号牌）：旧口径的丢条目是概率性的 ——
  //     进程错峰起跑时后起的进程读到的快照已含前几条，就丢不了条目，
  //     断言会「碰巧绿」。号牌把大家卡在同一条起跑线上 ⇒ 红了就是稳定红。
  //  3) **判据用不变量**（说成功的 == 落盘的），不用「条数 == 固定值」：
  //     固定条数把「静默丢条目」与「明确失败」混成同一个红，而明确失败在
  //     Windows 上偶发（杀毒软件占用文件）⇒ 断言会时敏。
  const N = 16;
  const ROUNDS = 3;
  const GATE = path.join(PLUGIN_ROOT, 'scripts', 'record-gate.mjs');
  const runner = makeBarrierRunner(tmp, 'd52-records-barrier');
  // 标记带「号」字：'并发标记1号' 不是 '并发标记10号' 的子串（否则逐条核对会串）
  const marker = (i) => '并发标记' + i + '号';
  let allReported = true;
  let invariantOk = true;
  let allPresent = true;
  let totalOk = 0;
  let totalFail = 0;
  let minCnt = Infinity;
  // 诊断用：把**明确失败**（ok:false）的原因收集起来。
  // 为什么必须分开看：D-52 的要害是**静默丢失**（返回 ok 却没落盘）。
  // 如果少的那条是「明确失败」，调用方知道没记上、可以重试 —— 那是「不谎报」，
  // 与「静默丢」不是一回事。不分开就会把两者混成同一个红。
  const failures = [];
  for (let round = 0; round < ROUNDS; round++) {
    const agent = 'sa-concurrent-records-r' + round;
    const file = path.join(PROJ, '.superagent', 'methods', agent + '.md');
    fs.writeFileSync(file, '# ' + agent + '\n\n## 实战记录\n\n', 'utf8');
    const goFile = path.join(tmp, 'go-rec-r' + round + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.flag');
    const pend = [];
    for (let i = 0; i < N; i++) {
      const payload = { session_id: PARENT, agent, task: marker(i), domain: '并发领域',
        approach: '做法' + i, evidence: '证据' + i, verified_by: 'verifier' };
      pend.push(spawnBarrier(runner, goFile, GATE, JSON.stringify(payload)));
    }
    await Promise.all(pend.map((p) => p.ready));    // 全部就位
    fs.writeFileSync(goFile, 'go');                  // 号令一发，同时冲
    const outs = await Promise.all(pend.map((p) => p.done));
    const okSet = new Set();
    const failSet = new Set();
    let ambiguous = 0;
    outs.forEach((o, i) => {
      if (o && o.ok === true) okSet.add(i);
      else if (o && o.ok === false) {
        failSet.add(i);
        failures.push(JSON.stringify(o.errors || o).slice(0, 200));
      } else {
        ambiguous++;
        failures.push('无法判定成败：' + JSON.stringify(o).slice(0, 200));
      }
    });
    totalOk += okSet.size;
    totalFail += failSet.size;
    if (ambiguous > 0 || okSet.size + failSet.size !== N) allReported = false;
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { failures.push('落盘文件不存在：' + agent + '.md'); }
    const cnt = (raw.match(/^###\s/gm) || []).length;
    if (cnt < minCnt) minCnt = cnt;
    const diskSet = new Set();
    for (let i = 0; i < N; i++) if (raw.includes(marker(i))) diskSet.add(i);
    // 不变量：说成功的集合 == 落盘的集合（一个不多、一个不少）
    if (okSet.size !== diskSet.size || Array.from(okSet).some((i) => !diskSet.has(i))) invariantOk = false;
    if (diskSet.size !== N) allPresent = false;
  }
  const diag = 'ok=' + totalOk + ' 最少落盘条数=' + minCnt + ' 明确失败=' + totalFail +
    (failures.length ? ' 首条失败原因=' + failures[0] : '');
  ok('D-52 并发写履历不丢条目（说成功的都真落盘：' + N + ' 并发 × ' + ROUNDS + ' 轮）', invariantOk, diag);
  ok('D-52 并发写履历逐条都在', allPresent, diag);
  // 明确失败也要被看见：写入方返回了 ok:false，说明它知道自己没记上 ——
  // 这是「不谎报」，但它**不是**「写成功」。把失败数报出来，避免「绿」掩盖了它。
  ok('D-52 并发写履历无明确失败（每一次写入都真的落盘）', totalFail === 0, diag);
  ok('D-52 并发写履历全部返回成功或明确失败（不谎报）', allReported, diag);
}

// ── 20. D-56 / D-57：取样名额单一常量 + 名录重名去重 ────────
{
  const recMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'records.mjs')).href);
  const rosterMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'roster.mjs')).href);
  ok('D-56 取样名额是单一常量且与名录上限同源',
    recMod.SUMMARY_MAX_MEMBERS === rosterMod.MAX_ROSTER,
    'SUMMARY_MAX_MEMBERS=' + recMod.SUMMARY_MAX_MEMBERS + ' MAX_ROSTER=' + rosterMod.MAX_ROSTER);
  // CLI 走的默认值必须就是那个常量（否则 CLI 与注入层仍是两个口径）
  const cli = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'records.mjs'), 'summary'], {
    encoding: 'utf8', env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  let cliOut = {};
  try { cliOut = JSON.parse(cli.stdout); } catch {}
  ok('D-56 CLI 默认口径与常量一致（CLI 与注入层同一结论）',
    cliOut.maxMembers === recMod.SUMMARY_MAX_MEMBERS,
    'CLI maxMembers=' + cliOut.maxMembers + ' 常量=' + recMod.SUMMARY_MAX_MEMBERS);
  // 重名成员：同一成员在摘要里只出现一次，且异常被显式报出
  const dupRoster = { version: 1, members: [
    { name: 'sa-dup', kind: 'specialist', source: 'runtime', owns: 'x', accepts: 'a', reject: 'r' },
    { name: 'sa-dup', kind: 'specialist', source: 'runtime', owns: 'x', accepts: 'a', reject: 'r' },
    { name: 'sa-solo', kind: 'specialist', source: 'runtime', owns: 'y', accepts: 'a', reject: 'r' }
  ] };
  fs.writeFileSync(path.join(PROJ, '.superagent', 'roster.json'), JSON.stringify(dupRoster, null, 2), 'utf8');
  const detail = recMod.summarizeRecordsDetailed(3, recMod.SUMMARY_MAX_MEMBERS);
  ok('D-57 摘要里同名成员只出现一次',
    detail.members.filter(m => m.name === 'sa-dup').length <= 1 &&
    detail.totalMembers === detail.members.length + detail.omitted.length,
    JSON.stringify({ total: detail.totalMembers, shown: detail.shownMembers, omitted: detail.omitted }));
  ok('D-57 重名异常被显式报出（不静默去重）',
    Array.isArray(detail.duplicateNames) && detail.duplicateNames.includes('sa-dup'),
    JSON.stringify(detail.duplicateNames));
}

// ── 21. D-59 / D-60：履历侧的同款专属断言 ──────────────────
// 这两条的实现在 lessons.mjs 的 writeFileLocked（错题本与履历共用）——
// 这里再钉两条，证明「修的是共享代码」，不是只修了错题本那一侧。
// 故障注入钩子（SAR_FAULT_INJECT / SAR_FAULT_RUN，默认关闭）见 lessons.mjs 注释。
{
  // D-59：Windows 上 rename 覆盖被占用文件报 EPERM ⇒ 重试 ⇒ 履历写入仍然成功
  {
    const AGENT = 'sa-d59-records';
    makeMember(AGENT);
    const r = gate({ ...GOOD, agent: AGENT, task: 'D59 注入 EPERM' }, { fault: 'rename-eperm' });
    ok('D-59 履历侧 rename 遇 EPERM 会重试（写入不静默少条目）', r.ok === true, errs(r).slice(0, 200));
    const raw = fs.readFileSync(path.join(PROJ, '.superagent', 'methods', AGENT + '.md'), 'utf8');
    ok('D-59 履历侧重试后条目真的落盘', raw.includes('D59 注入 EPERM'), raw.slice(-120));
  }
  // D-60：落盘回读校验失败 ⇒ 回滚 ⇒ 前序履历还在（没被这次失败写入抹掉）
  {
    const AGENT = 'sa-d60-records';
    makeMember(AGENT);
    const p = path.join(PROJ, '.superagent', 'methods', AGENT + '.md');
    const r0 = gate({ ...GOOD, agent: AGENT, task: 'D60 存量履历' });
    ok('D-60 履历侧前置：存量履历写入成功', r0.ok === true, errs(r0).slice(0, 160));
    const before = fs.readFileSync(p, 'utf8');
    // verify-fail = 「另一个写入方用过期快照覆盖了文件」⇒ 校验必然失败
    const r1 = gate({ ...GOOD, agent: AGENT, task: 'D60 新增履历' }, { fault: 'verify-fail' });
    ok('D-60 履历侧回读校验失败时判失败（不谎报成功）', r1.ok === false, JSON.stringify(r1).slice(0, 200));
    const after = fs.readFileSync(p, 'utf8');
    ok('D-60 履历侧校验失败已回滚（前序履历未被这次失败写入抹掉）',
      after === before && after.includes('D60 存量履历') && !after.includes('D60 新增履历'),
      '写入前 ' + before.length + ' 字 / 写入后 ' + after.length + ' 字');
  }
}

console.log(fail === 0 ? '>>> RECORDS ALL PASS' : '>>> RECORDS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
