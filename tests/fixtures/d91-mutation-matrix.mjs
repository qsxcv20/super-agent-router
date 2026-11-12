// D-91 收尾轮 · 语义变异体矩阵执行器
//
// 定义来源：tests/fixtures/d91-mutation-matrix.md（锚点原文 / 改成什么 / 期望红哪条）
// 本文件是那份定义的**可执行副本** —— 两者必须逐字一致，改一处要同步改另一处。
//
// 纪律：
//   ① 变异跑在**字节级副本**上（fs.copyFileSync），禁 PowerShell 重定向。
//   ② 每个副本先独立 node --check：exit!=0 是模块加载错误，**不算**断言红。
//   ③ 基线必须全绿。
//   ④ **串行执行，不并发** —— 并发引入调度抢占，会污染「恰好红一条」的判定
//      （与 D-93 性能断言噪声同源）。
//
// 判定三列口径（必须分开报，不许合成一个数字）：
//   专属锚点红 / EXTRA-RED 条数 / 总红数。
// 判定：专属红且总红=1 ⇒ 恰好红一条；专属红且总红>1 ⇒ EXTRA-RED(N)；专属不红 ⇒ MISS。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = process.argv[2] || process.cwd();
const BASE = path.join(os.tmpdir(), 'sar-d91-r5-mut-matrix');
fs.rmSync(BASE, { recursive: true, force: true });

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);   // 字节级复制
  }
}
function stage(id) {
  const d = path.join(BASE, id);
  copyDir(path.join(REPO, 'plugin'), path.join(d, 'plugin'));
  fs.mkdirSync(path.join(d, 'tests', 'fixtures'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tests', 'loop-gate-test.mjs'), path.join(d, 'tests', 'loop-gate-test.mjs'));
  for (const f of fs.readdirSync(path.join(REPO, 'tests', 'fixtures'))) {
    fs.copyFileSync(path.join(REPO, 'tests', 'fixtures', f), path.join(d, 'tests', 'fixtures', f));
  }
  return d;
}
function runSuite(d) {
  const r = spawnSync(process.execPath, [path.join(d, 'tests', 'loop-gate-test.mjs')],
    { encoding: 'utf8', timeout: 300000, cwd: REPO,
      env: Object.assign({}, process.env, { SAR_PLUGIN_ROOT: path.join(d, 'plugin') }) });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const lines = out.split(/\r?\n/);
  return {
    code: r.status,
    fails: lines.filter((l) => l.startsWith('FAIL ')),
    passes: lines.filter((l) => l.startsWith('PASS ')).length,
    crashed: /TypeError|ReferenceError|SyntaxError/.test(out) && !lines.some((l) => l.startsWith('FAIL ')),
    out
  };
}

// ── 变异体定义（与 tests/fixtures/d91-mutation-matrix.md 逐字一致）────────────
const MUTS = [
  { id: 'M1', own: 'D-91 收尾 PTC·择一层',
    desc: 'pickNamespace() 恒返回 outer（择一失效）',
    from: "  if (innerHas && !outerHas) return 'inner';\n  if (outerHas && !innerHas) return 'outer';\n  if (innerHas && outerHas) return 'inner';",
    to: "  if (innerHas && !outerHas) return 'outer';\n  if (outerHas && !innerHas) return 'outer';\n  if (innerHas && outerHas) return 'outer';" },
  { id: 'M2', own: 'D-91 收尾 不可比①',
    desc: '不可比分支不生效（不可比记录照常计入）',
    from: "if (ns === 'inner' && !innerComparable(c, pay)) {",
    to: "if (false) {" },
  { id: 'M4', own: 'D-91 收尾 不可比③b',
    desc: '哨兵改用正常指纹（不可比记录照常计入）',
    from: "  return '\\u0000incomparable:' + name;",
    to: "  return fingerprint(name, (rec && rec.args) || {});" },
  { id: 'M6', own: 'D-91 收尾 PTC·取内层层',
    desc: 'innerCallsOf() 读 m.ptc（取错层级）',
    from: "  const det = m.details;\n  if (!det || typeof det !== 'object') return out;\n  const ptc = det.ptc;",
    to: "  const det = m;\n  if (!det || typeof det !== 'object') return out;\n  const ptc = det.ptc;" },
  { id: 'M7', own: 'D-91 收尾 PTC·可比性层',
    desc: 'innerComparable() 恒 false（可比性判定失效）',
    from: "  for (const k of keySet) {\n    if (!(k in recArgs)) return false;\n    if (!(k in payArgs)) return false;\n  }\n  return true;",
    to: "  return false;" },
  { id: 'M8', own: 'D-91 收尾 不可比③a',
    desc: '不可比记录直接丢弃（不打断连续段）',
    from: "      calls.push({ fp: incomparableFp(c) });\n      continue;",
    to: "      continue;" }
];

// ── 基线：未变异 ⇒ 必须全绿 ─────────────────────────────────────────────────
{
  const d = stage('base');
  const r = runSuite(d);
  console.log('BASE pass=' + r.passes + ' fail=' + r.fails.length + ' exit=' + r.code + (r.crashed ? '  !! 崩溃' : ''));
  r.fails.forEach((f) => console.log('   RED ' + f.slice(0, 190)));
  if (r.fails.length || r.crashed) {
    console.log('MUT-CHECK 中止：基线不绿，矩阵结论无意义');
    process.exit(1);
  }
}

console.log('--- 6 个语义变异体逐个自检（字节级副本；每个副本独立 node --check；串行）---');
let miss = 0, extraTotal = 0;
for (const m of MUTS) {
  const d = stage(m.id);
  const target = path.join(d, 'plugin', 'scripts', 'loop-gate.mjs');
  const src = fs.readFileSync(target, 'utf8');
  if (src.indexOf(m.from) === -1) { console.log(m.id + ' !! 锚点未命中（不算数）'); miss++; continue; }
  if (src.indexOf(m.from) !== src.lastIndexOf(m.from)) {
    console.log(m.id + ' !! 锚点不唯一（命中 ' + (src.split(m.from).length - 1) + ' 次，不算数）'); miss++; continue;
  }
  const mutated = src.replace(m.from, m.to);
  fs.writeFileSync(target, mutated, 'utf8');
  const chk = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
  if (chk.status !== 0) {
    console.log(m.id + ' !! node --check exit=' + chk.status + ' ⇒ 模块加载错误，不算断言红');
    console.log('   ERR ' + String(chk.stderr || '').slice(0, 200));
    miss++; continue;
  }
  const r = runSuite(d);
  const ownHit = r.fails.some((f) => f.includes(m.own));
  const extra = r.fails.filter((f) => !f.includes(m.own));
  const total = r.fails.length;
  extraTotal += extra.length;
  const verdict = !ownHit ? 'MISS' : (total === 1 ? '恰好红一条' : 'EXTRA-RED(' + extra.length + ')');
  if (!ownHit) miss++;
  console.log(m.id + ' ' + m.desc);
  console.log('   node --check exit=' + chk.status +
    '  套件 pass=' + r.passes + ' fail=' + total + ' exit=' + r.code + (r.crashed ? ' !! 加载错误' : ''));
  console.log('   专属锚点红=' + (ownHit ? '是' : '否') + '  EXTRA-RED=' + extra.length + '  总红数=' + total +
    '  判定=' + verdict);
  r.fails.forEach((f) => console.log('   RED ' + f.slice(0, 190)));
}
console.log('MUT-CHECK 结束：MISS=' + miss + '  EXTRA-RED 合计=' + extraTotal);
process.exit(miss === 0 ? 0 : 1);
