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
//
// 每个用例用独立成员，避免用例之间互相污染记录池。
import { spawnSync } from 'node:child_process';
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

// ── 派工台账（D-13 的凭据来源） ─────────────────────────────
// 契约 S7.1：verified_by 必须在台账里有一条 agent==它 且 state=='done' 的记录。
// 这里造一条已回收的验收派工当凭据；其余用例据此判定真伪。
function ledgerFile() { return path.join(DATA, 'dispatches.json'); }
function setLedger(dispatches) {
  fs.writeFileSync(ledgerFile(), JSON.stringify({ dispatches, bindings: [] }, null, 2), 'utf8');
}
function addDispatch(d) {
  let l = { dispatches: [], bindings: [] };
  try { l = JSON.parse(fs.readFileSync(ledgerFile(), 'utf8')); } catch {}
  if (!Array.isArray(l.dispatches)) l.dispatches = [];
  l.dispatches.push(d);
  setLedger(l.dispatches);
}
setLedger([
  { dispatch_id: 'dsp_v1', parent_session_id: 's1', turn_id: 't1', agent: 'verifier', scope: [], state: 'done', at: Date.now() }
]);

function gate(payload, opts = {}) {
  const env = { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA };
  if (opts.noLedger) delete env.PLUGIN_DATA;
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'record-gate.mjs'), JSON.stringify(payload)], {
    encoding: 'utf8',
    env
  });
  try { return JSON.parse(r.stdout); } catch { return { raw: r.stdout, err: r.stderr }; }
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

console.log(fail === 0 ? '>>> RECORDS ALL PASS' : '>>> RECORDS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
