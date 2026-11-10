// 作用域验证（v0.5.0）
// 核心断言：约束只落在「被派工的子代理」身上，Router 永远不被约束。
//
// v0.4.0 的语义变化（实测驱动）：
//   · 派工发生在父会话，工具执行发生在子会话
//   · worker 的 scope 来自它自己 transcript 里的派工原文（权威来源）
//   · 父会话的工具调用载荷没有 agent_type -> 直接放行
//
// v0.5.0 新增锁住契约 S2 的条目形态与读写口径：
//   · ro: 只读条目：只授读、不授写、不参与写冲突
//   · 可写条目与只读条目混用
//   · 文件条目的所在目录树可读（S2.1）
//   · 目录条目：读它本身放行、写它本身拒绝（授权只覆盖其「之下」）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-scope-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, 'src', 'app'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'app', 'login.ts'), 'x', 'utf8');

// 账号成员夹具（D-37）。
// 账号成员是**跨项目的账号级事实**：夹具不自带账号环境，派工侧就判定
// 「账号名单不可用」而**不判存在性**（那就等于没有账号事实可判）。
// 所以夹具必须自带完整环境：这里造一份账号成员目录并显式传进去。
const ACCOUNT = path.join(tmp, 'account');
fs.mkdirSync(path.join(ACCOUNT, 'worker'), { recursive: true });
fs.mkdirSync(path.join(ACCOUNT, 'sa-real-member'), { recursive: true });

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function run(script, payload, env) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: PROJ, SAR_ACCOUNT_AGENTS_DIR: ACCOUNT, ...(env || {}) }
  });
  return (r.stdout || '').trim();
}

// 造一份子会话 transcript：第一条 user 消息里带父会话、成员名与 SCOPE
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

const PARENT = 'router-s1';
const WORKER = 'worker-s1';
const SCOPE = 'src/app/login.ts';

run('dispatch.mjs', {
  hook_event_name: 'PreToolUse', tool_name: 'task', session_id: PARENT, turn_id: 't1',
  tool_input: { agent_name: 'worker', prompt: 'SCOPE: ' + SCOPE }
});
const TR = makeTranscript(WORKER, PARENT, 'worker', SCOPE);

function workerGuard(tool, payload, session, tr) {
  return run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: session || WORKER,
    agent_id: session || WORKER, agent_type: 'worker', transcript_path: tr || TR,
    tool_input: payload
  });
}

// 1. Router 父会话：刚派过工，但自己读写任何路径都不受约束
{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: PARENT, tool_input: { file_path: 'C:/anywhere/x.ts' } });
  ok('Router 父会话写文件不被拦', o === '', o.slice(0, 90));
}
{
  const o = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'read', session_id: PARENT, tool_input: { path: 'C:/anywhere/x.ts' } });
  ok('Router 父会话读文件不被拦', o === '', o.slice(0, 90));
}

// 2. worker：写 scope 内 -> 放行
{
  const o = workerGuard('write', { file_path: 'src/app/login.ts' });
  ok('worker 写 scope 内放行', o === '', o.slice(0, 90));
}
// 3. worker：写 scope 外 -> deny
{
  const o = workerGuard('write', { file_path: 'config/prod.yaml' });
  ok('worker 写 scope 外被拦', o.includes('deny'), o.slice(0, 90));
}
// 4. worker：读同目录邻近文件 -> 放行（读宽松）
{
  const o = workerGuard('read', { path: 'src/app/session.ts' });
  ok('worker 读同目录邻近文件放行', o === '', o.slice(0, 90));
}
// 5. worker：读无关目录 -> deny
{
  const o = workerGuard('read', { path: 'config/prod.yaml' });
  ok('worker 读无关目录被拦', o.includes('deny'), o.slice(0, 90));
}
// 6. worker：绝对路径写 scope 内 -> 放行（路径归一化）
{
  const abs = path.join(PROJ, 'src', 'app', 'login.ts');
  const o = workerGuard('write', { file_path: abs });
  ok('worker 绝对路径写 scope 内放行', o === '', o.slice(0, 90));
}
// 7. worker：bash 命令里藏 scope 外路径 -> deny
{
  const o = workerGuard('bash', { command: 'node config/prod.yaml' });
  ok('worker bash 越界路径被拦', o.includes('deny'), o.slice(0, 90));
}
// 8. worker：bash 命令里只有 scope 内路径 -> 放行
{
  const o = workerGuard('bash', { command: 'node src/app/login.ts' });
  ok('worker bash scope 内路径放行', o === '', o.slice(0, 90));
}

// 9. S2.1：文件条目所在目录树可读
{
  const o = workerGuard('read', { path: 'src/app/sub/deep.ts' });
  ok('条目所在目录树可读', o === '', o.slice(0, 90));
}

// 10. ro: 只读条目 —— 只授读、不授写
{
  const W = 'worker-ro';
  const T = makeTranscript(W, 'router-ro', 'worker', 'ro: src/app/');
  const readOut = workerGuard('read', { path: 'src/app/other.ts' }, W, T);
  const writeOut = workerGuard('write', { file_path: 'src/app/other.ts' }, W, T);
  ok('ro: 条目授予读', readOut === '', readOut.slice(0, 120));
  ok('ro: 条目不授予写', writeOut.includes('deny'), writeOut.slice(0, 120));
}

// 11. S2.5：可写条目与只读条目混用
{
  const W = 'worker-mix';
  const T = makeTranscript(W, 'router-mix', 'worker', 'ro: src/app/, src/app/login.ts');
  const roRead = workerGuard('read', { path: 'src/app/other.ts' }, W, T);
  const rwWrite = workerGuard('write', { file_path: 'src/app/login.ts' }, W, T);
  const roWrite = workerGuard('write', { file_path: 'src/app/other.ts' }, W, T);
  ok('混用形态：只读部分授读', roRead === '', roRead.slice(0, 120));
  ok('混用形态：可写部分授写', rwWrite === '', rwWrite.slice(0, 120));
  ok('混用形态：只读部分不授写', roWrite.includes('deny'), roWrite.slice(0, 120));
}

// 12. 目录条目：读它本身放行、写它本身拒绝
{
  const W = 'worker-dir';
  const T = makeTranscript(W, 'router-dir', 'worker', 'src/app/');
  const readDir = workerGuard('read', { path: 'src/app' }, W, T);
  const writeDir = workerGuard('write', { file_path: 'src/app' }, W, T);
  const writeUnder = workerGuard('write', { file_path: 'src/app/login.ts' }, W, T);
  ok('读目录条目本身放行', readDir === '', readDir.slice(0, 120));
  ok('写目录条目本身拒绝', writeDir.includes('deny'), writeDir.slice(0, 120));
  ok('写目录条目之下放行', writeUnder === '', writeUnder.slice(0, 120));
}

// 13. S3：glob / grep 的判定对象是有效检索根
{
  const inRoot = workerGuard('glob', { pattern: '**/*.ts', path: 'src/app' });
  const outRoot = workerGuard('glob', { pattern: '**/*.ts', path: 'config' });
  const noPath = workerGuard('grep', { pattern: 'login' });
  ok('glob 检索根在读放行目录树内放行', inRoot === '', inRoot.slice(0, 120));
  ok('glob 检索根在范围外被拦', outRoot.includes('deny'), outRoot.slice(0, 120));
  ok('grep 无 path 时按工作区根判定并被拦', noPath.includes('deny'), noPath.slice(0, 120));
}


// ── F-04：含空格的路径不再被静默截断 ────────────────────────
//
// 缺陷（独立验收 v055 F-04）：extractScopeDetail 按**空格**切 SCOPE 行，
// 绝对路径里带空格时被切成两段（后半段被当成另一个条目丢掉），
// 该白名单条目**静默不生效** —— 目标被判成越界。
// 本仓库自己的路径就含空格（...\mini code的插件\），所以这不是理论问题。
//
// 修法：切分尊重路径里的空格 —— 先按逗号切；片段若被引号包住或以盘符开头，
// 就**整体**算一个条目；否则才按空格切（口径写进契约 S2 第 7 条）。
//
// 四条断言：
//   ① 含空格的绝对路径条目解析为一个完整条目（不截断）
//   ② 该路径读写都按预期放行（白名单**真生效**，不是只验「解析出一个条目」）
//   ③ 现有不带空格的写法不受影响
//   ④ 既有口径不受影响（ro: 只读前缀 / 中文自然语言片段被丢弃）
{
  const SPACE_PROJ = path.join(tmp, 'my proj');       // 工作区路径带空格
  fs.mkdirSync(path.join(SPACE_PROJ, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(SPACE_PROJ, 'src', 'app', 'login.ts'), 'x', 'utf8');
  const ABS = path.join(SPACE_PROJ, 'src', 'app', 'login.ts');

  const lib = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs')).href);

  // ① 解析成一个完整条目（不截断）
  const detail = lib.extractScopeDetail('SCOPE: ' + ABS);
  ok('F-04 含空格的绝对路径解析为一个完整条目',
    detail.entries.length === 1 && detail.entries[0] === ABS, JSON.stringify(detail.entries));

  // ② 白名单真生效：读写都放行（绝对路径与相对路径两种写法）
  const W = 'worker-space';
  const T = makeTranscript(W, 'router-space', 'worker', ABS);
  const envSpace = { MINIMAX_PROJECT_DIR: SPACE_PROJ };
  const readAbs = run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: W,
    agent_id: W, agent_type: 'worker', transcript_path: T,
    tool_input: { path: ABS }
  }, envSpace);
  ok('F-04 含空格路径读放行（白名单真生效）', readAbs === '', readAbs.slice(0, 140));
  const writeAbs = run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: W,
    agent_id: W, agent_type: 'worker', transcript_path: T,
    tool_input: { file_path: ABS }
  }, envSpace);
  ok('F-04 含空格路径写放行（白名单真生效）', writeAbs === '', writeAbs.slice(0, 140));
  const readRel = run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: W,
    agent_id: W, agent_type: 'worker', transcript_path: T,
    tool_input: { path: 'src/app/login.ts' }
  }, envSpace);
  ok('F-04 含空格白名单对相对路径同样生效', readRel === '', readRel.slice(0, 140));

  // ③ 不带空格的写法不受影响
  const plain = lib.extractScopeDetail('SCOPE: src/app/login.ts');
  ok('F-04 不带空格的写法不受影响',
    plain.entries.length === 1 && plain.entries[0] === 'src/app/login.ts',
    JSON.stringify(plain.entries));

  // ④ 既有口径不受影响：ro: 只读前缀 / 中文自然语言片段
  const ro = lib.extractScopeDetail('SCOPE: ro: src/app/, src/app/login.ts');
  ok('F-04 ro: 只读前缀仍然生效',
    ro.entries.length === 2 && ro.entries[0] === 'ro: src/app/' && ro.entries[1] === 'src/app/login.ts',
    JSON.stringify(ro.entries));
  const cjk = lib.extractScopeDetail('SCOPE: 请修改 src/app/login.ts 这个文件');
  ok('F-04 中文自然语言片段仍被丢弃（不混进白名单）',
    cjk.entries.length === 1 && cjk.entries[0] === 'src/app/login.ts',
    JSON.stringify(cjk.entries));
  const quoted = lib.extractScopeDetail('SCOPE: "' + ABS + '"');
  ok('F-04 双引号包裹的含空格路径同样是一个完整条目',
    quoted.entries.length === 1 && quoted.entries[0] === ABS, JSON.stringify(quoted.entries));
}

// ── D-37：派工必须校验目标成员存在于账号 ─────────────────────
//
// 缺陷：派工到「账号里不存在的成员」不会启动子会话，台账却照样写一条 active ——
// ① 占掉一个并发名额与一个累计名额；
// ② 同 SCOPE 的后续派工被「组队冲突」误拦；
// ③ 教训与履历照常注入，外观完全正常 ⇒ 静默失效。
{
  const ledgerPath = path.join(DATA, 'dispatches.json');
  const countDispatches = () => {
    try { return JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).dispatches.length; }
    catch { return 0; }
  };
  const before = countDispatches();
  const bad = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'router-d37', turn_id: 't-d37',
    tool_input: { agent_name: 'sa-ghost-member', prompt: 'SCOPE: src/app/d37-target.ts' }
  });
  ok('D-37 派工到账号里不存在的成员被拒', bad.includes('deny') && bad.includes('在账号里不存在'), bad.slice(0, 200));
  ok('D-37 被拒的派工不新增任何台账记录', countDispatches() === before, 'before=' + before + ' after=' + countDispatches());
  // 派工到账号里真实存在的成员：不受影响（这条断言锁住「不要把闸门写成一律拒派」）
  const good = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'router-d37b', turn_id: 't-d37b',
    tool_input: { agent_name: 'sa-real-member', prompt: 'SCOPE: src/app/d37-target.ts' }
  });
  ok('D-37 派工到账号里真实存在的成员不受影响', !good.includes('deny'), good.slice(0, 200));
  ok('D-37 正常派工仍然写台账', countDispatches() === before + 1, 'before=' + before + ' after=' + countDispatches());
}

// ── D-82：带尾随空格的目录不得被当成插件专属数据目录 ───────
//
// 缺陷：Windows 上「super-agent-router」与「super-agent-router 」（末尾多一个空格）
// 是**两个不同的目录**，可以同时存在。旧判定先 trim 整个路径再取 basename，
// 于是后者被误判成前者 ⇒ 运行时若 PLUGIN_DATA 指向那个空目录，
// readLedger() 读到**空台账**（格式合法、看着正常）⇒
// 「记录丢了 ⇒ 视同没有在飞派工」⇒ 冲突检测与名额检测**全盲**（D-10 那一族的静默失效）。
{
  // 这个块在文件作用域外，拿不到上面块里的 lib —— 自己导入一份。
  //
  // ⚠️ 必须导**仓库副本**，不是 PLUGIN_ROOT（安装副本）：这条断言验的是
  // 本仓库这一版实现，安装副本可能还是旧版（未部署）⇒ 断言会因
  // 「函数不存在/行为是旧的」而红，看起来像代码坏了，其实是部署时差。
  const REPO_LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'scripts', 'lib.mjs');
  const libD82 = await import(pathToFileURL(REPO_LIB).href);
  const HOOKS = 'C:/x/plugin-data/hooks/';
  ok('D-82 正常的插件数据目录被认出来',
    libD82.isPluginOwnDataDir(HOOKS + 'super-agent-router') === true);
  ok('D-82 带尾随空格的目录**不**被认成插件数据目录',
    libD82.isPluginOwnDataDir(HOOKS + 'super-agent-router ') === false);
  ok('D-82 尾部分隔符不算目录名的一部分',
    libD82.isPluginOwnDataDir(HOOKS + 'super-agent-router/') === true);
  ok('D-82 别的插件目录不被认成本插件的',
    libD82.isPluginOwnDataDir(HOOKS + 'superpowers') === false);
  ok('D-82 空路径不认',
    libD82.isPluginOwnDataDir('') === false && libD82.isPluginOwnDataDir('   ') === false);
}

console.log(fail === 0 ? '>>> SCOPE ALL PASS' : '>>> SCOPE FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
