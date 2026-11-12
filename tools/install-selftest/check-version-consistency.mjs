// super-agent-router 版本一致性自测 —— 「版本号多处一致」与「目录结构数字」的常驻断言
//
// 断言条数（12 条断言）—— 机器标记：ASSERTION-COUNT: 12
//
// 为什么要有它（缺陷 D-94）：
//   升版时改了 plugin/.minimax-plugin/plugin.json 的 version，却没有同步
//   README / plugin README / CHANGELOG 里的版本字面量 ——
//   以前**没有任何检查会报错**（check-readme-consistency.mjs 读了 SRC_VERSION 却只打印不判定）。
//   同类漂移已经真实发生过：根 README 的「7 个 handler / 13 个脚本」与实际不符，
//   靠人眼在发布前才发现。
//
// 判定口径（写清楚才不会各自理解）：
//   1. 只有**「当前版本」的声明**参与判定：plugin.json 的 version、两份 README 的
//      「当前版本」与「本插件当前版本」、CHANGELOG 的**最新发布段**标题。
//      历史版本叙述**不参与**（契约里写着「v0.5.0 修掉的误伤」是历史标记，
//      不是当前版本的声明 —— 拿它跟 SRC_VERSION 比是错的）。
//   2. 结构数字（handler 数 / 脚本数）**从实际文件算**，不从 README 抄 ——
//      抄一遍等于造第二份事实源，迟早长歪。
//   3. 任何一处对不上 ⇒ 断言红 ⇒ **退出码非 0**（不静默通过）。
//   4. 字面量**缺失**也判红：把声明删掉不能绕过检查。
//
// 用法：node tools/install-selftest/check-version-consistency.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '   :: ' + detail); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
}

console.log('[套件] 版本与目录结构数字一致性（纯读，跨平台可跑）');

// ── 1. 单一事实源：plugin.json ──────────────────────────────
const manifestRaw = read('plugin/.minimax-plugin/plugin.json');
let manifest = {};
try { manifest = JSON.parse(manifestRaw); } catch (e) { manifest = {}; }
const SRC_VERSION = String(manifest.version || '');
check('plugin.json 可读且 version 非空', !!SRC_VERSION, 'version=' + SRC_VERSION);
check('SRC_VERSION 形如 x.y.z', /^\d+\.\d+\.\d+$/.test(SRC_VERSION), 'version=' + SRC_VERSION);

const rootReadme = read('README.md');
const pluginReadme = read('plugin/README.md');
const changelog = read('plugin/CHANGELOG.md');
const hooksRaw = read('plugin/hooks/hooks.json');

// ── 2. 两份 README 的「当前版本」字面量 ─────────────────────
function firstMatch(text, re) {
  const m = String(text || '').match(re);
  return m ? m[1] : '';
}
const rootCur = firstMatch(rootReadme, /当前版本：\*\*v?(\d+\.\d+\.\d+)\*\*/);
const rootNow = firstMatch(rootReadme, /本插件当前是 \*\*v?(\d+\.\d+\.\d+)\*\*/);
const pluginCur = firstMatch(pluginReadme, /当前版本：\*\*v?(\d+\.\d+\.\d+)\*\*/);
const pluginNow = firstMatch(pluginReadme, /本插件当前版本是 \*\*v?(\d+\.\d+\.\d+)\*\*/);
check('根 README 写明「当前版本」字面量', !!rootCur, '没找到「当前版本：**vX.Y.Z**」');
check('根 README 的「当前版本」== plugin.json', rootCur === SRC_VERSION, 'readme=' + rootCur + ' manifest=' + SRC_VERSION);
check('根 README 的「本插件当前是」== plugin.json', rootNow === SRC_VERSION, 'readme=' + rootNow + ' manifest=' + SRC_VERSION);
check('plugin/README 写明「当前版本」字面量', !!pluginCur, '没找到「当前版本：**vX.Y.Z**」');
check('plugin/README 的「当前版本」== plugin.json', pluginCur === SRC_VERSION, 'readme=' + pluginCur + ' manifest=' + SRC_VERSION);
check('plugin/README 的「本插件当前版本是」== plugin.json', pluginNow === SRC_VERSION, 'readme=' + pluginNow + ' manifest=' + SRC_VERSION);

// ── 3. CHANGELOG 的最新发布段 ───────────────────────────────
const changelogHead = firstMatch(changelog, /^## \[(\d+\.\d+\.\d+)\]/m);
check('CHANGELOG 的最新发布段标题 == plugin.json', changelogHead === SRC_VERSION,
  'changelog=' + changelogHead + ' manifest=' + SRC_VERSION);
check('CHANGELOG 里有本版本段', changelog.indexOf('[' + SRC_VERSION + ']') >= 0, '没找到 [' + SRC_VERSION + ']');

// ── 4. 目录结构数字：从实际文件算，不从 README 抄 ────────────
let hooks = {};
try { hooks = JSON.parse(hooksRaw); } catch (e) { hooks = {}; }
const handlerGroups = Object.values(hooks.hooks || {})
  .reduce((n, groups) => n + (Array.isArray(groups) ? groups.length : 0), 0);
let scriptCount = 0;
try {
  scriptCount = fs.readdirSync(path.join(ROOT, 'plugin', 'scripts'))
    .filter((f) => f.endsWith('.mjs')).length;
} catch (e) { scriptCount = 0; }
const rootHandlers = firstMatch(rootReadme, /#\s*(\d+)\s*个 handler/);
const rootScripts = firstMatch(rootReadme, /#\s*(\d+)\s*个脚本/);
check('根 README 的 handler 数 == hooks.json 实际组数（' + handlerGroups + '）',
  !!rootHandlers && Number(rootHandlers) === handlerGroups,
  'readme=' + rootHandlers + ' actual=' + handlerGroups);
check('根 README 的脚本数 == plugin/scripts 实际 .mjs 数（' + scriptCount + '）',
  !!rootScripts && Number(rootScripts) === scriptCount,
  'readme=' + rootScripts + ' actual=' + scriptCount);

console.log('');
console.log('==== 版本与结构数字对账：PASS ' + pass + ' / FAIL ' + fail + ' ====');
process.exit(fail > 0 ? 1 : 0);
