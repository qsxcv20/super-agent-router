// D-27 变异自检（常驻回归套件）
//
// 为什么要有这个：只跑「新实现全绿」不能证明修复有效 ——
// 必须把实现改回去，看新断言会不会红。
// 本套件把命中判定做四种定向回退，每种都必须让对应断言变红：
//   M1 回退扩展词表   -> 编排意图断言红（口语样本漏判）
//   M2 恢复长度门槛   -> 编排意图断言红（信号词路径被长度卡死）
//   M3 去掉动作性限定 -> 伪信号断言红（普通句子被误触发）
//   M4 常真桩对照     -> 单点动作 + 伪信号断言红（证明断言能发现过触发）
//
// 用法：node tests/d27-mut-test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO = process.env.SAR_REPO_DIR || process.cwd();
const PLUGIN = process.env.SAR_PLUGIN_ROOT || path.join(REPO, 'plugin');
const E2E = path.join(REPO, 'tests', 'e2e-test.mjs');

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);

const OLD_INTENT = "const TRIGGER_INTENT = /(派工|组队|组建|拆成|拆给|分工|并行|安排人|交给谁|谁来做|编排|路由|多.?agent|团队|专项|验收|复盘|错题本)/i;";
const START = 'const TRIGGER_INTENT = new RegExp([';
const END = "].join('|'), 'i');";
const ACT_GATE = 'if (TRIGGER_ACTION.test(p.slice(lo, hi))) {';

function replaceBlock(src, replacement) {
  const i = src.indexOf(START);
  if (i < 0) return null;
  const j = src.indexOf(END, i);
  if (j < 0) return null;
  return src.slice(0, i) + replacement + src.slice(j + END.length);
}

const MUTANTS = [
  { id: 'M1', desc: '回退扩展词表（换回改前的 INTENT 正则）',
    apply: (lib) => replaceBlock(lib, OLD_INTENT),
    expect: ['D-27 编排意图 23 条全部命中'] },
  { id: 'M2', desc: '恢复 prompt.length > 40 硬门槛',
    apply: (lib) => lib.replace(ACT_GATE, 'if (TRIGGER_ACTION.test(p.slice(lo, hi)) && p.length > 40) {'),
    expect: ['D-27 编排意图 23 条全部命中'] },
  { id: 'M3', desc: '去掉动作性限定（信号词裸命中即算意图）',
    apply: (lib) => lib.replace(ACT_GATE, 'if (true) {'),
    expect: ['D-27 伪信号 7 条全部不命中'] },
  { id: 'M4', desc: '常真桩对照（永远命中）',
    apply: (lib) => lib.replace("if (!p.trim()) return { hit: false, reason: '空 prompt' };", "if (!p.trim()) return { hit: false, reason: '空 prompt' };\n  return { hit: true, reason: 'STUB-ALWAYS-HIT' };"),
    expect: ['D-27 单点动作 6 条全部不命中', 'D-27 伪信号 7 条全部不命中'] }
];

// 每次用独立临时目录。
//
// 为什么不能用固定目录名（sar-d27mut-<tag>）：两个实例并发跑（比如父会话与独立验收方
// 同时跑全量回归）时，后一个会把前一个的副本 rmSync 掉再重拷 —— 前一个正在跑的
// e2e 于是读到半拷状态，「基线副本全绿」这条断言**假红**。
// **会给假 FAIL 的测试比没有测试更危险**：它教人忽略红灯。
const createdRoots = [];

function copyPlugin(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-d27mut-' + tag + '-'));
  createdRoots.push(root);
  const dst = path.join(root, 'plugin');
  fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(PLUGIN, dst, { recursive: true });
  return dst;
}

function cleanup() {
  for (const root of createdRoots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
  createdRoots.length = 0;
}

function runE2E(root) {
  const r = spawnSync('node', [E2E], { env: { ...process.env, SAR_PLUGIN_ROOT: root }, encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split(String.fromCharCode(10)).map(s => s.replace(String.fromCharCode(13), ''));
  return {
    red: lines.filter(l => l.indexOf('FAIL ') === 0),
    tail: lines.filter(l => l.trim()).slice(-1)[0] || ''
  };
}

// 0. 基线：未变异的副本必须全绿
{
  const root = copyPlugin('base');
  const r = runE2E(root);
  ok('D-27 变异自检·基线副本全绿', r.red.length === 0, r.red.slice(0, 3).join(' | ') + ' :: ' + r.tail);
  cleanup();
}

// 1. 逐个定向回退，每组都必须让对应断言变红
for (const m of MUTANTS) {
  const root = copyPlugin(m.id);
  const libPath = path.join(root, 'scripts', 'lib.mjs');
  const before = sha(libPath);
  const raw = fs.readFileSync(libPath, 'utf8');
  const after = m.apply(raw);
  if (after === null || after === raw) {
    ok(m.id + ' ' + m.desc + ' · 补丁命中', false, '锚点变了，变异没落地 —— 结论无效');
    cleanup();
    continue;
  }
  fs.writeFileSync(libPath, after, 'utf8');
  const afterSha = sha(libPath);
  const ck = spawnSync('node', ['--check', libPath], { encoding: 'utf8' });
  ok(m.id + ' ' + m.desc + ' · 变异确实落盘', before !== afterSha, before + ' -> ' + afterSha);
  ok(m.id + ' ' + m.desc + ' · 变异版语法合法', ck.status === 0, 'node --check exit=' + ck.status);
  const r = runE2E(root);
  const redText = r.red.join('\n');
  for (const label of m.expect) {
    ok(m.id + ' · 回退后「' + label + '」变红', redText.indexOf('FAIL ' + label) >= 0, 'RED=' + r.red.length + ' :: ' + r.tail);
  }
  cleanup();
}

console.log(fail === 0 ? '>>> D27MUT ALL PASS' : '>>> D27MUT FAILURES: ' + fail);
process.exit(fail ? 1 : 0);