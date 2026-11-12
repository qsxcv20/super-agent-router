// D-97 语义变异体矩阵执行器（承 D-91 的 d91-mutation-matrix.mjs 口径）。
// 用法: node tests/fixtures/d97-mutation-matrix.mjs <repoDir>
//
// 纪律：
//   1) 变异必须跑在**字节级副本**上（fs.cpSync），禁止文本方式写回。
//   2) 每个副本先独立跑 node --check：exit!=0 只记「变异体无效」，不算断言红。
//   3) 基线（未变异）必须全绿，否则矩阵结论无意义。
//   4) 串行执行，不并发。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(process.argv[2] || '.');
const SUITE = path.join(REPO, 'tests', 'loop-gate-test.mjs');
const GATE_REL = path.join('plugin', 'scripts', 'loop-gate.mjs');
const LF = String.fromCharCode(10);

const MUTANTS = [
  {
    id: 'M-D97a',
    desc: '投影口径不生效',
    anchor: '    if (owned === 0 && excluded === 0) {',
    mutant: '    if (false) {',
    expect: 'D-97 活体形态：兼容投影上连续 5 次相同调用 ⇒ 第 6 次被拦'
  },
  {
    id: 'M-D97b',
    desc: '对齐层恒判不匹配',
    anchor: "    if (normByKey(k, got) !== normByKey(k, want)) return 'mismatch';\n  }\n  return 'match';",
    mutant: "    if (normByKey(k, got) !== normByKey(k, want)) return 'mismatch';\n  }\n  return 'mismatch';",
    expect: 'D-97 白盒·对齐层：同参 ⇒ match；异参 ⇒ mismatch；动态参数 ⇒ unknown（打断连续段但不计入）'
  },
  {
    id: 'M-D97c',
    desc: '当前调用被计入（差一）',
    anchor: '  for (let i = cur - 1; i >= 0; i--) {',
    mutant: '  for (let i = cur; i >= 0; i--) {',
    expect: 'D-97 白盒·计数层：6 条外层条目里末尾连续相同数 = 5（当前那条不计），且定位到了当前调用'
  },
  {
    id: 'M-D97d',
    desc: '动态参数当可比',
    anchor: "  if (ext.dynamic.length) return 'unknown';",
    mutant: "  if (ext.dynamic.length) return 'match';",
    expect: 'D-97 白盒·对齐层：同参 ⇒ match；异参 ⇒ mismatch；动态参数 ⇒ unknown（打断连续段但不计入）'
  }
];

function copyPlugin(dest) {
  fs.cpSync(path.join(REPO, 'plugin'), dest, { recursive: true });
}
function runSuite(pluginRoot) {
  const env = Object.assign({}, process.env, { SAR_PLUGIN_ROOT: pluginRoot });
  const r = spawnSync(process.execPath, [SUITE], { cwd: REPO, env: env, encoding: 'utf8', timeout: 300000 });
  const raw = (r.stdout || '') + (r.stderr || '');
  const ls = raw.split(/\r?\n/);
  return {
    pass: ls.filter((l) => l.indexOf('PASS ') === 0).length,
    fail: ls.filter((l) => l.indexOf('FAIL ') === 0).length,
    fails: ls.filter((l) => l.indexOf('FAIL ') === 0).map((l) => l.slice(5).split(' :: ')[0]),
    exit: r.status
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-d97-mut-'));
const base = path.join(tmp, 'base');
copyPlugin(base);
const b = runSuite(base);
console.log('基线：pass=' + b.pass + ' fail=' + b.fail + ' exit=' + b.exit);
if (b.fail !== 0 || b.exit !== 0) {
  console.log('基线不绿 ⇒ 矩阵结论无意义，终止');
  process.exit(2);
}

let miss = 0;
let extraTotal = 0;
for (const m of MUTANTS) {
  const dir = path.join(tmp, m.id);
  copyPlugin(dir);
  const gf = path.join(dir, 'scripts', 'loop-gate.mjs');
  const src = fs.readFileSync(gf, 'utf8');
  const hits = src.split(m.anchor).length - 1;
  if (hits !== 1) {
    console.log(m.id + ' ' + m.desc + '：锚点命中 ' + hits + ' 次（必须恰好 1 次）⇒ 变异体无效');
    miss += 1;
    continue;
  }
  fs.writeFileSync(gf, src.replace(m.anchor, m.mutant), 'utf8');
  const chk = spawnSync(process.execPath, ['--check', gf], { encoding: 'utf8' });
  if (chk.status !== 0) {
    console.log(m.id + ' ' + m.desc + '：node --check exit=' + chk.status + ' ⇒ 变异体无效');
    miss += 1;
    continue;
  }
  const r = runSuite(dir);
  const hit = r.fails.some((l) => l.indexOf(m.expect) >= 0);
  const extra = Math.max(0, r.fail - 1);
  extraTotal += extra;
  const verdict = hit ? (r.fail === 1 ? '恰好红一条' : 'EXTRA-RED(' + extra + ')') : 'MISS';
  console.log(m.id + ' ' + m.desc + '：套件 pass=' + r.pass + ' fail=' + r.fail +
    ' 专属锚点红=' + (hit ? '是' : '否') + ' EXTRA-RED=' + extra + ' 总红数=' + r.fail + ' 判定=' + verdict);
  for (const l of r.fails) console.log('   RED ' + l);
  if (!hit) miss += 1;
}
console.log('MUT-CHECK 结束：MISS=' + miss + '  EXTRA-RED 合计=' + extraTotal);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(miss === 0 ? 0 : 1);