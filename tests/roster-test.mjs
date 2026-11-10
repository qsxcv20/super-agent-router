// 专项名录（roster）回归测试
// 用法：node tests/roster-test.mjs
//   默认跑安装副本；跑仓库副本请显式指定：
//   $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\roster-test.mjs
//
// 验证这些事：
//   1. 未写方法论文件 → 拒绝登记
//   2. 有方法论文件 → 登记成功、落盘、changes.log 留痕
//   3. 重复登记 / 泛词命名 / 撞内置名 / 缺 owns → 各自被拒
//   4. reconcile：adopt / reuse / stale 三种关系都识别得出
//   5. list：名录一览可查（名字升序 + 战绩/教训条数）
//   6. roster.mjs 可当库 import（import 不执行 CLI，否则会把 import 它的进程 exit 掉）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
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

// 4. 重复登记同名 → 应拒绝
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

// 10. list：名录一览可查 —— 名字升序（规范顺序）+ 每人的战绩/教训条数
{
  const r = roster(['list']);
  ok('list 命令可用', Array.isArray(r.members), JSON.stringify(r).slice(0, 160));
  const names = (r.members || []).map(m => m.name);
  const sorted = [...names].sort();
  ok('名录按名字升序（规范顺序）', JSON.stringify(names) === JSON.stringify(sorted), names.join(','));
  ok('list 给出战绩条数与教训条数',
    (r.members || []).every(m => typeof m.records === 'number' && typeof m.lessons === 'number'),
    JSON.stringify((r.members || [])[0]));
}

// 11. roster.mjs 可当库 import：import 不执行 CLI
// （records.mjs 要用它；CLI 若在 import 时跑，会把 import 它的进程 exit 掉）
{
  const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'roster.mjs')).href);
  ok('roster.mjs 可当库 import（isMain 守卫生效）',
    typeof mod.readRoster === 'function' && typeof mod.listMembers === 'function' && typeof mod.rosterPath === 'function',
    '');
  ok('名录上限常量已导出', mod.MAX_ROSTER === 12, String(mod.MAX_ROSTER));
  const members = mod.listMembers({ members: [{ name: 'sa-b' }, { name: 'sa-a' }] });
  ok('listMembers 返回名字升序', members.map(m => m.name).join(',') === 'sa-a,sa-b', members.map(m => m.name).join(','));
}

// ── 12. D-57：名录重名不去重 ────────────────────────────────
// roster.json 里出现同名成员（手改文件绕过 register 的重名拒绝）时，
// 同一成员在摘要里出现两次：既重复计数，又白占一个名额，被挤掉的其他人少一个可见位置。
// 口径：同名取一条（并把重名显式报出来，不静默去重）。
{
  const dup = { members: [
    { name: 'sa-dup', kind: 'specialist', source: 'runtime', owns: 'a', accepts: 'x', reject: 'y' },
    { name: 'sa-dup', kind: 'specialist', source: 'runtime', owns: 'b', accepts: 'x', reject: 'y' },
    { name: 'sa-solo', kind: 'specialist', source: 'runtime', owns: 'c', accepts: 'x', reject: 'y' }
  ] };
  const mod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'roster.mjs')).href);
  const deduped = mod.listMembers(dup);
  ok('D-57 同名成员只保留一条',
    deduped.length === 2 && deduped.filter(m => m.name === 'sa-dup').length === 1,
    JSON.stringify(deduped.map(m => m.name)));
  ok('D-57 重名被显式报出（可查，不静默去重）',
    JSON.stringify(mod.duplicateNames(dup)) === JSON.stringify(['sa-dup']),
    JSON.stringify(mod.duplicateNames(dup)));
  ok('D-57 去重后仍按名字升序',
    deduped.map(m => m.name).join(',') === 'sa-dup,sa-solo',
    deduped.map(m => m.name).join(','));
}
{
  // 落盘的真实名录也要能报出重名（不是只在内存对象里判）
  fs.writeFileSync(path.join(PROJ, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-11-10',
    members: [
      { name: 'sa-dup', kind: 'specialist', source: 'runtime', owns: 'a', accepts: 'x', reject: 'y' },
      { name: 'sa-dup', kind: 'specialist', source: 'runtime', owns: 'b', accepts: 'x', reject: 'y' }
    ]
  }, null, 2), 'utf8');
  const r = roster(['list']);
  ok('D-57 list 命令报出重名成员',
    Array.isArray(r.duplicateNames) && r.duplicateNames.includes('sa-dup'),
    JSON.stringify(r.duplicateNames));
  ok('D-57 list 里同名成员只出现一次',
    (r.members || []).filter(m => m.name === 'sa-dup').length === 1,
    JSON.stringify((r.members || []).map(m => m.name)));
}

console.log(fail === 0 ? '>>> ROSTER ALL PASS' : '>>> ROSTER FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
