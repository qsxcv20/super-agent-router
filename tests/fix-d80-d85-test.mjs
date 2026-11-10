// D-80 / D-85 专属回归（编排机制边界判定）
//
// 用法：
//   node tests\fix-d80-d85-test.mjs
//   $env:SAR_MUTATION_D80D85='1'; node tests\fix-d80-d85-test.mjs   （变异自检，默认关）
//
// 覆盖两条缺陷，每条都有**专属断言**（改前红、改后绿，且能指认命中的是哪条规则）：
//
//   D-80（台账第 1319 行）：家目录展开下沉到 lib.mjs 的 absolutizePath()。
//     改前：absolutizePath() 只认盘符与 '/' 开头，其余一律拼到工作区根下 ——
//           `~/x` 被拼成 `<工作区根>/~/x`，**真实存在的文件被判成「不存在」**。
//     改后：展开发生在「拼工作区根」**之前**；expandHomePath(p, home) 的签名与语义不变。
//
//   D-85（台账第 1281 行）：空设备（/dev/null、NUL、/dev/stdout、$null …）不是写目标。
//     改前：extractWriteTargets() 把 '/dev/null' 当成写目标 ⇒ 护栏判它越界 ⇒
//           台账里多一条**用不上的越界请求**（噪声，且会把真正的越界请求淹掉），
//           拦截文案还给出**无意义的批准命令**（批准它也不会让任何东西生效）。
//     改后：空设备不参与作用域判定、也不触发「写操作但识别不出目标」的兜底拒绝；
//           真实路径越界照常记账并拦。
//
// 断言锚在**仓库副本**上（SAR_D80D85_PLUGIN_ROOT 可覆盖）：本单改的是仓库副本，
// 安装副本由父会话发版时同步 —— 跟着安装副本走，同步前会看到**假红**。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = path.resolve(process.env.SAR_D80D85_PLUGIN_ROOT || path.join(REPO, 'plugin'));

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

// 变异矩阵入口放在**最前面**（与 tests/e2e-test.mjs / tests/scope-amend-test.mjs 的约定一致）：
// 打开时只跑矩阵并退出 —— 矩阵跑的是「被重跑的套件」的输出，
// 本进程自己的正常断言不该混进同一份输出里（第三方会分不清哪条红是变异造成的）。
if (process.env.SAR_MUTATION_D80D85 === '1') {
  await runMutationMatrix();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-d80d85-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, 'src', 'app'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'config'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'app', 'login.ts'), 'x', 'utf8');
fs.writeFileSync(path.join(PROJ, 'config', 'prod.yaml'), 'x', 'utf8');

const lib = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs')).href);

const W = 'worker-d80d85';
const TR = makeTranscript(W, 'router-d80d85', 'worker', 'src/app/login.ts');

function makeTranscript(session, parent, agent, scope) {
  const text = [
    '<agent-context>',
    '  agentName: ' + agent,
    '  PARENT SESSION: ' + parent,
    '</agent-context>',
    '任务：按 brief 执行',
    'SCOPE: ' + scope
  ].join('\n');
  const p = path.join(tmp, 'tr-' + session + '.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    uuid: 'p-0', parentUuid: null, sessionId: session,
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] }
  }) + '\n', 'utf8');
  return p;
}

// 驱动真实的 guard 脚本（合成 PreToolUse 载荷）——
// 判定逻辑与真实链路分开验：这里验的是**机制对不对**。
function guard(payload, env) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000,
    env: Object.assign({}, process.env, {
      PLUGIN_ROOT, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA
    }, env || {})
  });
  return String(r.stdout || '').trim();
}

function w(command) {
  return guard({
    hook_event_name: 'PreToolUse', tool_name: 'bash', session_id: W,
    agent_id: W, agent_type: 'worker', transcript_path: TR,
    tool_input: { command }
  });
}

function ledger() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  } catch (e) {
    return { scope_requests: [] };
  }
}

function pendingRequests() {
  const l = ledger();
  return (l.scope_requests || []).filter((r) => r.state === 'pending');
}

// 「这个待审目标是不是空设备」——**不复用被测的 lib 函数**（否则识别函数坏了断言会跟着假绿）。
function looksLikeNullDevice(t) {
  const s = String(t || '');
  if (/\/dev\/(null|stdout|stderr|stdin|zero)\b/i.test(s)) return true;
  if (/(^|[^A-Za-z0-9_])nul(:)?$/i.test(s)) return true;
  if (s.trim() === '$null') return true;
  return false;
}

function nullDeviceTargets() {
  const out = [];
  for (const r of pendingRequests()) {
    for (const t of (r.targets || [])) {
      if (looksLikeNullDevice(t)) out.push(String(t));
    }
  }
  return out;
}

// ── D-80：家目录展开下沉到 absolutizePath() ──────────────────────────
//
// 断言锚在**展开结果本身**上，而不是「某条命令被不被拦」——
// 命中别的分支也可能让「被拦」成立，只有展开结果对，才说明这一环真的生效。
{
  const homeDir = fs.mkdtempSync(path.join(os.homedir(), 'sar-d80-'));
  try {
    fs.writeFileSync(path.join(homeDir, 'probe.txt'), 'home-ok', 'utf8');
    const base = path.basename(homeDir);
    const homeNorm = String(os.homedir() || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const expected = homeNorm + '/' + base + '/probe.txt';
    const forms = [
      ['~', '~/' + base + '/probe.txt'],
      ['$HOME', '$HOME/' + base + '/probe.txt'],
      ['%USERPROFILE%', '%USERPROFILE%/' + base + '/probe.txt'],
      ['$env:USERPROFILE', '$env:USERPROFILE/' + base + '/probe.txt']
    ];
    for (const [label, p] of forms) {
      const got = lib.absolutizePath(p, PROJ);
      ok('D-80 家目录写法（' + label + '）在 absolutizePath 内部展开到真实家目录',
        got === expected, 'got=' + got + ' want=' + expected);
      ok('D-80 家目录写法（' + label + '）展开后真实存在的文件判为存在',
        fs.existsSync(got) === true, 'abs=' + got);
    }
    // 家目录下的路径是**工作区外**的真实路径：不能被折进工作区根（否则等于把工作区外的文件
    // 判成工作区内的资产）。
    const absHome = lib.absolutizePath('~/' + base + '/probe.txt', PROJ);
    const projNorm = String(PROJ).replace(/\\/g, '/');
    ok('D-80 家目录下的路径不被折进工作区根（仍是工作区外路径）',
      absHome !== projNorm && absHome.indexOf(projNorm + '/') !== 0,
      'abs=' + absHome + ' proj=' + projNorm);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}
{
  // 盘符 / 绝对路径 / 相对路径三条既有口径**不许被这次改动带偏**。
  ok('D-80 盘符绝对路径行为未变（仍按绝对路径直用）',
    lib.absolutizePath('C:/x/y', PROJ) === 'C:/x/y', lib.absolutizePath('C:/x/y', PROJ));
  ok('D-80 以 / 开头的绝对路径行为未变',
    lib.absolutizePath('/x/y', PROJ) === '/x/y', lib.absolutizePath('/x/y', PROJ));
  ok('D-80 相对路径仍拼到工作区根',
    lib.absolutizePath('src/app.ts', PROJ) === String(PROJ).replace(/\\/g, '/') + '/src/app.ts',
    lib.absolutizePath('src/app.ts', PROJ));
}
{
  // expandHomePath 是**对外导出的纯函数**：这次不许改它的签名与语义
  //（watchdog 侧仍在用它判存在性）。
  ok('D-80 expandHomePath 的参数个数未变（签名未改）',
    lib.expandHomePath.length === 2, 'arity=' + lib.expandHomePath.length);
  const cases = [
    ['~/a', 'H', 'H/a'],
    ['~', 'H', 'H'],
    ['$HOME/a', 'H', 'H/a'],
    ['%USERPROFILE%/a', 'H', 'H/a'],
    ['$env:USERPROFILE/a', 'H', 'H/a'],
    ['plain', 'H', 'plain'],
    ['~/a', '', '~/a'],
    ['', 'H', ''],
    ['~/a', 'C:\\Users\\x', 'C:/Users/x/a']
  ];
  for (const c of cases) {
    const got = lib.expandHomePath(c[0], c[1]);
    ok('D-80 expandHomePath 语义未变：' + JSON.stringify(c[0]) + ' @ ' + JSON.stringify(c[1]),
      got === c[2], 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(c[2]));
  }
}

// ── F-1（独立验收条件）：家目录取不到时**不得造路径** ────────────────────
//
// 要求：os.homedir() 抛错或返回空时，行为必须退回「不展开」——
// 产出路径里**不得**出现凭空造出来的家目录，且那个「展开失败」的路径在磁盘上必须不存在。
//
// 为什么在**子进程**里做：lib.mjs 的 homeDir() 在**调用时**才取家目录，
// 在本进程里换掉 os.homedir 也能生效 —— 但那样会把后面 D-80 组断言的家目录一起污染，
// 矩阵的「恰好转红」就没法自证了。子进程是隔离的：两种失败形态各跑一次，跑完即退。
{
  const probeFile = path.join(tmp, 'probe-nohome.mjs');
  fs.writeFileSync(probeFile, [
    "import os from 'node:os';",
    "import fs from 'node:fs';",
    "import { pathToFileURL } from 'node:url';",
    "const libPath = process.argv[2];",
    "const root = process.argv[3];",
    "const mode = process.argv[4];",
    "if (mode === 'throw') { os.homedir = () => { throw new Error('simulated homedir failure'); }; }",
    "else { os.homedir = () => ''; }",
    "const lib = await import(pathToFileURL(libPath).href);",
    "const out = lib.absolutizePath(process.argv[5], root);",
    "console.log(JSON.stringify({ mode: mode, out: out, exists: fs.existsSync(out) }));"
  ].join('\n'), 'utf8');
  const projNorm = String(PROJ).replace(/\\/g, '/');
  // 探针路径刻意取一个**在真实家目录下确实存在**的相对路径：
  //   · 正确行为（不展开）⇒ 产出 '<工作区根>/~/<base>/probe.txt' ⇒ 磁盘上不存在；
  //   · 若机制改用「另一个真实家目录来源」兜底（os.userInfo().homedir）⇒
  //     产出 '<真实家目录>/<base>/probe.txt' ⇒ **它真的存在**。
  // 这样两条 F-1 断言都不是恒绿：主判据（不造路径）与副判据（不存在）都有变异体能转红。
  const homeProbe = fs.mkdtempSync(path.join(os.homedir(), 'sar-d80d85-f1-'));
  try {
    fs.writeFileSync(path.join(homeProbe, 'probe.txt'), 'home-ok', 'utf8');
    const base = path.basename(homeProbe);
    const relProbe = '~/' + base + '/probe.txt';
    const expectOut = projNorm + '/' + relProbe;
    for (const pair of [['throw', 'os.homedir 抛错'], ['empty', 'os.homedir 返回空']]) {
      const mode = pair[0];
      const label = pair[1];
      const r = spawnSync(process.execPath,
        [probeFile, path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs'), PROJ, mode, relProbe],
        { encoding: 'utf8', timeout: 60000 });
      let got = null;
      const lastLine = String(r.stdout || '').split(/\r?\n/).filter(Boolean).pop() || '';
      try { got = JSON.parse(lastLine); } catch (e) { got = null; }
      ok('F-1 家目录取不到时（' + label + '）不造路径：退回「不展开」',
        got !== null && got.out === expectOut,
        'got=' + (got && got.out) + ' want=' + expectOut +
        ' stderr=' + String(r.stderr || '').slice(0, 140));
      ok('F-1 家目录取不到时（' + label + '）产出的路径在磁盘上不存在',
        got !== null && got.exists === false,
        'out=' + (got && got.out) + ' exists=' + (got && got.exists));
    }
  } finally {
    fs.rmSync(homeProbe, { recursive: true, force: true });
  }
}

// ── D-85：空设备不是写目标 ─────────────────────────────────────────
{
  // 纯函数层：空设备不进写目标集合，真实写目标照旧在。
  ok('D-85 空设备不是写目标：extractWriteTargets 不含 /dev/null',
    JSON.stringify(lib.extractWriteTargets('echo hi > /dev/null')) === '[]',
    JSON.stringify(lib.extractWriteTargets('echo hi > /dev/null')));
  ok('D-85 空设备不是写目标：Windows NUL 同等处理',
    JSON.stringify(lib.extractWriteTargets('echo hi > NUL')) === '[]',
    JSON.stringify(lib.extractWriteTargets('echo hi > NUL')));
  ok('D-85 空设备不是写目标：贴写形态（2>/dev/null）同样不算',
    JSON.stringify(lib.extractWriteTargets('rm out.txt 2>/dev/null')) === '["out.txt"]',
    JSON.stringify(lib.extractWriteTargets('rm out.txt 2>/dev/null')));
  ok('D-85 空设备识别覆盖 POSIX / Windows / PowerShell 形态',
    lib.isNullDevicePath('/dev/null') === true &&
    lib.isNullDevicePath('/dev/stdout') === true &&
    lib.isNullDevicePath('NUL') === true &&
    lib.isNullDevicePath('nul') === true &&
    lib.isNullDevicePath('$null') === true,
    'null=' + lib.isNullDevicePath('/dev/null') + ' nul=' + lib.isNullDevicePath('NUL'));
  ok('D-85 空设备识别不放宽真实路径（null / src/null / /dev/nullx / /dev/urandom / /dev/random 都不是空设备）',
    lib.isNullDevicePath('null') === false &&
    lib.isNullDevicePath('src/null') === false &&
    lib.isNullDevicePath('/dev/nullx') === false &&
    lib.isNullDevicePath('/dev/urandom') === false &&
    lib.isNullDevicePath('/dev/random') === false &&
    lib.isNullDevicePath('config/prod.yaml') === false,
    'null=' + lib.isNullDevicePath('null') + ' srcnull=' + lib.isNullDevicePath('src/null') +
    ' urandom=' + lib.isNullDevicePath('/dev/urandom') + ' random=' + lib.isNullDevicePath('/dev/random'));
}

// ── F-2（独立验收条件）：/dev/urandom 与 /dev/random 是**真实设备**，不是丢弃口 ──
//
// 为什么单列一组断言：交付报告里把这两个形态列成了「刻意不收」——
// **报告里承诺了，套件里就得钉住**，否则下次有人「顺手放宽」时没有任何东西会红。
// 判据是「仍然被当成写目标」：真实设备在白名单外 ⇒ 护栏照常判越界并照常记账。
{
  ok('F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备',
    lib.isNullDevicePath('/dev/urandom') === false &&
    lib.isNullDevicePath('/dev/random') === false,
    'urandom=' + lib.isNullDevicePath('/dev/urandom') + ' random=' + lib.isNullDevicePath('/dev/random'));
  ok('F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标',
    JSON.stringify(lib.extractWriteTargets('echo hi > /dev/urandom')) === '["/dev/urandom"]' &&
    JSON.stringify(lib.extractWriteTargets('echo hi > /dev/random')) === '["/dev/random"]',
    'urandom=' + JSON.stringify(lib.extractWriteTargets('echo hi > /dev/urandom')) +
    ' random=' + JSON.stringify(lib.extractWriteTargets('echo hi > /dev/random')));
}
{
  // 护栏层：重定向到空设备不再产生越界请求，也不再给出无意义的批准命令。
  const before = pendingRequests().length;
  const o = w('echo hi > /dev/null');
  ok('D-85 重定向到空设备不被拦（空设备不是写目标）', o === '', o.slice(0, 200));
  ok('D-85 重定向到空设备不产生越界请求（台账不记噪声）',
    pendingRequests().length === before && nullDeviceTargets().length === 0,
    'pending=' + pendingRequests().length + ' nullTargets=' + JSON.stringify(nullDeviceTargets()));
  ok('D-85 重定向到空设备不给出无意义的批准命令',
    o.indexOf('--grant') < 0 && o.indexOf('批准命令') < 0, o.slice(0, 200));
}
{
  const o = w('echo hi > NUL');
  ok('D-85 Windows 空设备（NUL）不被拦', o === '', o.slice(0, 200));
  ok('D-85 Windows 空设备（NUL）不产生越界请求',
    nullDeviceTargets().length === 0, JSON.stringify(nullDeviceTargets()));
}
{
  const o = w('node -e "console.log(1)" 2>/dev/null');
  ok('D-85 贴写形态（2>/dev/null）不被拦', o === '', o.slice(0, 200));
  ok('D-85 贴写形态（2>/dev/null）不产生越界请求',
    nullDeviceTargets().length === 0, JSON.stringify(nullDeviceTargets()));
}
{
  const o = w('cat /dev/null');
  ok('D-85 读通道的空设备同样不判越界（设备不是项目资产）', o === '', o.slice(0, 200));
  ok('D-85 读通道的空设备不产生越界请求',
    nullDeviceTargets().length === 0, JSON.stringify(nullDeviceTargets()));
}
{
  // **真实路径照常记账并拦** —— 空设备的排除不许牵连到正常目标。
  const before = pendingRequests().length;
  const o = w('echo hi > out.txt');
  ok('D-85 真实文件的写目标照常被拦', o.indexOf('deny') >= 0, o.slice(0, 200));
  ok('D-85 真实文件的写目标照常记进待审清单',
    pendingRequests().length === before + 1 &&
    pendingRequests().some((r) => (r.targets || []).indexOf('out.txt') >= 0),
    'pending=' + pendingRequests().length);
  ok('D-85 真实文件的写目标给出的是有意义的批准命令',
    o.indexOf('--grant') >= 0, o.slice(0, 300));
}
{
  const o = w('rm -rf config');
  ok('D-85 真实路径的写操作照常被拦（不被空设备排除牵连）',
    o.indexOf('deny') >= 0, o.slice(0, 200));
}
{
  // F-2 的护栏层：真实设备在白名单外 ⇒ 照常判越界、照常记账。
  // （验收方实测的就是这一条：现行代码里 '> /dev/urandom' 仍 DENY。）
  const before = pendingRequests().length;
  const o = w('echo hi > /dev/urandom');
  ok('F-2 真实设备（/dev/urandom）在护栏层仍判越界', o.indexOf('deny') >= 0, o.slice(0, 200));
  ok('F-2 真实设备（/dev/urandom）在护栏层仍记进待审清单',
    pendingRequests().length === before + 1 &&
    pendingRequests().some((r) => (r.targets || []).indexOf('/dev/urandom') >= 0),
    'pending=' + pendingRequests().length);
}
{
  // 兜底拒绝不许被放宽：写动词却识别不出目标时仍然拒绝（解析不出即拒绝）。
  const o = w('rm');
  ok('D-85 写动词但识别不出目标时仍被兜底拒绝（不放宽）',
    o.indexOf('deny') >= 0 && o.indexOf('命令里有写操作') >= 0 && o.indexOf('目标路径') >= 0,
    o.slice(0, 200));
}

// ── 变异自检（可选）：把 D-80 / D-85 的修复定向回退，验证新断言真的会变红 ──
// 用法：$env:SAR_MUTATION_D80D85='1'; node tests\fix-d80-d85-test.mjs
//
// 只改系统临时目录里的副本，仓库工作树零改动；跑完即删。
// 为什么用**独立开关**而不是复用 SAR_MUTATION=1：
//   总矩阵（SAR_MUTATION=1）归 tests/e2e-test.mjs 那一单独占。
//   两边的分档语义混在一起会让「总矩阵跑过了」被误读成「D-80/D-85 的变异体也跑过了」。
async function runMutationMatrix() {
  const SRC_PLUGIN = path.join(REPO, 'plugin');

  const mutReplace = (file, from, to) => {
    const src = fs.readFileSync(file, 'utf8');
    const idx = src.indexOf(from);
    if (idx < 0) throw new Error('变异点未命中：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    if (src.indexOf(from, idx + 1) >= 0) throw new Error('变异点不唯一：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    fs.writeFileSync(file, src.slice(0, idx) + to + src.slice(idx + from.length), 'utf8');
    // 变异后的脚本必须仍能解析：脚本起不来时，护栏会「什么都不拦」——
    // 那会让不该红的断言变红，矩阵就会把一个坏变异体误读成有效变异。
    const chk = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 60000 });
    if (chk.status !== 0) {
      throw new Error('变异后脚本无法解析（语法错误）：' + path.basename(file) +
        ' :: ' + String(chk.stderr || '').slice(0, 200));
    }
  };

  const MUTANTS = [
    {
      // M1：把家目录展开从 absolutizePath() 里摘掉 —— 回到「拼工作区根之前不展开」的旧语义。
      id: 'M-D80', defect: 'D-80',
      what: '回退「家目录展开下沉」：absolutizePath 内部不再展开家目录',
      expect: [
        // 完整红集合（不是代表项）—— 矩阵按「恰好转红」比对：
        // 少红一条 = 变异体没生效；多红一条 = 误伤了别的断言。
        'D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（~）展开后真实存在的文件判为存在',
        'D-80 家目录写法（$HOME）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（$HOME）展开后真实存在的文件判为存在',
        'D-80 家目录写法（%USERPROFILE%）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（%USERPROFILE%）展开后真实存在的文件判为存在',
        'D-80 家目录写法（$env:USERPROFILE）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（$env:USERPROFILE）展开后真实存在的文件判为存在',
        'D-80 家目录下的路径不被折进工作区根（仍是工作区外路径）'
      ],
      expectGreen: [
        'D-85 重定向到空设备不被拦（空设备不是写目标）',
        'D-85 真实文件的写目标照常被拦',
        'F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」',
        'F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "  const raw = expandHomePath(String(p || '').replace(/\\\\/g, '/').trim(), homeDir());",
          "  const raw = String(p || '').replace(/\\\\/g, '/').trim(); // MUT-D80：家目录展开被摘掉");
      }
    },
    {
      // M2：把「空设备不是写目标」整个摘掉 —— 空设备重新变成被判定的路径，
      // 于是又记一条用不上的越界请求、又被当成越界拦下。
      id: 'M-D85', defect: 'D-85',
      what: '回退「空设备不是写目标」：空设备重新进入判定对象与写目标',
      expect: [
        'D-85 空设备不是写目标：extractWriteTargets 不含 /dev/null',
        'D-85 空设备不是写目标：Windows NUL 同等处理',
        'D-85 空设备不是写目标：贴写形态（2>/dev/null）同样不算',
        'D-85 重定向到空设备不被拦（空设备不是写目标）',
        'D-85 重定向到空设备不产生越界请求（台账不记噪声）',
        'D-85 重定向到空设备不给出无意义的批准命令',
        'D-85 Windows 空设备（NUL）不被拦',
        'D-85 Windows 空设备（NUL）不产生越界请求',
        'D-85 贴写形态（2>/dev/null）不被拦',
        'D-85 贴写形态（2>/dev/null）不产生越界请求',
        'D-85 读通道的空设备同样不判越界（设备不是项目资产）',
        'D-85 读通道的空设备不产生越界请求'
      ],
      expectGreen: [
        'D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录',
        'D-85 真实文件的写目标照常被拦',
        'D-85 写动词但识别不出目标时仍被兜底拒绝（不放宽）',
        'D-85 空设备识别不放宽真实路径（null / src/null / /dev/nullx / /dev/urandom / /dev/random 都不是空设备）',
        'F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」',
        'F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标'
      ],
      apply: (mut) => {
        const libPath = path.join(mut, 'scripts', 'lib.mjs');
        mutReplace(libPath,
          '      if (t && !isNullDeviceToken(a)) out.push(t);',
          '      if (t) out.push(t); // MUT-D85：空设备又被算成写目标');
        mutReplace(libPath,
          '      if (t && !isNullDevicePath(t)) out.push(t);',
          '      if (t) out.push(t); // MUT-D85：空设备又被算成写目标');
        const guardPath = path.join(mut, 'scripts', 'guard.mjs');
        mutReplace(guardPath,
          '    const targets = merged.filter((t) => !isNullDeviceToken(t));',
          '    const targets = merged; // MUT-D85：空设备重新进入判定对象');
        // 兜底那条也回退：空设备重新被算成「写操作」⇒ 「写操作但识别不出目标」又会把
        // `cmd > /dev/null` 拦下来（改前就是拦的，拦的理由是「不在白名单内」）。
        // 变异点落在 lib 的语义上，而不是在 guard 里换函数名 ——
        // 换名字会依赖 guard 的导入表，导入表一变，变异体就会变成「脚本起不来」的假变异。
        mutReplace(libPath,
          '    if (isNullDevicePath(target)) continue;      // 空设备不是写目标',
          '    if (isNullDevicePath(target)) return true;   // MUT-D85：空设备又被算成写操作');
      }
    },
    {
      // F-1：家目录取不到时**造一个假家目录出来** ——
      // 这正是 F-1 明确禁止的行为：产出路径里出现凭空造出来的家目录。
      // 变异点放在**语义层**（homeDir() 的返回值），不依赖导入表。
      // 为什么只改「取不到」这一支：这样它**只**该让 F-1 那组断言转红，
      // D-80 组（家目录取得到时）必须仍绿 —— 矩阵才能自证「恰好转红」。
      id: 'M-F1', defect: 'D-80（F-1）',
      what: '回退「取不到家目录就不展开」：取不到时造一个假家目录出来',
      expect: [
        'F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」',
        'F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」'
      ],
      expectGreen: [
        'F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在',
        'F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在',
        'D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录',
        'D-85 重定向到空设备不被拦（空设备不是写目标）'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "function homeDir() {\n  try { return String(os.homedir() || ''); } catch (e) { return ''; }\n}",
          "function homeDir() {\n  let h = '';\n  try { h = String(os.homedir() || ''); } catch (e) { h = ''; }\n  return h || 'C:/fake/home/dir'; // MUT-F1：取不到家目录时造一个假家目录出来\n}");
      }
    },
    {
      // F-1 的另一个形态（**独立验收方实际用的那个变异**）：homeDir() 恒返回假家目录。
      // 它比 M-F1 更粗 —— 连「家目录取得到」的情形也一起坏掉，所以 D-80 组也会转红
      // （这是正确的：家目录被换掉了，展开结果自然不对）。
      // 单列它，是为了证明验收方那个变异**现在会红**（原先 41/41 全绿）。
      id: 'M-F1b', defect: 'D-80（F-1）',
      what: '回退「取真实家目录」：homeDir() 恒返回假家目录（验收方原变异）',
      expect: [
        'D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（~）展开后真实存在的文件判为存在',
        'D-80 家目录写法（$HOME）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（$HOME）展开后真实存在的文件判为存在',
        'D-80 家目录写法（%USERPROFILE%）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（%USERPROFILE%）展开后真实存在的文件判为存在',
        'D-80 家目录写法（$env:USERPROFILE）在 absolutizePath 内部展开到真实家目录',
        'D-80 家目录写法（$env:USERPROFILE）展开后真实存在的文件判为存在',
        'F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」',
        'F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」'
      ],
      expectGreen: [
        'D-80 家目录下的路径不被折进工作区根（仍是工作区外路径）',
        'D-85 重定向到空设备不被拦（空设备不是写目标）',
        'F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "function homeDir() {\n  try { return String(os.homedir() || ''); } catch (e) { return ''; }\n}",
          "function homeDir() {\n  return 'C:/fake/home/dir'; // MUT-F1b：家目录恒为假家目录（验收方原变异）\n}");
      }
    },
    {
      // F-1 的第三种形态：取不到 os.homedir() 时**改用另一个真实家目录来源**
      // （os.userInfo().homedir）—— 同样属于「造路径」，而且更隐蔽：
      // 产出的路径**真的存在** ⇒ 「不能假装文件存在」那条守卫会红。
      // 变异点仍在语义层（homeDir() 的返回值来源），不依赖导入表。
      id: 'M-F1c', defect: 'D-80（F-1）',
      what: '回退「取不到家目录就不展开」：改用 os.userInfo().homedir 兜底',
      expect: [
        'F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」',
        'F-1 家目录取不到时（os.homedir 抛错）产出的路径在磁盘上不存在',
        'F-1 家目录取不到时（os.homedir 返回空）不造路径：退回「不展开」',
        'F-1 家目录取不到时（os.homedir 返回空）产出的路径在磁盘上不存在'
      ],
      expectGreen: [
        'D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录',
        'D-85 重定向到空设备不被拦（空设备不是写目标）'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "function homeDir() {\n  try { return String(os.homedir() || ''); } catch (e) { return ''; }\n}",
          "function homeDir() {\n  let h = '';\n  try { h = String(os.homedir() || ''); } catch (e) { h = ''; }\n  if (!h) { try { h = String(os.userInfo().homedir || ''); } catch (e) { h = ''; } }\n  return h; // MUT-F1c：取不到时改用另一个真实家目录来源\n}");
      }
    },
    {
      // F-2：把 /dev/urandom 与 /dev/random 也收进空设备集合 ——
      // 这两个是**真实设备**，收了它们就等于把真实写目标放过（静默放行）。
      // 变异点同样在语义层（那张集合表）。
      id: 'M-F2', defect: 'D-85（F-2）',
      what: '回退「真实设备不是空设备」：把 /dev/urandom 与 /dev/random 收进空设备集合',
      expect: [
        'D-85 空设备识别不放宽真实路径（null / src/null / /dev/nullx / /dev/urandom / /dev/random 都不是空设备）',
        'F-2 真实设备（/dev/urandom、/dev/random）不被当成空设备',
        'F-2 真实设备（/dev/urandom、/dev/random）仍被当成写目标',
        'F-2 真实设备（/dev/urandom）在护栏层仍判越界',
        'F-2 真实设备（/dev/urandom）在护栏层仍记进待审清单'
      ],
      expectGreen: [
        'D-85 空设备识别覆盖 POSIX / Windows / PowerShell 形态',
        'D-85 重定向到空设备不被拦（空设备不是写目标）',
        'D-80 家目录写法（~）在 absolutizePath 内部展开到真实家目录',
        'F-1 家目录取不到时（os.homedir 抛错）不造路径：退回「不展开」'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "const NULL_DEVICE_PATHS = new Set([\n  '/dev/null', '/dev/zero', '/dev/stdout', '/dev/stderr', '/dev/stdin'\n]);",
          "const NULL_DEVICE_PATHS = new Set([\n  '/dev/null', '/dev/zero', '/dev/stdout', '/dev/stderr', '/dev/stdin',\n  '/dev/urandom', '/dev/random' // MUT-F2：把真实设备也当成空设备\n]);");
      }
    }
  ];

  const mutRunSuite = (pluginRoot) => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tests', 'fix-d80-d85-test.mjs')], {
      encoding: 'utf8', timeout: 300000, cwd: REPO,
      // 必须清掉所有变异开关残留（否则递归跑自己 / 串别的矩阵档位）。
      env: Object.assign({}, process.env, {
        SAR_D80D85_PLUGIN_ROOT: pluginRoot,
        SAR_PLUGIN_ROOT: pluginRoot,
        SAR_MUTATION: '', SAR_MUTATION_D75: '', SAR_MUTATION_D77: '',
        SAR_MUTATION_D73: '', SAR_MUTATION_D80D85: '',
        SAR_CROSS: '', SAR_PROBE: ''
      })
    });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const lines = out.split(/\r?\n/);
    return {
      red: lines.filter((l) => l.startsWith('FAIL ')),
      green: lines.filter((l) => l.startsWith('PASS ')).length
    };
  };

  console.log('| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言恰好转红 |');
  console.log('|---|---|---|---|---|');
  for (const m of MUTANTS) {
    const mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mut-d80d85-' + m.id.toLowerCase() + '-'));
    const mutPlugin = path.join(mutRoot, 'plugin');
    try {
      fs.cpSync(SRC_PLUGIN, mutPlugin, { recursive: true });
      m.apply(mutPlugin);
      const r = mutRunSuite(mutPlugin);
      // 红集合按**断言标签**比对（FAIL 行 ' :: ' 之前那段）。
      // 为什么不再用「子串包含」：那样只能证明「该红的红了」，
      // 证明不了「没有多红」—— 而多红正是「变异体把不该坏的弄坏了」的那类失败
      //（上一轮 M-D85 第一版就是这么被抓住的：行尾注释吞掉了 ') {'，整个护栏起不来，
      //  于是「什么都不拦」，该绿的那几条反而先红了）。
      const redLabels = r.red.map((l) => l.slice(5).split(' :: ')[0]);
      const missing = m.expect.filter((name) => redLabels.indexOf(name) < 0);
      const extra = redLabels.filter((name) => m.expect.indexOf(name) < 0);
      const wronglyRed = (m.expectGreen || []).filter((name) => redLabels.indexOf(name) >= 0);
      const good = missing.length === 0 && extra.length === 0 && wronglyRed.length === 0 && redLabels.length > 0;
      if (!good) fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | ' + redLabels.length + ' | ' + (good ? 'YES' : 'NO') + ' |');
      for (const l of r.red) console.log('    RED ' + l.slice(0, 160));
      if (missing.length) console.log('    MISS ' + missing.join(' / '));
      if (extra.length) console.log('    EXTRA-RED ' + extra.join(' / '));
      if (wronglyRed.length) console.log('    WRONG-RED ' + wronglyRed.join(' / '));
    } catch (e) {
      fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | 0 | NO（变异体本身失败：' + e.message + '） |');
    } finally {
      fs.rmSync(mutRoot, { recursive: true, force: true });
    }
  }
  console.log(fail === 0 ? '>>> D80D85 MUTATION MATRIX OK' : '>>> D80D85 MUTATION MATRIX FAILURES: ' + fail);
  process.exit(fail === 0 ? 0 : 1);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? '>>> FIX-D80-D85 ALL PASS' : '>>> FIX-D80-D85 FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
