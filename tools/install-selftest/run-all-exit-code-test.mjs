// super-agent-router 安装 / 卸载脚本自测 —— 自检红 ⇒ 退出码与横幅不许说谎（X1 的钉子）
//
// 断言条数（18 条断言）—— 机器标记：ASSERTION-COUNT: 18
//
// 为什么需要这条：X1 —— run-all.ps1 里「套件退出码非 0 的个数」与「断言红计数」
//   在修之前**共用一个变量名**（`$failed` 与 `$script:failed` 在脚本作用域是同一个变量），
//   于是 `$failed = 0` 那一行把自检自己的红计数清零了 ⇒
//   **断言打印 FAIL、退出码却是 0、横幅还说「全部通过」** —— 验收壳自己报红却让退出码说通过。
//
// 本套件是**行为级**的钉子（不是静态比对源码文字）：
//   1) 夹具 = 真 run-all.ps1 的**逐字节副本** + 一组桩套件（每个桩只打 1 条 PASS、退出 0）；
//      三个变体各放**各自的目录** —— 因为 run-all.ps1 读自己的头部走的是
//      `Join-Path $here 'run-all.ps1'`（固定文件名），放在同一个目录会读到别人的头部。
//   2) 阳性对照（金丝雀）：**没篡改**的副本 ⇒ 退出码 0 且横幅含「全部通过」
//      —— 否则「副本根本跑不起来」也会被误当成「红传不到退出码」。
//   3) 触发红：把副本的**头部声明与机器标记一起**改成「真实条数 + 1」
//      （这正是验收方的触发方式）⇒ 必须退出码非 0、横幅**不含**「全部通过」、
//      且输出里**真的有 FAIL 行**（证明红是真的，不是「因为别的原因退出 1」）。
//   4) 变异对照（证伪）：把**撞名改回去**的副本用同样的触发方式跑
//      ⇒ 期望它**变绿**（退出 0 + 横幅说「全部通过」）——
//      这条是本套件的牙齿：撞名改回来时第 3 组就会失败（套件真能区分「修好」与「撞名改回来」）。
//
// 仅 Windows（依赖 powershell + PS 5.1）。
//
// 用法：node tools/install-selftest/run-all-exit-code-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SELFTEST_DIR = path.join(ROOT, 'tools', 'install-selftest');
const REAL_RUN_ALL = path.join(SELFTEST_DIR, 'run-all.ps1');

// V4 要求「一个套件文件里有且只有一个机器标记」——
//   桩文件里的标记是**运行时生成**的，不算本文件的标记 ⇒ 这里用拼接，源码里只留头部那一个字面量。
const MARK = 'ASSERTION' + '-COUNT:';

let pass = 0, fail = 0;
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\r\n|\r|\n/g, ' | ');
}
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '   :: ' + oneLine(detail)); }
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const SANDBOX = path.join(os.tmpdir(), 'sar-exitcheck-' + stamp);
fs.mkdirSync(SANDBOX, { recursive: true });

console.log('[平台] Windows only（依赖 powershell + PS 5.1）');
console.log('[套件] 自检红 ⇒ 退出码与横幅不许说谎（X1）');
console.log('[沙箱] ' + SANDBOX);

const realSrc = fs.readFileSync(REAL_RUN_ALL, 'utf8');
const suiteNames = [...realSrc.matchAll(/@\{ name = '([^']+)';/g)].map(m => m[1]);
const declaredMatch = realSrc.match(/ASSERTION-COUNT:\s*(\d+)/);
const declared = declaredMatch ? Number(declaredMatch[1]) : -1;
const structural = suiteNames.length + 2;
console.log('[套件数] ' + suiteNames.length + '  [头部声明] ' + declared + '  [结构性期望] ' + structural);

// ── 桩套件：只打 1 条 PASS、退出 0、机器标记 1 ────────────────────
function stubContent(name) {
  if (name.endsWith('.ps1')) {
    return '\uFEFF' + [
      '# stub suite for the X1 meta-test - one PASS line, exit 0',
      '# ' + MARK + ' 1',
      "Write-Host 'PASS  stub-" + name + "'",
      'exit 0',
      ''
    ].join('\n');
  }
  return [
    '// stub suite for the X1 meta-test - one PASS line, exit 0',
    '// ' + MARK + ' 1',
    "console.log('PASS  stub-" + name + "');",
    'process.exit(0);',
    ''
  ].join('\n');
}

// ── 头部数字：改 / 归一 ──────────────────────────────────────────
function patchHead(src, n) {
  return src
    .replace(/（\d+ 条断言）/g, '（' + n + ' 条断言）')
    .replace(/ASSERTION-COUNT:\s*\d+/g, 'ASSERTION-COUNT: ' + n);
}
function normalizeHead(src) {
  return src
    .replace(/（\d+ 条断言）/g, '（N 条断言）')
    .replace(/ASSERTION-COUNT:\s*\d+/g, 'ASSERTION-COUNT: N');
}
// 把撞名改回去（新名 -> 旧名）—— 用来证明「这条断言真有牙齿」
function reintroduceCollision(src) {
  return src
    .replace(/\$script:assertPass/g, '$script:pass')
    .replace(/\$script:assertFail/g, '$script:failed')
    .replace(/\$suiteFailed/g, '$failed');
}

// ── 每个变体各建各的目录（run-all.ps1 读自己的头部走固定文件名）──
function makeVariant(dirName, src) {
  const dir = path.join(SANDBOX, dirName);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of suiteNames) {
    fs.writeFileSync(path.join(dir, name), stubContent(name), 'utf8');
  }
  const p = path.join(dir, 'run-all.ps1');
  fs.writeFileSync(p, src, 'utf8');
  return p;
}

function runVariant(p) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', p], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split(/\r?\n/);
  return {
    code: r.status,
    out,
    banner: lines.filter(l => l.includes('==== 自测：'))[0] || '',
    failLines: lines.filter(l => l.startsWith('FAIL  ')),
  };
}

const baselineSrc = patchHead(realSrc, structural);
const tamperedSrc = patchHead(realSrc, structural + 1);
const mutantSrc = reintroduceCollision(tamperedSrc);

const baseRun = runVariant(makeVariant('base', baselineSrc));
const tamperedRun = runVariant(makeVariant('tampered', tamperedSrc));
const mutantRun = runVariant(makeVariant('mutant', mutantSrc));

// 变体证据只打**布尔量** —— 这几行是「变体」的横幅，不是链自己的横幅。
// 若在这里原样打印横幅字样，评审 grep 整个输出时会把变体的横幅误当成链自己的横幅。
function bannerFlags(b) {
  return 'bannerHasAllPass=' + b.includes('全部通过') + '  bannerHasNotPass=' + b.includes('未通过');
}
console.log('[变体] 基线    exit=' + baseRun.code + '  ' + bannerFlags(baseRun.banner));
console.log('[变体] 触发红  exit=' + tamperedRun.code + '  ' + bannerFlags(tamperedRun.banner));
console.log('[变体] 触发红的 FAIL 行: ' + JSON.stringify(tamperedRun.failLines));
console.log('[变体] 撞名变体 exit=' + mutantRun.code + '  ' + bannerFlags(mutantRun.banner));
console.log('[变体] 撞名变体的 FAIL 行: ' + JSON.stringify(mutantRun.failLines));

// ── 夹具有效性（构造有效性必须有阳性证据）────────────────────────
check('夹具就绪：基线副本与真实 run-all.ps1 的差异只在头部两处数字',
  normalizeHead(baselineSrc) === normalizeHead(realSrc), 'normalized differ');
check('夹具就绪：真实条数声明 == 结构性期望（子套件 ' + suiteNames.length + ' + 2 = ' + structural + '）',
  declared === structural, 'declared=' + declared + ' structural=' + structural);
check('夹具就绪：每个套件条目都有对应的桩文件（一个不缺）',
  suiteNames.length > 0 && suiteNames.every(n => fs.existsSync(path.join(SANDBOX, 'base', n))),
  'suites=' + suiteNames.join(','));
check('夹具就绪：每个桩只打 1 条 PASS、不打 FAIL',
  suiteNames.every(n => {
    const s = fs.readFileSync(path.join(SANDBOX, 'base', n), 'utf8');
    return (s.match(/PASS  /g) || []).length === 1 && (s.match(/FAIL  /g) || []).length === 0;
  }), 'stub body');
check('夹具就绪：桩的机器标记都写着 1 条（条数对账不会自己先红）',
  suiteNames.every(n => new RegExp(MARK + '\\s*1').test(fs.readFileSync(path.join(SANDBOX, 'base', n), 'utf8'))),
  'stub marks');

// ── 触发组：头部声明 + 机器标记一起改（验收方的触发方式）─────────
check('触发组改的正是「头部声明 + 机器标记」两处，且都改成了新数字 ' + (structural + 1),
  normalizeHead(tamperedSrc) === normalizeHead(baselineSrc) &&
  tamperedSrc.includes('（' + (structural + 1) + ' 条断言）') &&
  tamperedSrc.includes(MARK + ' ' + (structural + 1)),
  'tamper shape');
check('触发红：退出码非 0', tamperedRun.code !== 0, 'code=' + tamperedRun.code);
check('触发红：退出码恰好 1', tamperedRun.code === 1, 'code=' + tamperedRun.code);
check('触发红：横幅不含「全部通过」', !tamperedRun.banner.includes('全部通过'), 'banner=' + tamperedRun.banner);
check('触发红：横幅含「未通过」', tamperedRun.banner.includes('未通过'), 'banner=' + tamperedRun.banner);
check('触发红：横幅写明了断言红的条数（>= 1）', /断言红\s*[1-9]\d*\s*条/.test(tamperedRun.banner), 'banner=' + tamperedRun.banner);
check('触发红：输出里真的有 FAIL 行（红是真的，不是「因为别的原因退出 1」）',
  tamperedRun.failLines.length >= 1, 'failLines=' + tamperedRun.failLines.length);

// ── 阳性对照（金丝雀）：没篡改的副本必须是绿的 ──────────────────
check('阳性对照：未篡改的副本退出码 0', baseRun.code === 0, 'code=' + baseRun.code + ' tail=' + baseRun.out.slice(-300));
check('阳性对照：未篡改的副本横幅含「全部通过」', baseRun.banner.includes('全部通过'), 'banner=' + baseRun.banner);

// ── 变异对照（证伪）：撞名改回去 ⇒ 撞名把红吃掉 ─────────────────
check('变异对照：撞名改回去的副本确实含「$failed = 0」（变异生效了）',
  mutantSrc.includes('$failed = 0'), 'mutation shape');
check('变异对照：撞名改回去 + 同样触发 ⇒ 退出码 0（撞名把红吃掉了）',
  mutantRun.code === 0, 'code=' + mutantRun.code);
check('变异对照：撞名改回去 + 同样触发 ⇒ 横幅含「全部通过」（横幅说谎）',
  mutantRun.banner.includes('全部通过'), 'banner=' + mutantRun.banner);
check('变异对照：撞名改回去 + 同样触发 ⇒ 输出里**有** FAIL 行（红是真的，只是被吃了）',
  mutantRun.failLines.length >= 1, 'failLines=' + mutantRun.failLines.length);

console.log('');
console.log('==== 自检红 ⇒ 退出码与横幅：PASS ' + pass + ' / FAIL ' + fail + ' ====');

try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) { console.log('[清理] 沙箱删除失败: ' + e.message); }
process.exit(fail > 0 ? 1 : 0);
