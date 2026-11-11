// super-agent-router 安装 / 卸载脚本自测 —— 尾随空格路径身份（F1 的钉子）
//
// 断言条数（39 条断言）—— 机器标记：ASSERTION-COUNT: 39
//
// 为什么需要这条：Windows 常规 API 造不出 "dir " 这样的名字，但 \\?\ 扩展路径 / NTFS 直写可以。
// 路径的尾随空白是**路径身份的一部分** —— 若脚本把它静默裁掉，
// "-Target X " 与 "-Target X" 就完全等价，脚本会作用到用户**没指定**的那个目录。
//
// 本套件的判据：
//   1) 阳性对照（金丝雀）：普通目录（无尾随空格）安装 + 卸载**必须成功** ——
//      否则「一律报错」也可能只是脚本坏了，不能证明拦截有牙齿；
//   2) 带尾随空格的 -Target / -Project / 家目录：必须**非零退出**，而且输出必须
//      **恰好命中该入口的守卫消息**（"路径参数 <入口> 含尾随空白"），且**没有任何成功标记**。
//      只断言「非零退出」是不具区分度的 —— 脚本因为**别的原因**失败（比如搬不动带空格的路径）
//      同样会非零退出，那样的红钉不住守卫。所以这里把「为什么红」也钉死。
//   3) **用户没指定的同名目录内容一字未动**（标记文件 SHA256 前后相同）。
//
// 装、卸两侧都覆盖（家目录入口两侧各一组）。
//
// 仅 Windows（依赖 powershell + PS 5.1）。
//
// 用法：
//   node tools/install-selftest/trailing-space-test.mjs
//   # 对照「修复前」的脚本副本（把尾随空白拦截去掉的那份）：
//   SAR_PREFIX_INSTALL=<repo>\before-install.ps1 SAR_PREFIX_UNINSTALL=<repo>\before-uninstall.ps1 \
//     node tools/install-selftest/trailing-space-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const INSTALL = process.env.SAR_PREFIX_INSTALL || path.join(ROOT, 'install.ps1');
const UNINSTALL = process.env.SAR_PREFIX_UNINSTALL || path.join(ROOT, 'uninstall.ps1');
const LABEL = process.env.SAR_PREFIX_INSTALL ? 'BEFORE(修复前)' : 'AFTER(修复后)';

let pass = 0, fail = 0;
function oneLine(s) {
  // 明细压成单行：powershell 的 Write-Host 输出带 \r\n，直接拼进 FAIL 行会把终端刷花
  return String(s == null ? '' : s).replace(/\r\n|\r|\n/g, ' | ');
}
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '   :: ' + oneLine(detail)); }
}
function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function ext(p) { return '\\\\?\\' + p; }
function exists(p) { return fs.existsSync(ext(p)); }
function shaOf(p) { return sha(ext(p)); }

// ── 守卫命中判定（V1 的核心：红必须是因为守卫，不能是因为别的）──────
const GUARD_KW = '含尾随空白';
// 守卫的三个入口标签，必须与 install.ps1 / uninstall.ps1 里传给
// Assert-NoTrailingWhitespace 的 label 逐字一致
const ENTRY_LABELS = ['USERPROFILE（家目录）', '-Target', '-Project'];
function guardPhrase(label) {
  return '路径参数 ' + label + ' ' + GUARD_KW;
}
function guardHit(out, label) {
  return typeof out === 'string' && out.includes(guardPhrase(label));
}
// 只命中这一条入口（别的入口的守卫消息一条都不许出现）
function guardOnly(out, label) {
  if (!guardHit(out, label)) { return false; }
  for (const other of ENTRY_LABELS) {
    if (other === label) { continue; }
    if (out.includes(guardPhrase(other))) { return false; }
  }
  return true;
}
const INSTALL_OK_MARKERS = ['安装完成', '已播种', '自校验通过', '最终目录复核通过', '已创建安装根目录', '已是最新'];
const UNINSTALL_OK_MARKERS = ['已彻底删除', '已移到回收位', '删前核对通过', '运行时台账已移到回收位'];
function hitMarkers(out, markers) {
  return markers.filter(m => typeof out === 'string' && out.includes(m));
}

// ── 沙箱（%TEMP%，不在仓库里）──────────────────────────────────────
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const SANDBOX = path.join(os.tmpdir(), 'sar-selftest-ts-' + stamp);
const FAKE_HOME = path.join(SANDBOX, 'fakehome');
fs.mkdirSync(FAKE_HOME, { recursive: true });

console.log('[平台] Windows only（依赖 powershell + PS 5.1）');
console.log('[套件] 尾随空格路径身份 —— ' + LABEL);
console.log('[沙箱] ' + SANDBOX);
console.log('[安装] ' + INSTALL);
console.log('[卸载] ' + UNINSTALL);

// ── 造「同名只差尾随空格」的兄弟根 ─────────────────────────────────
function makePair(base, name) {
  const plain = path.join(base, name);
  const spaced = path.join(base, name + ' ');
  fs.mkdirSync(plain, { recursive: true });
  fs.mkdirSync(ext(spaced), { recursive: true });
  return { plain, spaced };
}

function putPlugin(root, markerText) {
  // 夹具必须是**合法的插件目录**（含 name 正确的 plugin.json）——
  // 否则「删前内容级核对」会意外拦住，掩盖尾随空格这条线本身的对照效果。
  const dir = path.join(root, 'super-agent-router');
  fs.mkdirSync(ext(path.join(dir, '.minimax-plugin')), { recursive: true });
  fs.writeFileSync(ext(path.join(dir, '.minimax-plugin', 'plugin.json')),
    JSON.stringify({ schemaVersion: 1, name: 'super-agent-router', version: '0.0.0-selftest' }, null, 2), 'utf8');
  const marker = path.join(dir, 'MARKER.txt');
  fs.writeFileSync(ext(marker), markerText, 'utf8');
  return { dir, marker, sha: shaOf(marker) };
}

// ── 跑子进程 ───────────────────────────────────────────────────────
function run(script, args, homeOverride) {
  const r = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args
  ], { encoding: 'utf8', env: { ...process.env, USERPROFILE: homeOverride || FAKE_HOME } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// ═══════════════════════════════════════════════════════════════════
// 1) 阳性对照（金丝雀）：普通目录必须能正常安装 + 卸载
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('--- 阳性对照：普通目录（无尾随空格）必须工作正常 ---');
const okRoot = path.join(SANDBOX, 'ok');
const r1 = run(INSTALL, ['-Target', okRoot]);
check('金丝雀：普通目录安装 exit 0', r1.code === 0, 'code=' + r1.code + ' out=' + r1.out.slice(0, 300));
check('金丝雀：普通目录装出了插件目录', exists(path.join(okRoot, 'super-agent-router')), 'missing');
check('金丝雀：普通目录安装输出里没有尾随空白守卫消息',
  !r1.out.includes(GUARD_KW), r1.out.slice(0, 300));
const r2 = run(UNINSTALL, ['-Target', okRoot, '-Purge']);
check('金丝雀：普通目录卸载 exit 0', r2.code === 0, 'code=' + r2.code + ' out=' + r2.out.slice(0, 300));
check('金丝雀：普通目录插件目录已删', !exists(path.join(okRoot, 'super-agent-router')), 'still there');
check('金丝雀：普通目录卸载输出里没有尾随空白守卫消息',
  !r2.out.includes(GUARD_KW), r2.out.slice(0, 300));

// ═══════════════════════════════════════════════════════════════════
// 2) -Target 带尾随空格：uninstall -Purge
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('--- -Target 带尾随空格：uninstall -Purge ---');
const pair = makePair(SANDBOX, 'p');
// 构造有效性的正向证据：两个根必须**确实并存**（同名，名字长度差 1）。
// 没有这条，「用户没指定的目录还在」可能只是因为两个目录根本没造出来。
const children = fs.readdirSync(SANDBOX).filter(n => n === 'p' || n === 'p ');
console.log('[造目录] 父目录下读到 ' + JSON.stringify(children) +
  '（两个根确实并存，名字只差尾随空格）');
check('两个根确实并存（同名，名字长度差 1）',
  children.length === 2 && children.some(n => n.length === 1) && children.some(n => n.length === 2),
  JSON.stringify(children));
const plainSide = putPlugin(pair.plain, 'PLAIN-SIDE-MARKER');
const spacedSide = putPlugin(pair.spaced, 'SPACED-SIDE-MARKER');
console.log('[参数] TARGET_ARG=' + JSON.stringify(pair.spaced) + ' len=' + pair.spaced.length);
check('参数确实带着尾随空格（长度比无空格版多 1）',
  pair.spaced.length === pair.plain.length + 1, pair.plain.length + ' vs ' + pair.spaced.length);

const r3 = run(UNINSTALL, ['-Target', pair.spaced, '-Purge']);
console.log(r3.out.trim());
check('带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）',
  r3.code !== 0 && guardHit(r3.out, '-Target'),
  'code=' + r3.code + ' 命中守卫=' + guardHit(r3.out, '-Target') + ' out=' + r3.out.slice(0, 300));
check('带尾随空格的 -Target：守卫只命中 -Target 这一条入口',
  guardOnly(r3.out, '-Target'),
  'out=' + r3.out.slice(0, 300));
check('带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）',
  hitMarkers(r3.out, UNINSTALL_OK_MARKERS).length === 0,
  '出现了成功标记：' + hitMarkers(r3.out, UNINSTALL_OK_MARKERS).join(','));
check('带尾随空格的 -Target：用户【没指定】的目录仍在', exists(plainSide.dir), 'plain plugin dir 被删了');
check('带尾随空格的 -Target：用户【没指定】的目录内容一字未动',
  exists(plainSide.marker) && shaOf(plainSide.marker) === plainSide.sha, 'plain marker 变了');
check('带尾随空格的 -Target：用户【指定】的目录仍在', exists(spacedSide.dir), 'spaced plugin dir 没了');
check('带尾随空格的 -Target：用户【指定】的目录内容一字未动',
  exists(spacedSide.marker) && shaOf(spacedSide.marker) === spacedSide.sha, 'spaced marker 变了');

// ═══════════════════════════════════════════════════════════════════
// 3) -Target 带尾随空格：install
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('--- -Target 带尾随空格：install ---');
const pairQ = makePair(SANDBOX, 'q');
const childrenQ = fs.readdirSync(SANDBOX).filter(n => n === 'q' || n === 'q ');
console.log('[造目录] 父目录下读到 ' + JSON.stringify(childrenQ) + '（两个根确实并存）');
check('install 场景：两个根确实并存（同名，名字长度差 1）',
  childrenQ.length === 2 && childrenQ.some(n => n.length === 1) && childrenQ.some(n => n.length === 2),
  JSON.stringify(childrenQ));
check('install 场景：参数确实带着尾随空格（长度比无空格版多 1）',
  pairQ.spaced.length === pairQ.plain.length + 1, pairQ.plain.length + ' vs ' + pairQ.spaced.length);
const r4 = run(INSTALL, ['-Target', pairQ.spaced]);
console.log(r4.out.trim());
check('install 带尾随空格的 -Target：非零退出且命中守卫（-Target 入口）',
  r4.code !== 0 && guardHit(r4.out, '-Target'),
  'code=' + r4.code + ' 命中守卫=' + guardHit(r4.out, '-Target') + ' out=' + r4.out.slice(0, 300));
check('install 带尾随空格的 -Target：守卫只命中 -Target 这一条入口',
  guardOnly(r4.out, '-Target'), 'out=' + r4.out.slice(0, 300));
check('install 带尾随空格的 -Target：输出里没有任何成功标记（只因守卫而红）',
  hitMarkers(r4.out, INSTALL_OK_MARKERS).length === 0,
  '出现了成功标记：' + hitMarkers(r4.out, INSTALL_OK_MARKERS).join(','));
check('install 带尾随空格的 -Target：无空格的那个目录未被创建',
  !exists(path.join(pairQ.plain, 'super-agent-router')), 'plain 目录被装了');
check('install 带尾随空格的 -Target：带空格的那个目录未被创建',
  !exists(path.join(pairQ.spaced, 'super-agent-router')), 'spaced 目录被装了');

// ═══════════════════════════════════════════════════════════════════
// 4) -Project 带尾随空格
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('--- -Project 带尾随空格 ---');
const projSpaced = path.join(SANDBOX, 's ');
fs.mkdirSync(ext(projSpaced), { recursive: true });
const projPlain = path.join(SANDBOX, 's');
check('-Project 场景：带空格的项目目录确实存在', exists(projSpaced), '夹具没造出来');
const r5 = run(INSTALL, ['-Target', path.join(SANDBOX, 'r'), '-Project', projSpaced]);
console.log(r5.out.trim());
check('install 带尾随空格的 -Project：非零退出且命中守卫（-Project 入口）',
  r5.code !== 0 && guardHit(r5.out, '-Project'),
  'code=' + r5.code + ' 命中守卫=' + guardHit(r5.out, '-Project') + ' out=' + r5.out.slice(0, 300));
check('install 带尾随空格的 -Project：守卫只命中 -Project 这一条入口',
  guardOnly(r5.out, '-Project'), 'out=' + r5.out.slice(0, 300));
check('install 带尾随空格的 -Project：输出里没有任何成功标记（只因守卫而红）',
  hitMarkers(r5.out, INSTALL_OK_MARKERS).length === 0,
  '出现了成功标记：' + hitMarkers(r5.out, INSTALL_OK_MARKERS).join(','));
check('install 带尾随空格的 -Project：带空格的项目目录未被播种',
  !exists(path.join(projSpaced, '.superagent')), 'spaced 项目被播种了');
check('install 带尾随空格的 -Project：无空格的项目目录未被播种',
  !exists(path.join(projPlain, '.superagent')), 'plain 项目被播种了');
check('install 带尾随空格的 -Project：目标插件目录未被创建',
  !exists(path.join(SANDBOX, 'r', 'super-agent-router')), 'r 被装了');

// ═══════════════════════════════════════════════════════════════════
// 5) 家目录（USERPROFILE）带尾随空格：install
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('--- 家目录（USERPROFILE）带尾随空格：install ---');
const homeSpaced = path.join(SANDBOX, 'h ');
fs.mkdirSync(ext(homeSpaced), { recursive: true });
check('install 家目录场景：带空格的家目录确实存在', exists(homeSpaced), '夹具没造出来');
const r6 = run(INSTALL, [], homeSpaced);
console.log(r6.out.trim());
check('install 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）',
  r6.code !== 0 && guardHit(r6.out, 'USERPROFILE（家目录）'),
  'code=' + r6.code + ' 命中守卫=' + guardHit(r6.out, 'USERPROFILE（家目录）') + ' out=' + r6.out.slice(0, 300));
check('install 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口',
  guardOnly(r6.out, 'USERPROFILE（家目录）'), 'out=' + r6.out.slice(0, 300));
check('install 家目录带尾随空格：输出里没有任何成功标记（只因守卫而红）',
  hitMarkers(r6.out, INSTALL_OK_MARKERS).length === 0,
  '出现了成功标记：' + hitMarkers(r6.out, INSTALL_OK_MARKERS).join(','));
check('install 家目录带尾随空格：未在无空格家目录下建插件目录',
  !exists(path.join(SANDBOX, 'h', '.minimax', 'plugins', 'super-agent-router')), 'h 被装了');
check('install 家目录带尾随空格：带空格的家目录下也没建 .minimax',
  !exists(path.join(SANDBOX, 'h ', '.minimax')), 'h 下面被写了 .minimax');

// ═══════════════════════════════════════════════════════════════════
// 6) 家目录（USERPROFILE）带尾随空格：uninstall
// ═══════════════════════════════════════════════════════════════════
console.log('');
console.log('--- 家目录（USERPROFILE）带尾随空格：uninstall ---');
const homeSpaced2 = path.join(SANDBOX, 'g ');
fs.mkdirSync(ext(homeSpaced2), { recursive: true });
check('uninstall 家目录场景：带空格的家目录确实存在', exists(homeSpaced2), '夹具没造出来');
const r7 = run(UNINSTALL, ['-Purge'], homeSpaced2);
console.log(r7.out.trim());
check('uninstall 家目录带尾随空格：非零退出且命中守卫（USERPROFILE 入口）',
  r7.code !== 0 && guardHit(r7.out, 'USERPROFILE（家目录）'),
  'code=' + r7.code + ' 命中守卫=' + guardHit(r7.out, 'USERPROFILE（家目录）') + ' out=' + r7.out.slice(0, 300));
check('uninstall 家目录带尾随空格：守卫只命中 USERPROFILE 这一条入口',
  guardOnly(r7.out, 'USERPROFILE（家目录）'), 'out=' + r7.out.slice(0, 300));
check('uninstall 家目录带尾随空格：输出里没有任何成功标记（只因守卫而红）',
  hitMarkers(r7.out, UNINSTALL_OK_MARKERS).length === 0,
  '出现了成功标记：' + hitMarkers(r7.out, UNINSTALL_OK_MARKERS).join(','));

console.log('');
console.log('==== 尾随空格路径身份（' + LABEL + '）：PASS ' + pass + ' / FAIL ' + fail + ' ====');
if (fail > 0) {
  console.log('沙箱保留在：' + SANDBOX);
  process.exit(1);
}
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(0);
