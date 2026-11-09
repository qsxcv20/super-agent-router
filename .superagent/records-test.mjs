// 履历（实战记录）闭环回归测试
// 用法：node .superagent/records-test.mjs
//
// 验证这些事：
//   1. 验收通过的成果能写进方法论文件
//   2. 执行者不可自证
//   3. 缺证据 / 缺做法 / 缺领域 被拒
//   4. 方法论文件不存在被拒
//   5. 上限 20 条，只增不减的履历要被拦
//   6. 匹配阶段注入参考，但不改 owns
//
// 每个用例用独立成员，避免用例之间互相污染记录池。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-rec-'));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, '.superagent', 'methods'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.superagent', 'lessons'), { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function gate(payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'record-gate.mjs'), JSON.stringify(payload)], {
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ }
  });
  try { return JSON.parse(r.stdout); } catch { return { raw: r.stdout, err: r.stderr }; }
}

function makeMember(name) {
  const p = path.join(PROJ, '.superagent', 'methods', name + '.md');
  fs.writeFileSync(p, '# ' + name + '\n\n## 归属\n做一件事\n\n## 方法\n1. 取数\n2. 产出\n\n## 验收清单\n- [ ] 口径已回显\n', 'utf8');
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
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: path.join(tmp, 'data') }
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

console.log(fail === 0 ? '>>> RECORDS ALL PASS' : '>>> RECORDS FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
