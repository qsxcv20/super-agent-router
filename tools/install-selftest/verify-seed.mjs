// super-agent-router 安装 / 卸载脚本自测 —— 播种与安装副本的 node 侧校验（21 条断言）
// 机器标记：ASSERTION-COUNT: 21
//
// 仅 Windows（依赖 powershell + PS 5.1）。
// 沙箱建在 %TEMP% 下，不在仓库里；版本号从 plugin/.minimax-plugin/plugin.json 读，不写死。
//
// 用法：node tools/install-selftest/verify-seed.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const INSTALL = path.join(ROOT, 'install.ps1');
const STATE_SRC = path.join(ROOT, '.superagent');
const TICK = String.fromCharCode(96);

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const SANDBOX = path.join(os.tmpdir(), 'sar-selftest-seed-' + stamp);
const FAKE_HOME = path.join(SANDBOX, 'fakehome');
fs.mkdirSync(FAKE_HOME, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '   :: ' + detail); }
}
function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

console.log('[平台] Windows only（依赖 powershell + PS 5.1）');
console.log('[沙箱] ' + SANDBOX);

// 版本从 manifest 读（不写死字面量）
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', '.minimax-plugin', 'plugin.json'), 'utf8'));
const SRC_VERSION = String(manifest.version);
console.log('[版本] ' + SRC_VERSION);

// 0. 先做一次干净播种（全新目录）
const proj2 = path.join(SANDBOX, 'proj2');
fs.rmSync(proj2, { recursive: true, force: true });
const r = spawnSync('powershell', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', INSTALL,
  '-Target', path.join(SANDBOX, 'plugins'),
  '-Project', proj2
], { encoding: 'utf8', env: { ...process.env, USERPROFILE: FAKE_HOME } });
check('安装+播种退出码 0', r.status === 0, 'status=' + r.status + ' stderr=' + String(r.stderr || '').slice(0, 200));

const STATE = path.join(proj2, '.superagent');
const INST = path.join(SANDBOX, 'plugins', 'super-agent-router');

// 1. 播种的 roster.json：node 的 JSON.parse 是真实消费者
const rosterPath = path.join(STATE, 'roster.json');
let roster = null;
try {
  roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  check('node JSON.parse 播种的 roster.json 成功', true);
} catch (e) {
  check('node JSON.parse 播种的 roster.json 成功', false, e.message);
}
if (roster) {
  check('roster.members 是数组', Array.isArray(roster.members), JSON.stringify(roster.members));
  check('roster.members 为空（默认 0 个成员）', roster.members.length === 0, 'len=' + roster.members.length);
  check('roster.note 是正常中文（无乱码）', /专项名录/.test(roster.note || ''), (roster.note || '').slice(0, 30));
  check('roster.version === 1', roster.version === 1, String(roster.version));
}
const rosterBytes = fs.readFileSync(rosterPath);
check('roster.json 无 BOM', !(rosterBytes[0] === 0xef && rosterBytes[1] === 0xbb && rosterBytes[2] === 0xbf),
  'bytes=' + [rosterBytes[0], rosterBytes[1], rosterBytes[2]].map(x => x.toString(16)).join(' '));

// 2. 播种的 STATUS.md
const statusRaw = fs.readFileSync(path.join(STATE, 'STATUS.md'), 'utf8');
check('STATUS.md 反引号占位符已替换（无 @BT@ 残留）', !statusRaw.includes('@BT@'), statusRaw.slice(0, 80));
check('STATUS.md 含反引号标记', statusRaw.includes(TICK), 'no backtick');
check('STATUS.md 中文正常', /项目状态层/.test(statusRaw), statusRaw.slice(0, 40));

// 3. 模板与源逐字节一致（四个）
const TEMPLATES = ['methods/_TEMPLATE.md', 'lessons/_TEMPLATE.md', 'incidents/_TEMPLATE.md', 'agent-snapshots/_README.md'];
for (const rel of TEMPLATES) {
  const src = path.join(STATE_SRC, ...rel.split('/'));
  const dst = path.join(STATE, ...rel.split('/'));
  const same = fs.existsSync(src) && fs.existsSync(dst) && sha(src) === sha(dst);
  check('模板逐字节一致：' + rel, same, 'src/dst 缺失或哈希不同');
}

// 4. 播种里不该出现本项目的成员产物
const methodsFiles = fs.readdirSync(path.join(STATE, 'methods'));
const lessonsFiles = fs.readdirSync(path.join(STATE, 'lessons'));
check('methods 只有 _TEMPLATE.md', methodsFiles.length === 1 && methodsFiles[0] === '_TEMPLATE.md', methodsFiles.join(','));
check('lessons 只有 _TEMPLATE.md', lessonsFiles.length === 1 && lessonsFiles[0] === '_TEMPLATE.md', lessonsFiles.join(','));

// 5. 安装副本与源包逐字节一致
function fileMap(root) {
  const out = {};
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) walk(full, rel);
      else out[rel] = sha(full);
    }
  };
  walk(root, '');
  return out;
}
const srcMap = fileMap(path.join(ROOT, 'plugin'));
const dstMap = fileMap(INST);
const srcKeys = Object.keys(srcMap).sort();
const dstKeys = Object.keys(dstMap).sort();
check('安装副本文件数 === 源 (' + srcKeys.length + ')', srcKeys.length === dstKeys.length, 'dst=' + dstKeys.length);
const mismatch = srcKeys.filter(k => dstMap[k] !== srcMap[k]);
check('安装副本逐文件 SHA256 全部一致', mismatch.length === 0, mismatch.slice(0, 5).join(','));

// 6. 安装副本 plugin.json 可被 node 解析
const man = JSON.parse(fs.readFileSync(path.join(INST, '.minimax-plugin', 'plugin.json'), 'utf8'));
check('安装副本 plugin.json 版本与源一致（' + SRC_VERSION + '）', man.version === SRC_VERSION, String(man.version));
check('安装副本 plugin.json name === super-agent-router', man.name === 'super-agent-router', String(man.name));

// 7. 安装副本 hooks.json 引用的脚本都在
const hooks = JSON.parse(fs.readFileSync(path.join(INST, 'hooks', 'hooks.json'), 'utf8'));
const cmds = [];
for (const evt of Object.values(hooks.hooks)) {
  for (const g of evt) for (const h of g.hooks) cmds.push(h.command, h.commandWindows);
}
const refs = [...new Set(cmds.map(c => (c.match(/scripts[\\/]([A-Za-z0-9_.-]+)/) || [])[1]).filter(Boolean))];
const missing = refs.filter(f => !fs.existsSync(path.join(INST, 'scripts', f)));
check('安装副本 hooks.json 引用的 ' + refs.length + ' 个脚本都在', missing.length === 0, missing.join(','));

console.log('');
console.log('==== 播种与安装副本（node 侧）：PASS ' + pass + ' / FAIL ' + fail + ' ====');
if (fail > 0) {
  console.log('沙箱保留在：' + SANDBOX);
  process.exit(1);
}
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(0);
