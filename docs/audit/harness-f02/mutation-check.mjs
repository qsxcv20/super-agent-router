// F-02 变异检验：把修复整段回退 → 对应断言必须变红。
//
// 用法：node docs/audit/harness-f02/mutation-check.mjs [变异体 id ...]
//   不带参数 = 跑全部（先跑一遍基线，再逐个变异体）。
//
// 变异定义在**外置表** docs/audit/harness-f02/mutations.json ——
// 长字符串内嵌在脚本里时，转义层数是主要故障源（上一轮就是这么把脚本结构弄坏的）。
//
// 沙箱：每个变异体在系统临时目录里复制一份 plugin/ + tests/ 再改 ——
// 仓库工作树零改动（与验收方的做法一致）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');   // harness-f02 → audit → docs → 仓库根
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'mutations.json'), 'utf8'));

const only = process.argv.slice(2).filter((x) => x && !x.startsWith('--'));
const skipBase = process.argv.includes('--skip-base');

function copyTree(src, dst) {
  fs.cpSync(src, dst, { recursive: true });
}

function makeSandbox(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f02-mut-' + tag + '-'));
  copyTree(path.join(REPO, 'plugin'), path.join(dir, 'plugin'));
  copyTree(path.join(REPO, 'tests'), path.join(dir, 'tests'));
  return dir;
}

function applyMutation(sandbox, mut) {
  const p = path.join(sandbox, mut.file);
  let raw = fs.readFileSync(p, 'utf8');
  const notes = [];
  for (const e of mut.edits) {
    const n = raw.split(e.find).length - 1;
    if (n !== 1) {
      throw new Error('变异体 ' + mut.id + ' 的 find 片段在 ' + mut.file + ' 里出现 ' + n +
        ' 次（必须恰好 1 次，否则这个变异体没真正打中目标）：' + e.find.slice(0, 90));
    }
    raw = raw.replace(e.find, e.replace);
    notes.push(e.find.slice(0, 60).replace(/\n/g, '⏎'));
  }
  fs.writeFileSync(p, raw, 'utf8');
  return notes;
}

function runSuite(sandbox, suite) {
  const file = path.join(sandbox, 'tests', suite + '.mjs');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, SAR_PLUGIN_ROOT: path.join(sandbox, 'plugin'), SAR_REPO_DIR: sandbox }
  });
  const raw = (r.stdout || '') + '\n' + (r.stderr || '');
  const lines = raw.split(/\r?\n/);
  return {
    suite,
    exit: r.status,
    pass: lines.filter((l) => l.indexOf('PASS ') === 0).length,
    fail: lines.filter((l) => l.indexOf('FAIL ') === 0).length,
    failLines: lines.filter((l) => l.indexOf('FAIL ') === 0),
    elapsed: Date.now() - t0
  };
}

// 基线：未变异时必须全绿 —— 否则「变异后变红」没有意义（本来就红）。
let bad = 0;
console.log('=== 基线（未变异）===');
for (const suite of (skipBase ? [] : ['lessons-test', 'records-test'])) {
  const sb = makeSandbox('base-' + suite);
  const r = runSuite(sb, suite);
  console.log('BASE ' + suite + ' pass=' + r.pass + ' fail=' + r.fail + ' exit=' + r.exit + ' (' + r.elapsed + 'ms)');
  if (r.fail > 0 || r.exit !== 0) {
    bad++;
    console.log('   基线就不绿 —— 变异检验无意义，先修基线：');
    r.failLines.forEach((l) => console.log('   ' + l.slice(0, 200)));
  }
  fs.rmSync(sb, { recursive: true, force: true });
}

const muts = SPEC.mutations.filter((m) => !only.length || only.includes(m.id));
for (const mut of muts) {
  const sb = makeSandbox(mut.id);
  let notes = [];
  try {
    notes = applyMutation(sb, mut);
  } catch (e) {
    console.log('SKIP ' + mut.id + ' ' + mut.defect + ' :: ' + (e && e.message));
    bad++;
    fs.rmSync(sb, { recursive: true, force: true });
    continue;
  }
  let anyRed = false;
  const detail = [];
  for (const suite of mut.suites) {
    const r = runSuite(sb, suite);
    const relevant = r.failLines.filter((l) => mut.expectFail.some((d) => l.indexOf(d) !== -1));
    if (relevant.length) anyRed = true;
    detail.push('suite=' + suite + ' pass=' + r.pass + ' fail=' + r.fail + ' 相关红=' + relevant.length +
      ' (' + r.elapsed + 'ms)');
    console.log('=== ' + mut.id + ' ' + mut.defect + ' ' + mut.desc);
    console.log('    ' + detail[detail.length - 1]);
    relevant.forEach((l) => console.log('    RED ' + l.slice(0, 200)));
    if (!relevant.length && r.fail > 0) {
      console.log('    （有红，但不是 ' + mut.expectFail.join('/') + ' 的：' +
        r.failLines.map((l) => l.slice(0, 60)).join(' | ') + '）');
    }
  }
  console.log(anyRed ? 'RED ' + mut.id + ' ' + mut.defect + ' 目标断言已变红 ✔'
    : 'NO-RED ' + mut.id + ' ' + mut.defect + ' 目标断言一条都没红 ✘');
  if (!anyRed) bad++;
  fs.rmSync(sb, { recursive: true, force: true });
}

console.log(bad === 0
  ? '>>> MUTATION CHECK OK（每个变异体都让目标断言变红，基线全绿）'
  : '>>> MUTATION CHECK 有问题（' + bad + ' 处）');
process.exit(bad === 0 ? 0 : 1);
