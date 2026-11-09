import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = 'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-roster-'));
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(PROJ, '.superagent', 'methods'), { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function roster(args, env = {}) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'roster.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, ...env }
  });
  let out;
  try { out = JSON.parse(r.stdout); } catch { out = { raw: r.stdout, err: r.stderr }; }
  return out;
}

const MEMBER = {
  name: 'sa-spreadsheet-extract',
  owns: '从表格抠出结构化数据并回显口径',
  accepts: '任务涉及表格取数、口径确认',
  reject: '不做统计推断、不做业务结论',
  created_for: '把销售明细做成月度对比图'
};

// 1. 未写方法论文件 → 应拒绝
{
  const r = roster(['register', JSON.stringify(MEMBER)]);
  ok('缺方法论文件被拒', r.ok === false && String(r.errors).includes('方法论'), JSON.stringify(r.errors));
}

// 2. 补上方法论文件 → 应成功
fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', 'sa-spreadsheet-extract.md'), '# 方法论\n\n## 验收清单\n- [ ] 口径已回显\n', 'utf8');
{
  const r = roster(['register', JSON.stringify(MEMBER)]);
  ok('有方法论则登记成功', r.ok === true, JSON.stringify(r).slice(0, 160));
}

// 3. roster 文件已写入
{
  const p = path.join(PROJ, '.superagent', 'roster.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const m = j.members.find(x => x.name === 'sa-spreadsheet-extract');
  ok('roster 落盘', !!m && m.source === 'runtime', JSON.stringify(m));
  ok('changes.log 留痕', fs.readFileSync(path.join(PROJ, '.superagent', 'changes.log'), 'utf8').includes('sa-spreadsheet-extract'));
}

// 4. 重复登记同�� → 应拒绝
{
  const r = roster(['register', JSON.stringify(MEMBER)]);
  ok('重复登记被拒', r.ok === false && String(r.errors).includes('已存在'), JSON.stringify(r.errors));
}

// 5. 命名不合规 → 应拒绝
{
  const r = roster(['register', JSON.stringify({ ...MEMBER, name: 'sa-data-analyst' })]);
  ok('泛词命名被拒(命中泛词规则)', r.ok === false && r.errors.some(e => e.includes('泛词')), JSON.stringify(r.errors));
}

// 6. 撞内置名 → 应拒绝
{
  const r = roster(['register', JSON.stringify({ ...MEMBER, name: 'worker' })]);
  ok('撞内置名被拒(命中冲突规则)', r.ok === false && r.errors.some(e => e.includes('冲突')), JSON.stringify(r.errors));
}

// 7. 缺 owns → 应拒绝
{
  const r = roster(['register', JSON.stringify({ ...MEMBER, name: 'sa-x-y', owns: '' })]);
  ok('缺 owns 被拒(命中缺字段规则)', r.ok === false && r.errors.some(e => e.includes('owns')), JSON.stringify(r.errors));
}

// 8. reconcile：list 有 roster 无 → adopt；两边都有 → reuse；roster 有 list 无 → stale
{
  const r = roster(['reconcile', JSON.stringify([
    { name: 'explore' }, { name: 'worker' }, { name: 'verifier' },
    { name: 'sa-spreadsheet-extract' },   // 两边都有 → reuse
    { name: 'sa-other-thing' }            // list 有 roster 无 → adopt
  ])]);
  ok('reconcile 识别待收编成员', Array.isArray(r.adopt) && r.adopt.includes('sa-other-thing'), JSON.stringify(r));
  ok('reconcile 识别已登记成员为 reuse', Array.isArray(r.reuse) && r.reuse.includes('sa-spreadsheet-extract'), JSON.stringify(r));
  ok('reconcile 此时无 stale', Array.isArray(r.stale) && r.stale.length === 0, JSON.stringify(r));
}

// 9. reconcile：roster 有 list 无 → stale
{
  const r = roster(['reconcile', JSON.stringify([{ name: 'explore' }, { name: 'worker' }, { name: 'verifier' }])]);
  ok('reconcile 识别陈旧成员', Array.isArray(r.stale) && r.stale.includes('sa-spreadsheet-extract'), JSON.stringify(r));
}

console.log(fail === 0 ? '>>> ROSTER ALL PASS' : '>>> ROSTER FAILURES: ' + fail);
process.exit(fail ? 1 : 0);