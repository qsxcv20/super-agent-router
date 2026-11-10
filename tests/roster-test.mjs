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

// ── 夹具自带完整环境（D-39 名录侧）────────────────────────────────
//
// ① PLUGIN_DATA：显式指向临时目录 ⇒ 任何插件侧落盘（痕迹、台账）都不进真实项目，
//    也不碰真实账号的 plugin-data。
// ② SAR_ACCOUNT_AGENTS_DIR：显式指向夹具自带的**账号成员目录** ——
//    账号成员是跨项目的账号级事实，夹具不自带账号环境的话，
//    存在性校验只能判成「无法核验」，测的就不是同一件事了。
//
// 账号成员目录的布局与真实账号一致（lib.mjs 的 accountMemberNames 只认这两种）：
//   <ACCOUNT>/<name>/          专项成员
//   <ACCOUNT>/.builtin/<name>/ 内置成员
const DATA = path.join(tmp, 'plugin-data');
fs.mkdirSync(DATA, { recursive: true });
const ACCOUNT = path.join(tmp, 'account');
for (const n of ['sa-spreadsheet-extract', 'sa-live-member']) {
  fs.mkdirSync(path.join(ACCOUNT, n), { recursive: true });
}
// 内置成员：只在 .builtin/ 下有一份，顶层没有 ——
// 「不得误伤内置成员」这条断言要能证明的就是这个形状。
fs.mkdirSync(path.join(ACCOUNT, '.builtin', 'sa-builtin-probe'), { recursive: true });

// 本进程内的 MINIMAX_PROJECT_DIR / PLUGIN_DATA 也显式指到沙箱：
// 测试文件里有几处**在本进程内 import** roster.mjs / lib.mjs 再调它们的读接口，
// 不设这两个变量的话，那些读接口会去读**真实项目**的 .superagent/ 与真实插件数据目录。
// （派生子进程的那几条 roster() 调用另有 env，此处管的是本进程。）
process.env.MINIMAX_PROJECT_DIR = PROJ;
process.env.PLUGIN_DATA = DATA;

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function roster(args, env = {}) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'roster.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA, SAR_ACCOUNT_AGENTS_DIR: ACCOUNT, ...env }
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

// ── 13. D-39 名录侧：登记必须与建号成对 ───────────────────────────
//
// 判据：register 登记的成员必须**已存在于账号成员名单**
// （<账号成员目录>/<name>/ 或 <账号成员目录>/.builtin/<name>/）。
// 名单由 lib.mjs 的 accountMemberNames() 统一计算 —— 与注入侧、派工侧同一份。
//
// 「哪条规则命中」靠 error_rules 指认（不是靠猜报错文本里有没有某个词）：
// 每条错误带一个规则代号，测试断言的是**代号**，不是字符串包含关系。
{
  const GHOST = { ...MEMBER, name: 'sa-ghost-member' };
  // 方法论文件先写好 ⇒ 这次登记**只**可能栽在账号存在性这一条上。
  // （若方法论也缺，两条规则同时触发，就分不清是哪条拦的。）
  fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', 'sa-ghost-member.md'),
    '# 方法论\n\n## 验收清单\n- [ ] 口径已回显\n', 'utf8');

  // 13-1 账号里不存在的成员 → 被拒
  const r1 = roster(['register', JSON.stringify(GHOST)]);
  ok('D-39 登记账号里不存在的成员被拒', r1.ok === false, JSON.stringify(r1).slice(0, 200));
  ok('D-39 报错写明「在账号里不存在」',
    Array.isArray(r1.errors) && r1.errors.some(e => e.includes('在账号里不存在')),
    JSON.stringify(r1.errors));
  // 指认命中的就是「账号存在性」这一条：只有它触发，其它规则都过了。
  ok('D-39 命中的规则是 account_member_missing（唯一一条）',
    JSON.stringify(r1.error_rules) === JSON.stringify(['account_member_missing']),
    JSON.stringify(r1.error_rules));
  // 被拒的成员不得落进名录（拒绝必须是真的拒绝）
  const after = JSON.parse(fs.readFileSync(path.join(PROJ, '.superagent', 'roster.json'), 'utf8'));
  ok('D-39 被拒的成员没有进名录',
    !after.members.some(m => m.name === 'sa-ghost-member'),
    JSON.stringify(after.members.map(m => m.name)));
}

// 13-2 账号里真实存在的成员 → 通过
{
  const LIVE = { ...MEMBER, name: 'sa-live-member' };
  fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', 'sa-live-member.md'),
    '# 方法论\n\n## 验收清单\n- [ ] 口径已回显\n', 'utf8');
  const r2 = roster(['register', JSON.stringify(LIVE)]);
  ok('D-39 登记账号里真实存在的成员通过', r2.ok === true, JSON.stringify(r2).slice(0, 200));
  const after = JSON.parse(fs.readFileSync(path.join(PROJ, '.superagent', 'roster.json'), 'utf8'));
  ok('D-39 通过的成员落进名录',
    after.members.some(m => m.name === 'sa-live-member'),
    JSON.stringify(after.members.map(m => m.name)));
}

// 13-3 内置成员不被误伤
// 夹具里 sa-builtin-probe **只**存在于 .builtin/ 下（顶层没有）——
// 若实现只看顶层目录（漏了 .builtin/），这条断言就会红。
{
  const BI = { ...MEMBER, name: 'sa-builtin-probe' };
  fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', 'sa-builtin-probe.md'),
    '# 方法论\n\n## 验收清单\n- [ ] 口径已回显\n', 'utf8');
  const r3 = roster(['register', JSON.stringify(BI)]);
  ok('D-39 内置成员（.builtin/ 下）登记通过，不被误伤', r3.ok === true, JSON.stringify(r3).slice(0, 200));
}

// 13-4 名单读不出来 ≠ 成员不存在：两种失败必须分开报
{
  // 用一个没被登记过、且方法论齐备的名字 ⇒ 这次只可能栽在账号名单这一条上。
  fs.writeFileSync(path.join(PROJ, '.superagent', 'methods', 'sa-unreadable-probe.md'),
    '# 方法论\n\n## 验收清单\n- [ ] 口径已回显\n', 'utf8');
  const r4 = roster(['register', JSON.stringify({ ...MEMBER, name: 'sa-unreadable-probe' })],
    { SAR_ACCOUNT_AGENTS_DIR: path.join(tmp, 'no-such-account') });
  ok('D-39 账号名单不可用时拒绝登记（不放行）', r4.ok === false, JSON.stringify(r4).slice(0, 200));
  ok('D-39 名单不可用的规则代号是 account_list_unavailable（不是 account_member_missing）',
    JSON.stringify(r4.error_rules) === JSON.stringify(['account_list_unavailable']),
    JSON.stringify(r4.error_rules));
  ok('D-39 名单不可用时不说「在账号里不存在」（那是另一件事）',
    Array.isArray(r4.errors) && !r4.errors.some(e => e.includes('在账号里不存在')),
    JSON.stringify(r4.errors));
}

// ── 14. reconcile 与机制侧同口径（陈旧判定只有一份实现）─────────────
//
// 机制侧（注入披露 / 派工拒绝）用的是 lib.mjs 的 staleRosterMembers()：
// 判据是「名录里有、账号里没有」，**不看 source**。
// reconcile 以前多带一层 source === 'runtime' 过滤 —— 两边对同一个成员
// 给出不同结论（一边拦派工、一边说没问题）。现在收敛到同一份计算。
{
  // 造一个 source 不是 runtime 的名录成员（手改 roster.json 才会出现这种形状），
  // 它不在账号里 ⇒ 按机制侧口径它就是陈旧的。
  const rosterPath = path.join(PROJ, '.superagent', 'roster.json');
  const cur = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  cur.members = cur.members.concat([
    { name: 'sa-nonruntime-member', kind: 'specialist', source: 'manual', owns: 'a', accepts: 'b', reject: 'c' }
  ]);
  fs.writeFileSync(rosterPath, JSON.stringify(cur, null, 2), 'utf8');

  // 14-1 喂名单：名单里没有它 ⇒ 陈旧（不再按 source 过滤）
  const r1 = roster(['reconcile', JSON.stringify([{ name: 'explore' }, { name: 'worker' }])]);
  ok('D-39 reconcile 判陈旧不再按 source 过滤（与机制侧同口径）',
    Array.isArray(r1.stale) && r1.stale.includes('sa-nonruntime-member'),
    JSON.stringify(r1.stale));
  ok('D-39 reconcile 标明本次用的是喂进来的名单',
    r1.account_view && r1.account_view.source === 'fed-list',
    JSON.stringify(r1.account_view));

  // 14-2 不喂名单 → 走账号成员目录这一份事实（机制侧同源）
  const r2 = roster(['reconcile']);
  ok('D-39 reconcile 不喂名单时用账号成员目录（与机制侧同源）',
    r2.account_view && r2.account_view.source === 'explicit' && r2.account_view.available === true,
    JSON.stringify(r2.account_view));
  ok('D-39 reconcile 用账号目录时同样不按 source 过滤',
    Array.isArray(r2.stale) && r2.stale.includes('sa-nonruntime-member'),
    JSON.stringify(r2.stale));

  // 14-3 与共享计算逐字相同（同一份实现，不是「看起来一样」）
  const libMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs')).href);
  const rosterMod = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'roster.mjs')).href);
  const shared = libMod.staleRosterMembers(
    rosterMod.readRoster(),
    { available: true, names: ['explore', 'worker'] }
  );
  ok('D-39 reconcile 的陈旧集合与 lib.mjs 共享计算逐字相同',
    JSON.stringify(r1.stale) === JSON.stringify(shared),
    JSON.stringify(r1.stale) + ' vs ' + JSON.stringify(shared));
}

// ── 15. 变异矩阵（可选，用开关打开）──────────────────────────────
//
// 用法：$env:SAR_MUTATION='1'; node tests/roster-test.mjs
// 目的：证明「D-39 账号存在性校验」这条断言**有区分力** ——
// 把实现改回去，目标断言必须转红（否则这条断言只是恒真，等于没测）。
//
// 只改系统临时目录里的插件副本，仓库工作树零改动；跑完即删。
if (process.env.SAR_MUTATION === '1') {
  const { fileURLToPath } = await import('node:url');
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-roster-mut-'));
  const mutPlugin = path.join(mutDir, 'plugin');
  fs.cpSync(path.join(REPO, 'plugin'), mutPlugin, { recursive: true });

  const mutFile = path.join(mutPlugin, 'scripts', 'roster.mjs');
  const mutLib = path.join(mutPlugin, 'scripts', 'lib.mjs');

  // 跑一遍被变异后的套件，返回它变红的断言行。
  const runMutant = () => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tests', 'roster-test.mjs')], {
      encoding: 'utf8', timeout: 300000, cwd: REPO,
      // 必须清掉 SAR_MUTATION：被重跑的套件里若再次打开本工装，就会**递归**跑自己。
      env: { ...process.env, SAR_PLUGIN_ROOT: mutPlugin, SAR_MUTATION: '' }
    });
    const out = (r.stdout || '') + '\n' + (r.stderr || '');
    return {
      red: out.split(/\r?\n/).filter(l => l.startsWith('FAIL ')),
      out
    };
  };

  // ── 变异体 1：把「登记前核对该成员已存在于账号」这条调用摘掉 ──────
  // 即 D-39 改之前的样子（只查方法论文件与字段齐备，不查账号）。
  // 目标断言：「登记账号里不存在的成员被拒」必须转红。
  {
    const src = fs.readFileSync(mutFile, 'utf8');
    const ANCHOR = '    accountCheck = checkAccountMember(name);';
    const idx = src.indexOf(ANCHOR);
    if (idx < 0) { console.log('FAIL 变异点未命中 :: roster.mjs 的账号存在性调用'); fail++; }
    else {
      fs.writeFileSync(mutFile, src.slice(0, idx) +
        '    accountCheck = { ok: true, code: \'account_member_present\', error: \'\' };' +
        src.slice(idx + ANCHOR.length), 'utf8');
      const { red, out } = runMutant();
      ok('D-39 变异体 M1（回退账号存在性校验）→「登记账号里不存在的成员被拒」转红',
        red.some(l => l.includes('D-39 登记账号里不存在的成员被拒')),
        red.slice(0, 3).join(' | ') || out.slice(-200));
      ok('D-39 变异体 M1 →「命中的规则是 account_member_missing」也转红',
        red.some(l => l.includes('D-39 命中的规则是 account_member_missing')),
        red.slice(0, 3).join(' | '));
      ok('D-39 变异体 M1 →「被拒的成员没有进名录」也转红（拒绝必须是真的拒绝）',
        red.some(l => l.includes('D-39 被拒的成员没有进名录')),
        red.slice(0, 4).join(' | '));
    }
    // 还原，供下一个变异体用。
    fs.writeFileSync(mutFile, fs.readFileSync(path.join(REPO, 'plugin', 'scripts', 'roster.mjs'), 'utf8'), 'utf8');
  }

  // ── 变异体 2：账号名单不再计入 .builtin/ 下的内置成员 ─────────────
  // 这是「误伤内置成员」这条断言的专属变异点：
  // M1 把校验整个摘掉时，内置成员照样放行 —— 它证不了这条断言有区分力；
  // 只有「校验还在、但名单漏了 .builtin/」才会让内置成员被误伤。
  // 目标断言：「内置成员（.builtin/ 下）登记通过，不被误伤」必须转红。
  {
    const src = fs.readFileSync(mutLib, 'utf8');
    const ANCHOR = "      if (en && en.isDirectory() && en.name) names.add(String(en.name));";
    const idx = src.indexOf(ANCHOR);
    if (idx < 0) { console.log('FAIL 变异点未命中 :: lib.mjs 的 .builtin 合并'); fail++; }
    else {
      fs.writeFileSync(mutLib, src.slice(0, idx) +
        '      if (false && en && en.isDirectory() && en.name) names.add(String(en.name));' +
        src.slice(idx + ANCHOR.length), 'utf8');
      const { red, out } = runMutant();
      ok('D-39 变异体 M2（账号名单漏计 .builtin/ 内置成员）→「内置成员不被误伤」转红',
        red.some(l => l.includes('D-39 内置成员（.builtin/ 下）登记通过')),
        red.slice(0, 4).join(' | ') || out.slice(-200));
      // 变异体只该打红「内置成员」那一条，不该把别的也带红（打红一片 = 变异点打偏了）。
      ok('D-39 变异体 M2 只打红内置成员那一条（其余断言仍绿）',
        !red.some(l => l.includes('D-39 登记账号里真实存在的成员通过')),
        red.slice(0, 4).join(' | '));
    }
  }
  fs.rmSync(mutDir, { recursive: true, force: true });
}

console.log(fail === 0 ? '>>> ROSTER ALL PASS' : '>>> ROSTER FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
