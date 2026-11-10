// 沙箱跑一套回归并把**完整**输出打出来（tools/run-tests.mjs 失败时只给最后 6 行）。
// 用法：node docs/audit/harness-f02/run-suite.mjs <suite> [pluginRoot] [repoDir]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const suite = process.argv[2] || 'lessons-test';
const root = process.argv[3] || 'plugin';
const repo = process.argv[4] || '.';
// head:<name> ⇒ 跑 git HEAD 里的那一版（用来看「改之前」有多少条断言）。
// 必须经 node 落盘：PowerShell 的 > 会写成 UTF-16，node 跑不了。
let file = path.join(repo, 'tests', suite + '.mjs');
if (suite.startsWith('head:')) {
  const name = suite.slice(5);
  const g = spawnSync('git', ['show', 'HEAD:tests/' + name + '.mjs'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (g.status !== 0) { console.log('git show 失败：' + (g.stderr || '').slice(0, 200)); process.exit(2); }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f02-head-'));
  file = path.join(tmpDir, name + '.mjs');
  fs.writeFileSync(file, g.stdout, 'utf8');
}
const env = { ...process.env, SAR_PLUGIN_ROOT: root, SAR_REPO_DIR: repo };
const t0 = Date.now();
const r = spawnSync(process.execPath, [file], { cwd: repo, env, encoding: 'utf8', timeout: 300000 });
const raw = (r.stdout || '') + (r.stderr || '');
const lines = raw.split(/\r?\n/);
const fails = lines.filter((l) => l.indexOf('FAIL ') === 0);
const passes = lines.filter((l) => l.indexOf('PASS ') === 0);
console.log('SUITE=' + suite + ' exit=' + r.status + ' pass=' + passes.length + ' fail=' + fails.length +
  ' elapsed=' + (Date.now() - t0) + 'ms');
if (process.env.SHOW_ALL === '1') {
  console.log(raw);
} else {
  fails.forEach((l) => console.log('   ' + l.slice(0, 240)));
  console.log('--- 末尾 25 行 ---');
  console.log(lines.filter((l) => l.trim()).slice(-25).join('\n'));
}
process.exit(r.status === 0 && fails.length === 0 ? 0 : 1);
