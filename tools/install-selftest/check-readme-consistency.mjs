// super-agent-router 安装 / 卸载脚本自测 —— 文档与实现逐字对账
//
// 断言条数（131 条断言）—— 机器标记：ASSERTION-COUNT: 131
//
// 防的是「文档写的参数 / 说法，脚本不支持或与实现相反」这一类洞
// （上一轮 F-08 与本轮 F2 / F3 / F6，以及 V2 / V3 / V4 都是这一类）。
//
// 本套件只读文件、不执行脚本 ⇒ **跨平台可跑**（不依赖 powershell）。
// 版本号从 plugin/.minimax-plugin/plugin.json 读，不写死。
//
// 用法：node tools/install-selftest/check-readme-consistency.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const install = fs.readFileSync(path.join(ROOT, 'install.ps1'), 'utf8');
const uninstall = fs.readFileSync(path.join(ROOT, 'uninstall.ps1'), 'utf8');
const TICK = String.fromCharCode(96);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '   :: ' + detail); }
}

console.log('[套件] 文档与实现逐字对账（纯读，跨平台可跑）');

// 0. 版本从 manifest 读
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin', '.minimax-plugin', 'plugin.json'), 'utf8'));
const SRC_VERSION = String(manifest.version);
console.log('[版本] ' + SRC_VERSION);

// 1. 从脚本 param 块提取真实参数名
function paramsOf(src) {
  const m = src.match(/param\s*\(([\s\S]*?)\n\)/);
  if (!m) return [];
  const names = [];
  const re = /\[(?:string|switch|int|bool)\]\s*\$(\w+)/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) names.push(mm[1]);
  return names;
}
const installParams = paramsOf(install);
const uninstallParams = paramsOf(uninstall);
console.log('install.ps1  参数: ' + installParams.join(', '));
console.log('uninstall.ps1 参数: ' + uninstallParams.join(', '));
check('install.ps1 参数集为 Target/Project/VerifyOnly',
  ['Target', 'Project', 'VerifyOnly'].every(x => installParams.includes(x)) && installParams.length === 3,
  installParams.join(','));
check('uninstall.ps1 参数集为 Target/Purge/PurgeData',
  ['Target', 'Purge', 'PurgeData'].every(x => uninstallParams.includes(x)) && uninstallParams.length === 3,
  uninstallParams.join(','));

// 2. README 里每条命令的参数都必须被脚本支持
const cmdRe = /\.(?:\\|\/)(install|uninstall)\.ps1((?:\s+-[A-Za-z]+)*)/g;
let cm;
const seen = [];
while ((cm = cmdRe.exec(readme)) !== null) {
  const script = cm[1] + '.ps1';
  const args = (cm[2] || '').trim();
  const used = args ? args.split(/\s+/) : [];
  const allowed = script === 'install.ps1' ? installParams : uninstallParams;
  const bad = used.filter(a => !allowed.includes(a.replace(/^-/, '')));
  check('README 命令参数受支持: ' + script + ' ' + (args || '(无参数)'),
    bad.length === 0, '脚本不支持: ' + bad.join(','));
  seen.push(script + ' ' + args);
}
console.log('README 里出现的脚本命令共 ' + seen.length + ' 条：');
seen.forEach(s => console.log('    ' + s));

// 3. 三种安装形态 + 三种卸载形态
check('README 含一键安装命令', /powershell -ExecutionPolicy Bypass -File \.\\install\.ps1/.test(readme), 'missing');
check('README 含 -Target 示例', /install\.ps1 -Target/.test(readme), 'missing');
check('README 含 -Project 示例', /install\.ps1 -Project/.test(readme), 'missing');
check('README 含 -VerifyOnly 示例', /install\.ps1 -VerifyOnly/.test(readme), 'missing');
check('README 含卸载默认命令', /uninstall\.ps1\b/.test(readme), 'missing');
check('README 含 -Purge 示例', /uninstall\.ps1 -Purge/.test(readme), 'missing');
check('README 含 -Purge -PurgeData 示例', /uninstall\.ps1 -Purge -PurgeData/.test(readme), 'missing');

// 4. 路径字面量与脚本实际目标一致
const installTargetLiteral = install.match(/Join-Path \$env:USERPROFILE '([^']+)'/);
const uninstallTargetLiteral = uninstall.match(/Join-Path \$env:USERPROFILE '([^']+)'/);
check('install.ps1 默认目标 = .minimax\\plugins', installTargetLiteral && installTargetLiteral[1] === '.minimax\\plugins',
  installTargetLiteral ? installTargetLiteral[1] : 'n/a');
check('uninstall.ps1 默认目标 = .minimax\\plugins', uninstallTargetLiteral && uninstallTargetLiteral[1] === '.minimax\\plugins',
  uninstallTargetLiteral ? uninstallTargetLiteral[1] : 'n/a');
check('README 写明插件安装位置 .minimax\\plugins\\super-agent-router',
  readme.includes('.minimax\\plugins\\super-agent-router'), 'missing');
check('README 写明 .trash 回收位', readme.includes('.trash\\super-agent-router-'), 'missing');
check('README 写明运行时台账位置',
  readme.includes('.minimax\\v2\\plugin-data\\hooks\\super-agent-router'), 'missing');

// 5. 关键语义：脚本说「必须新开会话」，README 也必须说
check('install.ps1 提示必须新开会话', install.includes('必须新开一个会话'), 'missing');
check('README 提示必须新开会话', /新开一个会话/.test(readme), 'missing');
check('uninstall.ps1 声明不碰项目 .superagent', uninstall.includes('.superagent/'), 'missing');
check('README 声明不碰项目 .superagent', readme.includes(TICK + '.superagent/' + TICK + ' 一律不动'), 'missing');

// ── F2：README 的模板数必须与脚本实际播种数一致，并列全 ──────────────
const templateArray = install.match(/\$templates = @\(([\s\S]*?)\n    \)/);
const scriptTemplates = templateArray
  ? [...templateArray[1].matchAll(/dst = '([^']+)'/g)].map(m => m[1].replace(/\\/g, '/'))
  : [];
console.log('脚本实际播种模板（' + scriptTemplates.length + ' 个）: ' + scriptTemplates.join(', '));
check('脚本模板数 > 0', scriptTemplates.length > 0, '没解析到模板数组');
check('README 不再写「三个模板」', !readme.includes('三个模板'), 'README 仍写「三个模板」');
check('README 写明四个模板',
  /四个模板|4 个模板/.test(readme), 'README 没有写「四个模板」');
for (const t of scriptTemplates) {
  check('README 列出了模板：' + t, readme.includes(t.replace('agent-snapshots/', 'agent-snapshots/')), 'missing');
}
const readmeTemplateCount = (readme.match(/_(?:TEMPLATE\.md|README\.md)/g) || []).length;
check('README 里出现的模板文件名个数 >= 脚本模板数',
  readmeTemplateCount >= scriptTemplates.length,
  'readme=' + readmeTemplateCount + ' script=' + scriptTemplates.length);

// ── F3：手工复制路径的清理清单要全（名录 / STATUS / changes.log）─────
const manualSection = readme.split('备选：手工复制')[1] || '';
check('README 手工复制段存在', manualSection.length > 0, 'missing');
for (const item of ['roster.json', 'STATUS.md', 'changes.log']) {
  check('README 手工复制清理清单含 ' + item, manualSection.includes(item), 'missing');
}
check('README 手工复制段提到 methods/ 与 lessons/', manualSection.includes('methods/') && manualSection.includes('lessons/'), 'missing');

// ── F1：尾随空白的口径，脚本与 README 必须一致 ─────────────────────
check('install.ps1 含尾随空白拦截函数', install.includes('Assert-NoTrailingWhitespace'), 'missing');
check('uninstall.ps1 含尾随空白拦截函数', uninstall.includes('Assert-NoTrailingWhitespace'), 'missing');
check('install.ps1 对 -Target 做了判定', /Assert-NoTrailingWhitespace \$Target '-Target'/.test(install), 'missing');
check('install.ps1 对 -Project 做了判定', /Assert-NoTrailingWhitespace \$Project '-Project'/.test(install), 'missing');
check('uninstall.ps1 对 -Target 做了判定', /Assert-NoTrailingWhitespace \$Target '-Target'/.test(uninstall), 'missing');
check('两个脚本都对家目录做了判定',
  /Assert-NoTrailingWhitespace \$env:USERPROFILE/.test(install) &&
  /Assert-NoTrailingWhitespace \$env:USERPROFILE/.test(uninstall), 'missing');
check('README 说明了尾随空白会被拒绝', /尾随空白|尾随空格/.test(readme), 'missing');

// ── F6：uninstall.ps1 不许再有「同源恒真」的删前比较，也不许留与实现相反的注释 ──
check('uninstall.ps1 不含恒真自比较（$expected = Join-Path $TargetRoot）',
  !uninstall.includes('$expected = Join-Path $TargetRoot'), '恒真比较还在');
check('uninstall.ps1 不含恒真自比较（$expectedData = Join-Path $dataParent）',
  !uninstall.includes('$expectedData = Join-Path $dataParent'), '恒真比较还在');
check('uninstall.ps1 的删前核对是内容级（读 manifest 核对 name）',
  uninstall.includes('.minimax-plugin') && /manifest\.name|\$manifest\.name/.test(uninstall), 'missing');
check('uninstall.ps1 注释不含与实现相反的「不 trim」表述',
  !uninstall.includes('不 trim'), '注释仍写「不 trim」');
check('README 不含与实现相反的「不 trim」表述',
  !readme.includes('不 trim'), 'README 仍写「不 trim」');

// ── V2：尾随分隔符归一（修之前「装得上、卸不掉」）───────────────
check('uninstall.ps1 有尾随分隔符归一函数 Get-ComparablePath',
  uninstall.includes('Get-ComparablePath'), 'missing');
check('uninstall.ps1 的归一明确「只动分隔符、一个空白都不动」',
  uninstall.includes('只动分隔符') && uninstall.includes('一个空白都不动'), 'missing');
check('uninstall.ps1 的归一对盘符根做了特判（不能归成 C:）',
  /盘符根/.test(uninstall), 'missing');
check('uninstall.ps1 的删前核对用的是归一后的值',
  /Get-ComparablePath \$parentOfTarget/.test(uninstall) && /Get-ComparablePath \$TargetRoot/.test(uninstall), 'missing');
check('README 写明 -Target 带尾随反斜杠也能装能卸',
  readme.includes('尾随反斜杠'), 'missing');

// ── V3：不得再宣称「两条独立核对」 ──────────────────────────────
check('uninstall.ps1 不再宣称「两条独立核对」',
  !uninstall.includes('两条独立核对'), '还在宣称');
check('README 不再宣称「两条独立核对」',
  !readme.includes('两条独立核对'), '还在宣称');
check('uninstall.ps1 写明路径级只是「结构自检」',
  uninstall.includes('结构自检'), 'missing');
check('README 写明路径级只是「结构自检」',
  readme.includes('结构自检'), 'missing');
check('uninstall.ps1 写明内容级 manifest 核对是「唯一有牙齿的一条」',
  uninstall.includes('唯一有牙齿的一条'), 'missing');
check('README 写明内容级 manifest 核对是「唯一有牙齿的一条」',
  readme.includes('唯一有牙齿的一条'), 'missing');
check('uninstall.ps1 写明结构自检挡不住「作用到了别的目录」',
  uninstall.includes('挡不住'), 'missing');
check('README 写明结构自检挡不住「作用到了别的目录」',
  readme.includes('挡不住'), 'missing');

// ── V4：条数声明防漂（机器标记 ↔ 头部人类可读文本 ↔ README 表格）──
const SELFTEST_DIR = path.join(ROOT, 'tools', 'install-selftest');
const SUITE_FILES = ['sandbox-test.ps1', 'sandbox-test2.ps1', 'trailing-space-test.mjs',
  'verify-seed.mjs', 'check-readme-consistency.mjs', 'run-all-exit-code-test.mjs'];
for (const f of SUITE_FILES) {
  const src = fs.readFileSync(path.join(SELFTEST_DIR, f), 'utf8');
  const marks = [...src.matchAll(/ASSERTION-COUNT:\s*(\d+)/g)].map(m => m[1]);
  check('套件 ' + f + ' 有且只有一个 ASSERTION-COUNT 机器标记', marks.length === 1,
    'marks=' + marks.join(','));
  if (marks.length !== 1) { continue; }
  const n = marks[0];
  check('套件 ' + f + ' 头部人类可读条数与机器标记一致（' + n + ' 条断言）',
    src.includes('（' + n + ' 条断言）'), '头部没有「（' + n + ' 条断言）」');
  const row = readme.split('\n').find(l => l.trim().startsWith('|') && l.includes('`' + f + '`'));
  check('README 自测表里有 ' + f + ' 这一行', !!row, 'missing');
  if (row) {
    const cells = row.split('|').map(s => s.trim());
    check('README 自测表里 ' + f + ' 的条数与机器标记一致（' + n + '）',
      cells[cells.length - 2] === n, 'README 写的是 ' + cells[cells.length - 2]);
  }
}
const runAllSrc = fs.readFileSync(path.join(SELFTEST_DIR, 'run-all.ps1'), 'utf8');
const runAllMarks = [...runAllSrc.matchAll(/ASSERTION-COUNT:\s*(\d+)/g)].map(m => m[1]);
check('run-all.ps1 有且只有一个 ASSERTION-COUNT 机器标记', runAllMarks.length === 1,
  'marks=' + runAllMarks.join(','));
if (runAllMarks.length === 1) {
  check('run-all.ps1 头部人类可读条数与机器标记一致（' + runAllMarks[0] + ' 条断言）',
    runAllSrc.includes('（' + runAllMarks[0] + ' 条断言）'), '头部没有「（' + runAllMarks[0] + ' 条断言）」');
  check('run-all.ps1 真的做了「声明条数 == 实际 PASS+FAIL 条数」的核对',
    /PASS\|FAIL\)  /.test(runAllSrc) && runAllSrc.includes('实际断言条数 == 头部声明'), 'missing');
}

// ── W1：自测的传参方式必须与路径形态无关 ─────────────────────────
const st2 = fs.readFileSync(path.join(SELFTEST_DIR, 'sandbox-test2.ps1'), 'utf8');
check('sandbox-test2.ps1 的尾随反斜杠场景改用 -Command 内联传参（W1）',
  /RunPsQuotedArg \$installPs1 \$slashArg/.test(st2) && /RunPsQuotedArg \$uninstallPs1 \$slashArg/.test(st2),
  'missing');
check('sandbox-test2.ps1 不再用 -File + 原生参数传尾随反斜杠（W1）',
  !/'-File',\$installPs1,'-Target',\$slashArg/.test(st2), '还在用旧方式');
check('sandbox-test2.ps1 保留了 arg-echo 逐字断言（构造有效性）（W1）',
  st2.includes('Get-EchoedArg') && st2.includes('-ceq $slashArg'), 'missing');
check('sandbox-test2.ps1 有畸形命令行的真实复现场景（W1-2：S20 / S21）',
  st2.includes('RunPsCmdLine') && st2.includes('场景 20') && st2.includes('场景 21'), 'missing');
check('sandbox-test2.ps1 的畸形场景断言「零副作用 / 零删除」（W1-2）',
  st2.includes('零副作用') && st2.includes('零删除'), 'missing');
check('README 写明自测与路径形态无关（空格 / 中文都能跑）（W1）',
  readme.includes('路径形态无要求'), 'missing');

// ── W2：非法字符闸门（干净报错 / 不静默修复 / 不放松空白判定）────
check('install.ps1 有非法字符闸门 Assert-NoIllegalPathChars（W2）',
  install.includes('Assert-NoIllegalPathChars'), 'missing');
check('uninstall.ps1 有非法字符闸门 Assert-NoIllegalPathChars（W2）',
  uninstall.includes('Assert-NoIllegalPathChars'), 'missing');
for (const pair of [['install.ps1', install], ['uninstall.ps1', uninstall]]) {
  const nm = pair[0], src = pair[1];
  check(nm + ' 的非法字符闸门在 GetFullPath 之前（-Target）（W2）',
    src.indexOf("Assert-NoIllegalPathChars $Target '-Target'") >= 0 &&
    src.indexOf("Assert-NoIllegalPathChars $Target '-Target'") < src.indexOf('[System.IO.Path]::GetFullPath($Target)'),
    '顺序不对');
}
check('install.ps1 的非法字符闸门覆盖 -Project（W2）',
  install.includes("Assert-NoIllegalPathChars $Project '-Project'"), 'missing');
check('两个脚本都对家目录做了非法字符判定（W2）',
  install.includes('Assert-NoIllegalPathChars $env:USERPROFILE') && uninstall.includes('Assert-NoIllegalPathChars $env:USERPROFILE'), 'missing');
for (const ph of ['含 Windows 路径非法字符', '末尾的反斜杠被闭引号吃掉', '去掉末尾的反斜杠', '两个反斜杠', '已停止，未做任何改动']) {
  check('install.ps1 的非法字符报错逐字含「' + ph + '」（W2）', install.includes(ph), 'missing');
  check('uninstall.ps1 的非法字符报错逐字含「' + ph + '」（W2）', uninstall.includes(ph), 'missing');
}
function extractGate(src) {
  const i = src.indexOf('function Assert-NoIllegalPathChars');
  if (i < 0) { return ''; }
  const j = src.indexOf('\n}\n', i);
  return j < 0 ? '' : src.slice(i, j + 3);
}
const gateInstall = extractGate(install);
const gateUninstall = extractGate(uninstall);
check('两个脚本的非法字符闸门实现逐字相同（同一份文案）（W2）',
  gateInstall !== '' && gateInstall === gateUninstall, '两边不一致');
check('非法字符闸门不改写用户给的路径 —— 不静默修复（W2）',
  gateInstall !== '' && !/Replace\(|-replace|\.Trim/.test(gateInstall), '疑似静默修复');
check('F1 的尾随空白判定仍在两个脚本里 —— 不许被顶替（W2）',
  install.includes('Assert-NoTrailingWhitespace') && uninstall.includes('Assert-NoTrailingWhitespace'), 'missing');
check('README 写明尾随反斜杠的正确写法（W2）',
  readme.includes('尾随反斜杠') && readme.includes('两个反斜杠') && readme.includes('去掉末尾反斜杠'), 'missing');

// ── W3：run-all 自身条数自推导 ─────────────────────────────────
const runAllW3 = fs.readFileSync(path.join(SELFTEST_DIR, 'run-all.ps1'), 'utf8');
check('run-all.ps1 的自身条数不再写死常量（W3）',
  !/\$selfDeclared\s*=\s*\d+/.test(runAllW3), '还在写死');
check('run-all.ps1 的自身条数从自己头部读（W3）',
  runAllW3.includes("'ASSERTION-COUNT:\\s*(\\d+)'"), 'missing');
check('run-all.ps1 有结构性期望交叉核对（子套件数 + 2）（W3）',
  runAllW3.includes('$selfStructural') && runAllW3.includes('$suites.Count + 2'), 'missing');

// ── X1：撞名导致「断言报红但退出码说通过」────────────────────
//   修之前 run-all.ps1 里 `$failed`（套件退出码计数）与 `$script:failed`（断言红计数）
//   在脚本作用域是同一个变量 ⇒ `$failed = 0` 把自检的红计数清零 ⇒ 断言报红、退出码却是 0、横幅还说「全部通过」。
//   这里既查**代码**（去掉注释行，免得被注释里的字样带偏），也查**行为**（新套件真跑一遍）。
const runAllCode = runAllSrc.split(/\r?\n/).filter(l => !l.trim().startsWith('#')).join('\n');
const runAllBannerLines = runAllCode.split(/\r?\n/).filter(l => l.includes('==== 自测：'));
const x1RedBanner = runAllBannerLines.find(l => l.includes('未通过')) || '';
const x1GreenBanner = runAllBannerLines.find(l => l.includes('全部通过')) || '';
const x1File = path.join(SELFTEST_DIR, 'run-all-exit-code-test.mjs');
const x1Src = fs.existsSync(x1File) ? fs.readFileSync(x1File, 'utf8') : '';
check('run-all.ps1 的代码里不再有裸 $failed / $script:failed / $script:pass（X1：撞名已消除）',
  !/\$failed\b/.test(runAllCode) && !/\$script:failed\b/.test(runAllCode) && !/\$script:pass\b/.test(runAllCode),
  'code lines still contain an old name');
check('run-all.ps1 的套件失败计数与断言红计数是两个不同的名字（X1）',
  runAllCode.includes('$suiteFailed') && runAllCode.includes('$script:assertFail'), 'missing');
const x1Assigns = (runAllCode.match(/\$script:assertFail\s*=/g) || []).length;
check('run-all.ps1 里 $script:assertFail 只被赋值 2 次（初始化 + Check 自增）—— 再加一次重置就被这条抓住（X1）',
  x1Assigns === 2, 'assignments=' + x1Assigns);
check('run-all.ps1 的退出判定同时看套件退出码与断言红计数（X1）',
  /\$suiteFailed\s*-gt\s*0\s*-or\s*\$script:assertFail\s*-gt\s*0/.test(runAllCode), 'missing');
check('run-all.ps1 的红分支横幅不含「全部通过」（X1）',
  x1RedBanner !== '' && !x1RedBanner.includes('全部通过'), 'red=' + x1RedBanner);
check('run-all.ps1 的绿分支横幅含「全部通过」（X1）',
  x1GreenBanner !== '' && x1GreenBanner.includes('全部通过'), 'green=' + x1GreenBanner);
check('存在行为级的永久断言套件 run-all-exit-code-test.mjs（X1）',
  x1Src !== '' && x1Src.includes('reintroduceCollision'), 'missing');
check('该永久断言含「撞名改回去」的变异对照 —— 能证伪（X1）',
  x1Src.includes('$failed = 0') && x1Src.includes('撞名'), 'missing');

// ── 自测目录自身的存在性与命名 ────────────────────────────────────
check('自测套件目录存在', fs.existsSync(path.join(ROOT, 'tools', 'install-selftest')), 'missing');
check('run-all.ps1 存在', fs.existsSync(path.join(ROOT, 'tools', 'install-selftest', 'run-all.ps1')), 'missing');
check('README 目录结构列出了自测目录', readme.includes('install-selftest'), 'missing');
check('README 写了怎么复跑自测', /run-all\.ps1/.test(readme), 'missing');

console.log('');
console.log('==== 文档与实现对账：PASS ' + pass + ' / FAIL ' + fail + ' ====');
process.exit(fail > 0 ? 1 : 0);
