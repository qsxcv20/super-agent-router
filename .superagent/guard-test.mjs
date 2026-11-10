// guard 行为回归（v0.5.0）
// 覆盖：写严格 / 读宽松 / 绝对路径归一 / 危险操作一律拦 / 父会话不受约束
//
// v0.5.0 新增锁住：
//   · codex 变体 transcript 也能解析出 scope（D-01）
//   · bash：目录型目标可识别、带点标识符不当路径、只读/写命令分流（D-02）
//   · 工具名兜底 + 参数维度危险判定（D-03）
//   · 解析不到边界一律 deny（D-04）
//   · 方法论/错题本按精确文件放行（D-14）
//   · 取不到目标路径一律 deny（D-16）
//   · glob/grep 判定有效检索根而不是 pattern（D-22）
//   · ro: 只读条目只授读不授写（契约 S2.2）
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-guard2-'));
const PROJ = path.join(tmp, 'proj');
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(PROJ, 'src', 'app'), { recursive: true });
fs.mkdirSync(path.join(PROJ, 'config'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'app', 'login.ts'), 'x', 'utf8');
fs.writeFileSync(path.join(PROJ, 'config', 'prod.yaml'), 'x', 'utf8');

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

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

// codex 变体：type=response_item + payload.role=user + content[].type=input_text
function makeCodexTranscript(session, parent, agent, scope) {
  const text = [
    '<agent-context>',
    '  agentName: ' + agent,
    '  PARENT SESSION: ' + parent,
    '</agent-context>',
    '任务：按 brief 执行',
    'SCOPE: ' + scope
  ].join('\n');
  const p = path.join(tmp, 'tr-codex-' + session + '.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    timestamp: new Date().toISOString(), type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
  }) + '\n', 'utf8');
  return p;
}

function guard(payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  return (r.stdout || '').trim();
}
function dispatch(scope, session, turn) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs')], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: session, turn_id: turn || 't',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: ' + scope }
    }), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  return (r.stdout || '').trim();
}

const W = 'worker-s1';
const TR = makeTranscript(W, 'router-s1', 'worker', 'src/app/login.ts');
dispatch('src/app/login.ts', 'router-s1', 't1');

function w(tool, payload) {
  return guard(Object.assign({
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: W,
    agent_id: W, agent_type: 'worker', transcript_path: TR
  }, { tool_input: payload }));
}

// 1a. 写 scope 内文件 -> 放行
ok('写 scope 内文件放行', w('write', { file_path: 'src/app/login.ts' }) === '');
// 1b. 写 scope 外文件 -> deny
{
  const o = w('write', { file_path: 'config/prod.yaml' });
  ok('写 scope 外文件 deny', o.includes('deny'), o.slice(0, 100));
}
// 1c. 绝对路径写 scope 内 -> 放行
{
  const abs = path.join(PROJ, 'src', 'app', 'login.ts');
  const o = w('write', { file_path: abs });
  ok('绝对路径写 scope 内放行', o === '', 'abs=' + abs + ' -> ' + o.slice(0, 100));
}
// 1d. 绝对路径写 scope 外 -> deny
{
  const abs = path.join(PROJ, 'config', 'prod.yaml');
  const o = w('write', { file_path: abs });
  ok('绝对路径写 scope 外 deny', o.includes('deny'), o.slice(0, 100));
}
// 1e. 读 scope 内文件 -> 放行
ok('读 scope 内文件放行', w('read', { path: 'src/app/login.ts' }) === '');
// 1f. 读同目录邻近文件 -> 放行（读宽松）
ok('读同目录邻近文件放行', w('read', { path: 'src/app/session.ts' }) === '');
// 1g. 读完全无关目录 -> deny
{
  const o = w('read', { path: 'config/prod.yaml' });
  ok('读无关目录 deny', o.includes('deny'), o.slice(0, 100));
}
// 1h. glob 的判定对象是有效检索根：显式 path 落在读放行目录树内 -> 放行
ok('glob 显式 path 在读放行目录树内放行', w('glob', { pattern: '**/*.ts', path: 'src/app' }) === '');
// 1i. glob 不带 path -> 有效检索根是工作区根 -> 工作区根不在读放行范围 -> deny
{
  const o = w('glob', { pattern: 'src/app/*.ts' });
  ok('glob 无 path 时按工作区根判定并 deny', o.includes('deny'), o.slice(0, 120));
}
// 1j. glob 的检索根在范围外 -> deny
{
  const o = w('glob', { pattern: '*.yaml', path: 'config' });
  ok('glob 检索根在范围外 deny', o.includes('deny'), o.slice(0, 120));
}

// ── 账号级 / 对外不可逆操作 ────────────────────────────
{
  const o = w('mavis_agent_delete', { agent_name: 'x' });
  ok('删除成员被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 110));
}
{
  const o = w('website_deploy', { path: 'x' });
  ok('公网部署被拦', o.includes('deny') && o.includes('公网'), o.slice(0, 110));
}
{
  const o = w('mavis_agent_update', { agent_name: 'x' });
  ok('改账号级设置被拦', o.includes('deny'), o.slice(0, 110));
}
// 子代理没解析出 scope 时，账号级动作仍应被拦（scope 不保护账号级操作）
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'mavis_agent_delete', session_id: 'no-scope', agent_type: 'worker', tool_input: { agent_name: 'x' } });
  ok('无 scope 也拦账号级操作', o.includes('deny'), o.slice(0, 110));
}
// 解析不到边界时不再放行（D-04 / 契约 S4）：读也要拒
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'no-scope', agent_type: 'worker', tool_input: { path: 'anything.ts' } });
  ok('解析不到边界时读被拒', o.includes('deny') && o.includes('无法建立'), o.slice(0, 140));
}
// Router 父会话不受账号级拦截约束（那是用户与上层权限的事）
{
  const o = guard({ hook_event_name: 'PreToolUse', tool_name: 'mavis_agent_delete', session_id: 'router-s1', tool_input: { agent_name: 'x' } });
  ok('Router 会话不被账号级规则拦', o === '', o.slice(0, 110));
}

// ── D-01：codex 变体 transcript ────────────────────────
{
  const W2 = 'worker-codex';
  const TR2 = makeCodexTranscript(W2, 'router-codex', 'worker', 'src/app/login.ts');
  const g = (tool, payload) => guard({
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: W2,
    agent_id: W2, agent_type: 'worker', transcript_path: TR2, tool_input: payload
  });
  const okOut = g('write', { file_path: 'src/app/login.ts' });
  const badOut = g('write', { file_path: 'config/prod.yaml' });
  ok('codex 变体：scope 内放行', okOut === '', okOut.slice(0, 120));
  ok('codex 变体：scope 外 deny', badOut.includes('deny'), badOut.slice(0, 120));
}

// ── D-04：brief 位置不靠固定行号（前置消息多也能找到）──
{
  const W3 = 'worker-deep';
  const p = path.join(tmp, 'tr-deep.jsonl');
  const lines = [];
  for (let i = 0; i < 20; i++) {
    lines.push(JSON.stringify({
      timestamp: new Date().toISOString(), type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '前置消息 ' + i }] }
    }));
  }
  lines.push(JSON.stringify({
    timestamp: new Date().toISOString(), type: 'response_item',
    payload: {
      type: 'message', role: 'user',
      content: [{ type: 'input_text', text: 'agentName: worker\nPARENT SESSION: router-deep\nSCOPE: src/app/login.ts' }]
    }
  }));
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  const o = guard({
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: W3,
    agent_id: W3, agent_type: 'worker', transcript_path: p,
    tool_input: { file_path: 'config/prod.yaml' }
  });
  ok('brief 不在前几行也能定位（按语义而非行号）', o.includes('deny'), o.slice(0, 140));
}

// ── D-04：transcript 读不到 / 没有 SCOPE 行 -> deny ────
{
  const o = guard({
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'worker-missing',
    agent_id: 'worker-missing', agent_type: 'worker',
    transcript_path: path.join(tmp, 'no-such-transcript.jsonl'),
    tool_input: { path: 'src/app/login.ts' }
  });
  ok('transcript 读不到时 deny 且写明原因', o.includes('deny') && o.includes('读不到'), o.slice(0, 160));
}
{
  const p = path.join(tmp, 'tr-noscope.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: '没有任何 SCOPE 行的消息' }] }
  }) + '\n', 'utf8');
  const o = guard({
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: 'worker-noscope',
    agent_id: 'worker-noscope', agent_type: 'worker', transcript_path: p,
    tool_input: { path: 'src/app/login.ts' }
  });
  ok('transcript 里没有 SCOPE 行时 deny', o.includes('deny') && o.includes('SCOPE'), o.slice(0, 160));
}

// ── D-02：bash 通道语义 ────────────────────────────────
{
  // 目录型目标：不含扩展名，靠「动词 + 参数」识别
  const o = w('bash', { command: 'rm -rf config' });
  ok('bash 目录型目标被识别并拦下', o.includes('deny') && o.includes('config'), o.slice(0, 160));
}
{
  const o = w('bash', { command: 'rm -rf node_modules' });
  ok('bash 目录型目标 node_modules 被拦下', o.includes('deny') && o.includes('node_modules'), o.slice(0, 160));
}
{
  // 带点的标识符不是路径（console.log / JSON.stringify / v0.4.0）
  const o = w('bash', { command: 'node -e "console.log(JSON.stringify({a:1}))"' });
  ok('console.log 这类标识符不被当成路径', o === '', o.slice(0, 160));
}
{
  // 只读命令按读判定
  const o = w('bash', { command: 'cat src/app/session.ts' });
  ok('只读命令按读判定（scope 目录树内放行）', o === '', o.slice(0, 160));
}
{
  const o = w('bash', { command: 'cat config/prod.yaml' });
  ok('只读命令按读判定（范围外被拦）', o.includes('deny'), o.slice(0, 160));
}
{
  const o = w('bash', { command: 'git status' });
  ok('git status 放行', o === '', o.slice(0, 160));
}
{
  // 写命令按写判定：scope 内的文件可写
  const o = w('bash', { command: 'rm -rf src/app/login.ts' });
  ok('写命令按写判定（scope 内目标放行）', o === '', o.slice(0, 160));
}
{
  // 对外可见的不可逆命令一律拦
  const o = w('bash', { command: 'git push origin main' });
  ok('bash 里的对外不可逆命令被拦', o.includes('deny'), o.slice(0, 160));
}

// ── D-25：bash 通道的账号级 / 对外不可逆动作（命令形态判定）────────
//
// 以前 bash 通道只认 DANGEROUS_COMMAND 那张「对外命令表」，
// 账号级动作（mavis agent delete / mavis agent update）不在表里，
// 于是 worker 能在 bash 里夹带一个 scope 内路径 token 把删除成员夹带过去。
// 现在按「命令形态」判定：命令位置上的 CLI + 子命令 + 动作。
//
// 关键：不能按字样拦（见到 delete 就拦）—— rm build/out.txt 这类普通路径操作很常见，
// 按字样拦会大面积误伤，护栏一旦变成噪音就等于不存在。
{
  const o = w('bash', { command: 'mavis agent delete sa-x' });
  ok('bash 里的 mavis agent delete 被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  // 命令里没有任何路径 token：以前走不到「取不到目标就 deny」，必须由账号级判定拦住
  const o = w('bash', { command: 'mavis agent delete sa-victim' });
  ok('bash 里无路径 token 的账号级删除被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  // 真实绕过形态：同时含一个 scope 内路径 token，「取不到目标就 deny」不生效
  const o = w('bash', { command: 'echo x >> src/app/login.ts && mavis agent delete sa-x' });
  ok('bash 里夹带 scope 内路径的账号级删除被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  const o = w('bash', { command: 'mavis agent update sa-x' });
  ok('bash 里的 mavis agent update 被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  // 包装器形态：sudo / xargs 只改变执行方式，执行的仍是那条命令
  const o = w('bash', { command: 'sudo mavis agent delete sa-x' });
  ok('bash 里的 sudo mavis agent delete 被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  const o = w('bash', { command: 'bash -c "mavis agent delete sa-x"' });
  ok('bash -c 载荷里的账号级删除被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  const o = w('bash', { command: 'find . -exec mavis agent delete {} ;' });
  ok('find -exec 里的账号级删除被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  // 拒答理由要说清是哪条动作被拦
  const o = w('bash', { command: 'mavis agent delete sa-x' });
  ok('账号级拒答理由写明被拦动作', o.includes('mavis agent delete') && o.includes('用户'), o.slice(0, 200));
}
{
  // 对外可见的部署 / 发布形态
  const o = w('bash', { command: 'website_deploy' });
  ok('bash 里的部署被拦', o.includes('deny') && o.includes('公网'), o.slice(0, 160));
}
{
  const o = w('bash', { command: 'miniapp publish' });
  ok('bash 里的 Mini App 发布被拦', o.includes('deny'), o.slice(0, 160));
}
{
  // 命令替换：$(...) 里的内容会被 shell 真的执行，
  // 段首是 cat 也不能让替换里那条账号级命令按「纯读命令」溜过去
  const o = w('bash', { command: 'cat $(mavis agent delete sa-x)' });
  ok('命令替换里的账号级删除被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
}
{
  // 负例：普通命令替换不该误伤
  const o = w('bash', { command: 'cat $(date)' });
  ok('普通命令替换不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  // 只读命令不受这条判定影响（分流不被破坏）
  const o = w('bash', { command: 'ls src/app' });
  ok('只读命令 ls 不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  const o = w('bash', { command: 'git log --oneline' });
  ok('只读命令 git log 不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  const o = w('bash', { command: 'cat src/app/session.ts' });
  ok('只读命令 cat 不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  // 负例：普通命令不得误伤（命令形态判定不能退化成按字样拦）
  const o = w('bash', { command: 'echo hello' });
  ok('普通 echo 不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  const o = w('bash', { command: 'node -e "console.log(1)"' });
  ok('node -e 不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  // 文本里出现关键词、但不是在命令位置 -> 只是读/搜文本，不该被拦
  const o = w('bash', { command: 'grep -rn "mavis agent delete" src/app' });
  ok('grep 文本里的关键词不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  // mavis 的非危险子命令不受影响
  const o = w('bash', { command: 'mavis agent list' });
  ok('mavis agent list 不被账号级判定拦', o === '', o.slice(0, 160));
}
{
  // 含 delete/remove 字样的普通路径操作（目录型 scope 下）：不得被账号级判定拦
  const W7 = 'worker-d25';
  const TR7 = makeTranscript(W7, 'router-d25', 'worker', 'src/app/');
  const g = (payload) => guard({
    hook_event_name: 'PreToolUse', tool_name: 'bash', session_id: W7,
    agent_id: W7, agent_type: 'worker', transcript_path: TR7, tool_input: payload
  });
  const o = g({ command: 'rm -rf src/app/delete-me.txt' });
  ok('含 delete 字样的普通路径操作不被账号级判定拦', o === '', o.slice(0, 160));
  const o2 = g({ command: 'mkdir -p src/app/remove-old' });
  ok('含 remove 字样的普通路径操作不被账号级判定拦', o2 === '', o2.slice(0, 160));
}

// ── D-25 残余：包装器开关语义 / 包装器闭集 / 子命令位置 ─────
//
// 独立复验 PASS_WITH_RESIDUAL 查出的三处残余：
//   ① 带值开关表把**布尔开关**也当带值（sudo -n / sudo -E / env -i）——
//      吞掉后一个 token 就把真正的命令词（mavis）吞了，命令位置找不到 mavis → 放行。
//   ② 包装器是闭集：漏了 timeout / powershell / pwsh / cmd /c → 同样定位不到命令词 → 放行。
//   ③ 子命令位置匹配过宽：「mavis 后面出现 agent delete」就算危险 → mavis list agent delete 被误拦。
//
// 下面三组断言在改前分别是「放行」「放行」「误拦」—— 必须能区分改前改后。
{
  // ① 布尔开关后面跟的是命令词，不是开关值
  for (const cmd of [
    'sudo -n mavis agent delete sa-x',
    'sudo -E mavis agent delete sa-x',
    'sudo -H mavis agent delete sa-x',
    'sudo -k mavis agent delete sa-x',
    'sudo -s mavis agent delete sa-x',
    'sudo -v mavis agent delete sa-x',
    'env -i mavis agent delete sa-x',
    'env -0 mavis agent delete sa-x'
  ]) {
    const o = w('bash', { command: cmd });
    ok('D-25 残余·布尔开关不吞命令词：' + cmd, o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
  }
  // ② 包装器闭集补齐：timeout 的时长是位置参数；powershell / cmd 的载荷是整段
  for (const cmd of [
    'timeout 5 mavis agent delete sa-x',
    'timeout 5s mavis agent delete sa-x',
    'timeout --signal=TERM 5 mavis agent delete sa-x',
    'powershell -Command mavis agent delete sa-x',
    'powershell -Command "mavis agent delete sa-x"',
    'pwsh -c "mavis agent delete sa-x"',
    'cmd /c "mavis agent delete sa-x"'
  ]) {
    const o = w('bash', { command: cmd });
    ok('D-25 残余·包装器形态被拦：' + cmd, o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
  }
  // ③ 子命令必须是 mavis 之后的第一个子命令
  {
    const o = w('bash', { command: 'mavis list agent delete' });
    ok('D-25 残余·mavis list agent delete 不被拦（agent 不是第一个子命令）', o === '', o.slice(0, 160));
  }
  for (const cmd of ['mavis agent list', 'mavis --help']) {
    const o = w('bash', { command: cmd });
    ok('D-25 残余·mavis 非危险子命令不被拦：' + cmd, o === '', o.slice(0, 160));
  }
  // 同族残余：进程替换 <( … ) 也是真执行 —— 以前只认 $() 与反引号
  {
    const o = w('bash', { command: 'cat <(mavis agent delete sa-x)' });
    ok('D-25 残余·进程替换里的账号级删除被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
  }
  {
    const o = w('bash', { command: 'cat <(date)' });
    ok('D-25 残余·普通进程替换不被账号级判定拦', o === '', o.slice(0, 160));
  }
  // 同族残余：PowerShell 的 -EncodedCommand 载荷是 base64(UTF-16LE) ——
  // 不解码就看不见命令，判定会落空；解不出来也不能当它安全（必须拒绝）
  {
    const enc = Buffer.from('mavis agent delete sa-x', 'utf16le').toString('base64');
    const o = w('bash', { command: 'powershell -EncodedCommand ' + enc });
    ok('D-25 残余·base64 编码的命令载荷被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
  }
  {
    const enc = Buffer.from('echo hello', 'utf16le').toString('base64');
    const o = w('bash', { command: 'powershell -EncodedCommand ' + enc });
    ok('D-25 残余·无害的 base64 载荷不被拦', o === '', o.slice(0, 160));
  }
  {
    const o = w('bash', { command: 'powershell -EncodedCommand not-base64!!' });
    ok('D-25 残余·解不出的 base64 载荷被拒（不是放行）', o.includes('deny'), o.slice(0, 160));
  }
  // 负例：包装器 + 无害命令不得误伤
  //（布尔开关与位置参数不能被当成命令词吞掉，也不能把无害命令判成危险）
  for (const cmd of ['sudo -n ls', 'env -i ls', 'timeout 5 ls']) {
    const o = w('bash', { command: cmd });
    ok('D-25 残余·包装器 + 无害命令不被拦：' + cmd, o === '', o.slice(0, 160));
  }
  // 负例：文本里出现关键词、但不在命令位置
  for (const cmd of [
    'grep -rn "mavis agent delete" src/app',
    'echo mavis agent delete',
    'grep "miniapp publish" src/app',
    "node -e 'console.log(1)'",
    'git status',
    'git log',
    'ls'
  ]) {
    const o = w('bash', { command: cmd });
    ok('D-25 残余·非命令位置的关键词不被拦：' + cmd, o === '', o.slice(0, 160));
  }
  // 负例：路径类 —— scope 要真的覆盖这些路径。
  // build/ 这种目录条目只覆盖其「之下」的内容、不含目录本身，
  // 所以「删掉目录本身」要另给一条精确条目（这里用 src/app + src/app/）。
  {
    const W8 = 'worker-d25b';
    const TR8 = makeTranscript(W8, 'router-d25b', 'worker', 'src/app src/app/');
    const g2 = (payload) => guard({
      hook_event_name: 'PreToolUse', tool_name: 'bash', session_id: W8,
      agent_id: W8, agent_type: 'worker', transcript_path: TR8, tool_input: payload
    });
    for (const cmd of [
      'rm src/app/out.txt',
      'rmdir src/app',
      'cat src/app/website_deploy.md',
      'sudo -n cat src/app/login.ts'
    ]) {
      const o = g2({ command: cmd });
      ok('D-25 残余·路径类负例不被拦：' + cmd, o === '', o.slice(0, 160));
    }
  }
}

// ── D-25 残余·第二批：exec 家族闭集 / 数据段-执行段 / 两条过度拦 ─────
//
// 这一批锁住「命令形态判定」的结构性改造（不是往包装器白名单里补名字）：
//   · A1 exec 家族 + 新包装器共 17 种形态 —— 以前包装器是一张**闭集**白名单，
//     exec 一族 17 条形态全部放行（真绕过）。现在按「数据段 / 执行段」分：
//     段首是数据命令 -> 其余 token 是数据，不参与命令位置判定；
//     段首不是数据命令 -> 段内**每一个独立 token** 都是命令候选，
//     于是任何将来出现的包装器都自动被覆盖。
//   · A2 两条过度拦必须放行：
//       sh -c mavis agent delete sa-x（未加引号）—— POSIX 下 -c 只取**一个**参数
//         当 command_string，agent/delete 是 $0/$1 位置参数，不是子命令；
//       command -v mavis agent delete sa-x —— command -v 是查询语义，不执行任何东西。
//     而 sh -c "mavis agent delete sa-x"（带引号）必须**继续被拦**。
//   · A3 上一轮全部必拦 / 必放行形态仍须符合。
//   · A7 自找的绕过形态（包装器开关语义 / 启动器 / 转义）必须被拦。
//
// scope 给 'src/app/ src/app'：路径类负例必须真的落在 scope 内，
// 否则会被 scope 层拦成越界，把判定层的结论盖掉。
{
  const W9 = 'worker-d25c';
  const TR9 = makeTranscript(W9, 'router-d25c', 'worker', 'src/app/ src/app');
  const g3 = (cmd) => guard({
    hook_event_name: 'PreToolUse', tool_name: 'bash', session_id: W9,
    agent_id: W9, agent_type: 'worker', transcript_path: TR9,
    tool_input: { command: cmd }
  });

  // A1：exec 家族 + 新包装器 17 种形态
  for (const cmd of [
    'exec mavis agent delete sa-x',
    'sudo exec mavis agent delete sa-x',
    'env exec mavis agent delete sa-x',
    'nohup exec mavis agent delete sa-x',
    'nice exec mavis agent delete sa-x',
    'timeout 5 exec mavis agent delete sa-x',
    'sh -c "exec mavis agent delete sa-x"',
    'bash -c "exec mavis agent delete sa-x"',
    'eval "exec mavis agent delete sa-x"',
    'xargs -0 sh -c "exec mavis agent delete sa-x"',
    'taskset 0 mavis agent delete sa-x',
    'watch -c mavis agent delete sa-x',
    'at now mavis agent delete sa-x',
    'parallel mavis agent delete sa-x',
    'script -q -c "mavis agent delete sa-x" mavis',
    'chroot . mavis agent delete sa-x',
    'strace -f mavis agent delete sa-x'
  ]) {
    const o = g3(cmd);
    ok('D-25 第二批·exec 家族被拦：' + cmd, o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
  }

  // A2：两条过度拦 -> 放行
  for (const cmd of ['sh -c mavis agent delete sa-x', 'command -v mavis agent delete sa-x']) {
    const o = g3(cmd);
    ok('D-25 第二批·过度拦已放行：' + cmd, o === '', o.slice(0, 160));
  }
  // A2：带引号的同一形态必须**继续被拦**（区分「字样」与「形态」的那条边界）
  {
    const o = g3('sh -c "mavis agent delete sa-x"');
    ok('D-25 第二批·带引号的 sh -c 仍被拦', o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
  }

  // A3：上一轮必拦形态
  for (const cmd of [
    'mavis agent delete sa-x',
    'mavis agent update sa-x',
    'sudo mavis agent delete sa-x',
    'sudo -n mavis agent delete sa-x',
    'env -i mavis agent delete sa-x',
    'timeout 5 mavis agent delete sa-x',
    'powershell -Command mavis agent delete sa-x',
    'bash -c "mavis agent delete sa-x"',
    'find . -exec mavis agent delete {} ;',
    'website_deploy',
    'miniapp publish'
  ]) {
    const o = g3(cmd);
    ok('D-25 第二批·上一轮必拦仍被拦：' + cmd, o.includes('deny'), o.slice(0, 160));
  }

  // A3：上一轮必放行形态
  for (const cmd of [
    'mavis list agent delete',
    'mavis agent list',
    'mavis --help',
    'grep -rn "mavis agent delete" src/app',
    'echo mavis agent delete',
    'rm src/app/out.txt',
    'rmdir src/app',
    'cat src/app/website_deploy.md'
  ]) {
    const o = g3(cmd);
    ok('D-25 第二批·上一轮必放行仍放行：' + cmd, o === '', o.slice(0, 160));
  }

  // A7：自找的绕过形态（包装器开关语义 / 启动器 / 转义）
  for (const cmd of [
    'exec -a name mavis agent delete sa-x',
    'command exec mavis agent delete sa-x',
    'nice -n 10 mavis agent delete sa-x',
    'nice --nice 10 mavis agent delete sa-x',
    'timeout --foreground 5 mavis agent delete sa-x',
    'timeout --kill-after=5 30 mavis agent delete sa-x',
    'xargs -I{} -P1 mavis agent delete {}',
    'find . -execdir mavis agent delete {} ;',
    'find . -exec sh -c "mavis agent delete sa-x" ;',
    'env -u PATH mavis agent delete sa-x',
    'env -i -- mavis agent delete sa-x',
    'sudo -u root -g grp mavis agent delete sa-x',
    'sudo -n -u root mavis agent delete sa-x',
    'stdbuf -o0 mavis agent delete sa-x',
    'stdbuf --output=0 mavis agent delete sa-x',
    'ionice -c3 mavis agent delete sa-x',
    'ionice -c3 -n 7 mavis agent delete sa-x',
    'setsid mavis agent delete sa-x',
    'setsid -f mavis agent delete sa-x',
    'time mavis agent delete sa-x',
    'doas mavis agent delete sa-x',
    'doas -u root mavis agent delete sa-x',
    'nohup -- mavis agent delete sa-x',
    'su -c "mavis agent delete sa-x"',
    'busybox sh -c "mavis agent delete sa-x"',
    'busybox mavis agent delete sa-x',
    // 启动器形态：数据命令里那一类「会执行另一个程序」的子命令
    'npx mavis agent delete sa-x',
    'npx --yes mavis agent delete sa-x',
    'npm exec mavis agent delete sa-x',
    'npm exec -- mavis agent delete sa-x',
    'pnpm dlx mavis agent delete sa-x',
    'yarn dlx mavis agent delete sa-x',
    'bunx mavis agent delete sa-x',
    // shell 反斜杠转义：载荷文本要解转义后再判，否则命令串看不见 = 判定落空
    'sh -c mavis\\ agent\\ delete\\ sa-x'
  ]) {
    const o = g3(cmd);
    ok('D-25 第二批·自找绕过形态被拦：' + cmd, o.includes('deny') && o.includes('账号级'), o.slice(0, 160));
  }

  // 启动器反例：安装 / 跑脚本不是执行 mavis 子命令，不能被拦
  for (const cmd of ['npm install mavis', 'npm run build', 'npx --version']) {
    const o = g3(cmd);
    ok('D-25 第二批·启动器反例不被拦：' + cmd, o === '', o.slice(0, 160));
  }
}
// ── D-03：工具名兜底 + 参数维度危险判定 ────────────────
{
  const o = w('mavis', { command: 'agent delete' });
  ok('mavis 的 agent delete 被拦', o.includes('deny'), o.slice(0, 140));
}
{
  const o = w('mavis', { command: 'agent update' });
  ok('mavis 的 agent update 被拦', o.includes('deny'), o.slice(0, 140));
}
{
  const o = w('mavis', { command: 'session list' });
  ok('mavis 的非危险命令不受影响', o === '', o.slice(0, 140));
}
{
  // 复合层不做作用域判定（契约 S3 / S5.4）：作用域交回内层调用。
  // 以前这里对整段代码文本扫路径，scope 外路径字样（哪怕只是字符串常量）
  // 会把整次 run_code 判成越界 —— 实测坐实的大面积误伤（验收 V-02 / V-04 / V-07）。
  const o = w('run_code', { code: "await tools.write({ path: 'config/prod.yaml', content: 'x' })" });
  ok('run_code 复合层不扫代码文本（作用域交回内层调用）', o === '', o.slice(0, 160));
}
{
  const o = w('run_code', { code: "await tools.write({ path: 'src/app/login.ts', content: 'x' })" });
  ok('run_code 里的写操作在 scope 内放行', o === '', o.slice(0, 160));
}
{
  // 复合工具里点名危险工具 -> 直接拦
  const o = w('run_code', { code: "await tools.mavis_agent_delete({ agent_name: 'x' })" });
  ok('run_code 里的危险操作被拦', o.includes('deny'), o.slice(0, 160));
}
{
  // 交回内层不等于放弃边界：同一个目标在内层 write 调用上照样被拦。
  const o = w('write', { file_path: 'config/prod.yaml' });
  ok('run_code 内层 write 调用仍按 scope 判定并被拦', o.includes('deny'), o.slice(0, 160));
}

// ── 复合层：自由文本里的路径字样不得导致整次调用被拒 ──
{
  const o = w('run_code', { code: 'const r = 1 + 2; return r;' });
  ok('run_code 纯计算代码放行（取不到目标路径不再是拒绝理由）', o === '', o.slice(0, 160));
}
{
  const o = w('run_code', { code: "// 只是注释：docs/audit/runtime-guards.md\nconst r = 1; return r;" });
  ok('run_code 里的 // 注释不再导致整次调用被拒', o === '', o.slice(0, 160));
}
{
  const o = w('run_code', { code: "const p = 'docs/audit/runtime-guards.md'; return p;" });
  ok('run_code 里的 scope 外路径字符串常量不再导致整次调用被拒', o === '', o.slice(0, 160));
}
{
  const o = w('run_code', { code: "await tools.bash({ command: 'echo hi > src/app/login.ts' });" });
  ok('run_code 里的引号命令串不再被当成一个路径 token', o === '', o.slice(0, 160));
}

// ── D-03：复合层仍然必须拦危险工具名 / 危险参数 ──
{
  const o = w('run_code', { code: "await tools.mavis({ command: 'agent delete sa-x' });" });
  ok('run_code 里的 mavis agent delete 被拦', o.includes('deny'), o.slice(0, 160));
}
{
  const o = w('run_code', { code: "await tools.miniapp({ action: 'publish' });" });
  ok('run_code 里的 miniapp publish 被拦', o.includes('deny'), o.slice(0, 160));
}
{
  const o = w('run_code', { code: "await tools.website_deploy({ path: 'dist' });" });
  ok('run_code 里的 website deploy 被拦', o.includes('deny'), o.slice(0, 160));
}

// ── D-03 补锁：未登记的文件类工具名一律按写判定（工具名兜底）──
// 这条以前没有任何断言锁住：把兜底规则改回放行，套件照样全绿（验收 V-12）。
{
  const o = w('upload_file', { file: 'config/prod.yaml' });
  ok('未登记的文件类工具名按写判定并被拦', o.includes('deny') && o.includes('config/prod.yaml'), o.slice(0, 160));
}
{
  // 兜底不能反过来误伤：不像文件类的未登记工具名仍按 none 放行
  const o = w('translator', { text: 'hello' });
  ok('未登记但不像文件类的工具名放行（兜底不误伤）', o === '', o.slice(0, 160));
}

// ── D-16：取不到目标路径一律 deny ─────────────────────
{
  const o = w('write', {});
  ok('写类工具取不到目标路径时 deny', o.includes('deny') && o.includes('目标'), o.slice(0, 160));
}
{
  // 键名表覆盖 notebookedit 的 notebook_path
  const o = w('notebookedit', { notebook_path: 'config/prod.yaml' });
  ok('notebookedit 的 notebook_path 也参与判定', o.includes('deny'), o.slice(0, 160));
}

// ── D-14：方法论/错题本按精确文件放行 ─────────────────
{
  const other = path.join(PROJ, '.superagent', 'methods', 'sa-other.md');
  fs.mkdirSync(path.join(PROJ, '.superagent', 'methods'), { recursive: true });
  fs.writeFileSync(other, '# 别人的方法论\n', 'utf8');
  const o = w('read', { path: other });
  ok('读别人的方法论被拦（按精确文件放行，不开目录树）', o.includes('deny'), o.slice(0, 160));
}
{
  const mine = path.join(PROJ, '.superagent', 'methods', 'worker.md');
  fs.writeFileSync(mine, '# 我的方法论\n', 'utf8');
  const o = w('read', { path: mine });
  ok('读自己的方法论放行', o === '', o.slice(0, 160));
}

// ── S2：ro: 只读条目只授读不授写 ──────────────────────
{
  const W4 = 'worker-ro';
  const TR4 = makeTranscript(W4, 'router-ro', 'worker', 'ro: src/app/, src/app/login.ts');
  const g = (tool, payload) => guard({
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: W4,
    agent_id: W4, agent_type: 'worker', transcript_path: TR4, tool_input: payload
  });
  const readOut = g('read', { path: 'src/app/other.ts' });
  const writeOut = g('write', { file_path: 'src/app/other.ts' });
  const writeOwn = g('write', { file_path: 'src/app/login.ts' });
  ok('ro: 条目授予读', readOut === '', readOut.slice(0, 140));
  ok('ro: 条目不授予写', writeOut.includes('deny'), writeOut.slice(0, 140));
  ok('可写条目照常授予写', writeOwn === '', writeOwn.slice(0, 140));
}

// ── S2：目录条目：读该目录本身放行，写该目录本身拒绝 ──
{
  const W5 = 'worker-dir';
  const TR5 = makeTranscript(W5, 'router-dir', 'worker', 'src/app/');
  const g = (tool, payload) => guard({
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: W5,
    agent_id: W5, agent_type: 'worker', transcript_path: TR5, tool_input: payload
  });
  ok('读目录条目本身放行', g('read', { path: 'src/app' }) === '', g('read', { path: 'src/app' }).slice(0, 140));
  ok('读目录条目带尾斜杠也放行', g('read', { path: 'src/app/' }) === '', g('read', { path: 'src/app/' }).slice(0, 140));
  ok('写目录条目之下放行', g('write', { file_path: 'src/app/login.ts' }) === '');
  ok('写目录条目本身拒绝（授权只覆盖其之下）', g('write', { file_path: 'src/app' }).includes('deny'), g('write', { file_path: 'src/app' }).slice(0, 140));
}

// ── 载荷坏了 -> 拒绝（不能走进「父会话直接放行」）────────────
{
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
    input: 'not-json-at-all', encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  const o = (r.stdout || '').trim();
  ok('载荷不是合法 JSON 时 deny', o.includes('deny') && o.includes('载荷'), o.slice(0, 160));
}
{
  // 空载荷 = 这个 hook 不是被当作一次工具调用触发的，没有判定可做
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs')], {
    input: '', encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PLUGIN_ROOT, MINIMAX_PROJECT_DIR: PROJ, PLUGIN_DATA: DATA }
  });
  ok('空载荷时不误拦（没有判定可做）', (r.stdout || '').trim() === '', (r.stdout || '').slice(0, 120));
}

// ── 合成载荷探针（可选，人工取证用）────────────────────
// 用法：$env:SAR_PROBE='1'; node .superagent/guard-test.mjs
// 打印 5 个合成载荷的真实判定输出；「放行」= stdout 为空（没有任何输出）。
if (process.env.SAR_PROBE === '1') {
  const probes = [
    ['run_code 纯计算代码', 'const r = 1 + 2; return r;'],
    ['run_code 含 // 注释', "// 只是注释：docs/audit/runtime-guards.md\nconst r = 1; return r;"],
    ['run_code 含 scope 外路径字符串常量', "const p = 'docs/audit/runtime-guards.md'; return p;"],
    ['run_code 写 scope 外文件', "await tools.write({ path: 'config/prod.yaml', content: 'x' });"],
    ['run_code 含 mavis agent delete', "await tools.mavis({ command: 'agent delete sa-x' });"]
  ];
  for (const [label, code] of probes) {
    const out = w('run_code', { code });
    console.log('PROBE ' + label + ' -> ' + (out || '(放行：stdout 为空)'));
  }
  // 作用域交回内层调用的证据：复合层放行，同一目标在内层 write 上仍被拦
  console.log('PROBE 内层 write 同一目标 -> ' +
    (w('write', { file_path: 'config/prod.yaml' }) || '(放行：stdout 为空)'));
}

// ── 变异自检（可选）：把实现回退到改前版本，验证新断言真的会变红 ──
// 用法：$env:SAR_MUTATION='1'; node .superagent/guard-test.mjs
// 只改系统临时目录里的副本，仓库工作树零改动；跑完即删。
if (process.env.SAR_MUTATION === '1') {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mut-guard-'));
  const mutPlugin = path.join(mutRoot, 'plugin');
  try {
    fs.cpSync(PLUGIN_ROOT, mutPlugin, { recursive: true });
    // 取改前版本（HEAD）。guard.mjs 在本成员的 SCOPE 内，可直接取整份改前实现。
    const old = execFileSync('git', ['show', 'HEAD:plugin/scripts/guard.mjs'], { cwd: REPO, encoding: 'utf8' });
    fs.writeFileSync(path.join(mutPlugin, 'scripts', 'guard.mjs'), old, 'utf8');
    console.log('MUTATION 回退：副本 scripts/guard.mjs <- HEAD 版本（' + mutPlugin + '）');
    const r = spawnSync('node', [path.join(REPO, '.superagent', 'guard-test.mjs')], {
      env: Object.assign({}, process.env, { SAR_PLUGIN_ROOT: mutPlugin, SAR_MUTATION: '' }),
      encoding: 'utf8', timeout: 180000, cwd: REPO
    });
    const out = String(r.stdout || '');
    const fails = out.split(/\r?\n/).filter((l) => l.startsWith('FAIL '));
    console.log('MUTATION 回退后转红断言数：' + fails.length);
    for (const l of fails) console.log('MUTATION ' + l);
    const hit = fails.some((l) => l.indexOf('未登记的文件类工具名按写判定并被拦') >= 0);
    console.log('MUTATION V-12 新断言在旧实现下变红：' + (hit ? 'YES' : 'NO'));
  } finally {
    fs.rmSync(mutRoot, { recursive: true, force: true });
    console.log('MUTATION 副本已删除：' + mutRoot);
  }
}

// ── 变异体 B：把复合分支的「代码文本路径扫描 + 取不到目标就 deny」加回去 ──
// 目的：证明新增的复合层断言真的锁住了这次修复（验收 V-02 / V-04 / V-07），
// 而不是一组恒绿的空断言。改的是系统临时目录里的副本，仓库工作树零改动。
if (process.env.SAR_MUTATION === '1' || process.env.SAR_MUTATION === '2') {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mut-composite-'));
  const mutPlugin = path.join(mutRoot, 'plugin');
  try {
    fs.cpSync(PLUGIN_ROOT, mutPlugin, { recursive: true });
    const gPath = path.join(mutPlugin, 'scripts', 'guard.mjs');
    const gLines = fs.readFileSync(gPath, 'utf8').split('\n');
    const idx = gLines.findIndex((l) =>
      l.indexOf("return { mode: 'composite', targets: [], raw: code, composite: true };") >= 0);
    if (idx < 0) throw new Error('变异点未命中：复合分支已变形');
    console.log('MUTATION-B 变异前 guard.mjs 第 ' + (idx + 1) + ' 行: ' + gLines[idx].trim());
    gLines[idx] = "    return { mode: 'write', targets: extractPathTokens(code), raw: code };";
    console.log('MUTATION-B 变异后 guard.mjs 第 ' + (idx + 1) + ' 行: ' + gLines[idx].trim());
    fs.writeFileSync(gPath, gLines.join('\n'), 'utf8');
    const r = spawnSync('node', [path.join(REPO, '.superagent', 'guard-test.mjs')], {
      env: Object.assign({}, process.env, { SAR_PLUGIN_ROOT: mutPlugin, SAR_MUTATION: '' }),
      encoding: 'utf8', timeout: 180000, cwd: REPO
    });
    const out = String(r.stdout || '');
    const fails = out.split(/\r?\n/).filter((l) => l.startsWith('FAIL '));
    console.log('MUTATION-B 回退后转红断言数：' + fails.length);
    for (const l of fails) console.log('MUTATION-B ' + l);
    const want = [
      'run_code 复合层不扫代码文本（作用域交回内层调用）',
      'run_code 纯计算代码放行（取不到目标路径不再是拒绝理由）',
      'run_code 里的 // 注释不再导致整次调用被拒',
      'run_code 里的 scope 外路径字符串常量不再导致整次调用被拒',
      'run_code 里的引号命令串不再被当成一个路径 token'
    ];
    for (const name of want) {
      const hit = fails.some((l) => l.indexOf(name) >= 0);
      console.log('MUTATION-B 复合层断言「' + name + '」在旧实现下变红：' + (hit ? 'YES' : 'NO'));
    }
  } finally {
    fs.rmSync(mutRoot, { recursive: true, force: true });
    console.log('MUTATION-B 副本已删除：' + mutRoot);
  }
}

console.log(fail === 0 ? '>>> GUARD2 ALL PASS' : '>>> GUARD2 FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
