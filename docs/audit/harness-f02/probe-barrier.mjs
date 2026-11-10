// 探针：起跑号牌到底有没有把闸门跑起来。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = '.';
const PLUGIN_ROOT = 'plugin';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f02-barrier-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, '.superagent', 'lessons'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify({
  dispatches: [{ dispatch_id: 'd1', parent_session_id: 'mvs-parent-lesson', turn_id: 't1', agent: 'sa-x', agent_key: 'sa-x', scope: [], state: 'done', at: Date.now() }],
  bindings: []
}, null, 2));

// 复制测试里那段号牌生成逻辑
function makeBarrierRunner(dir, name) {
  const p = path.join(dir, name + '.mjs');
  fs.writeFileSync(p, [
    "import fs from 'node:fs';",
    "import { spawn } from 'node:child_process';",
    "const [goFile, script, payload] = process.argv.slice(2);",
    "process.stdout.write('READY\\n');",
    "const t0 = Date.now();",
    "while (!fs.existsSync(goFile)) {",
    "  if (Date.now() - t0 > 120000) { process.stdout.write('TIMEOUT\\n'); process.exit(3); }",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);",
    "}",
    "const child = spawn(process.execPath, [script, payload], { stdio: ['ignore', 'pipe', 'pipe'] });",
    "let out = '';",
    "child.stdout.on('data', (c) => { out += c; });",
    "child.stderr.on('data', (c) => { out += c; });",
    "child.on('close', () => { process.stdout.write(out); });"
  ].join('\n'), 'utf8');
  return p;
}

const runner = makeBarrierRunner(tmp, 'barrier');
console.log('RUNNER=' + runner);
console.log('--- runner 源码 ---');
console.log(fs.readFileSync(runner, 'utf8'));
console.log('--- 跑两个 ---');

const goFile = path.join(tmp, 'go.flag');
const GATE = path.join(PLUGIN_ROOT, 'scripts', 'lessons-gate.mjs');
const mk = (i) => new Promise((resolve) => {
  const payload = JSON.stringify({ session_id: 'mvs-parent-lesson', agent: 'sa-probe', task: '并发标记' + i + '号', type: '数据错误', symptom: '现象', cause: '根因', rule: '必须回显口径', next_time: '派工', occurrence: 'single' });
  const child = spawn('node', [runner, goFile, GATE, payload], { encoding: 'utf8', env: { ...process.env, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA } });
  let buf = '';
  child.stdout.on('data', (c) => { buf += c; });
  child.stderr.on('data', (c) => { buf += c; });
  child.on('close', () => resolve({ i, buf }));
  setTimeout(() => { if (buf.indexOf('READY') !== -1) fs.writeFileSync(goFile, 'go'); }, 300);
});
const out = await Promise.all([mk(0), mk(1)]);
out.forEach((o) => console.log('RUN' + o.i + ' OUT=' + JSON.stringify(o.buf)));
console.log('FILE_EXISTS=' + fs.existsSync(path.join(PROJ, '.superagent', 'lessons', 'sa-probe.md')));
