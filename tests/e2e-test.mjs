// super-agent-router 回归测试（v0.5.0）
// 用法：node tests/e2e-test.mjs
// 断言插件的 Hook 在真实 stdin/stdout 契约下的行为。
//
// v0.4.0 语义：派工发生在父会话，工具执行发生在子会话。
//   · 父会话 = Router（不受 worker 的 scope 约束）
//   · 子会话 = worker（载荷带 agent_type，scope 来自它自己 transcript 里的 brief）
//
// v0.5.0 新增锁住：
//   · codex 变体 transcript 的端到端链路（D-01）
//   · 解析不到边界一律拒绝（D-04）
//   · glob/grep 按有效检索根判定（D-22）
//   · watchdog 的收尾契约校验（S8）与证据判定（D-11）
//   · 名额回收的三条路（S6.2）
//   · 实战记录摘要的披露口径（S7.3）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';

// 主动触发的命中判定直接 import 出来断言 ——
// 漏判的表现是 stdout 为空，跟「判定为不该命中」长得一模一样，
// 只看 stdout 的回归永远发现不了漏判（D-27）。
let judgeTriggerIntent = null;
try {
  ({ judgeTriggerIntent } = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs')).href));
} catch (e) {
  console.log('IMPORT_FAIL lib.mjs ' + e.message);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-e2e-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const a = 1;', 'utf8');

let fail = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ' :: ' + extra : ''));
};

function run(script, payload) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload),
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: payload && payload.cwd ? payload.cwd : tmp },
    encoding: 'utf8'
  });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
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

// 1. UserPromptSubmit：普通提问静默放行，编排意图才注入
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '帮我看下这个错误', session_id: 'e1' });
  ok('普通提问静默放行', r.out === '');
}
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做，谁来负责？', session_id: 'e1' });
  ok('编排意图注入路由指令', r.out.includes('super-agent-router') && r.out.includes('直做'));
}
// 1b. gate 不得把用户文本里的路径说成「已声明的 SCOPE」（D-15）
{
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做？\nSCOPE: src/app.ts', session_id: 'e1b' });
  ok('gate 不把用户文本里的 SCOPE 说成授权', r.out.includes('未验证') && !r.out.includes('本轮 prompt 中声明的 SCOPE'), r.out.slice(0, 200));
}

// 1c. D-27：主动触发粗筛 —— 语料直接喂判定函数
//     判据与语料见 docs/audit/d27-acceptance.md
{
  ok('D-27 判定函数可独立 import', typeof judgeTriggerIntent === 'function', String(typeof judgeTriggerIntent));
  const SHOULD = [
    '同时做 A 和 B', '拆一下这块', '分一下工', '派谁去做', '谁负责这块', '几个人一起做',
    '实现和验证一起', '一边调研一边写', '帮我拆解这个任务', '这个要做两件事', '并行跑一下',
    '各做各的', '让 A 和 B 各自负责', '复审一下', '评审一下', '放到后台做', '开个会话并行做',
    '你安排人', '这两个能不能一起做', '拆成两块', '分头做', '一前一后两个人',
    '好像还有点问题就是主动触发还有其他的你看看'
  ];
  const SINGLE = ['改个 typo', '查一下 API 文档', '帮我看下这个函数', '加个注释', '这个 bug 怎么修', '把文件名改一下'];
  const FAKE = ['分别说明这两个概念的区别', '同时打开这两个文件', '批量导入这批数据', '这个函数有多个分支', '把这两个文件合并一下', '并行度调高一点', '这两个概念各自的意思'];

  if (typeof judgeTriggerIntent === 'function') {
    const missed = SHOULD.filter((p) => !judgeTriggerIntent(p).hit);
    const overSingle = SINGLE.filter((p) => judgeTriggerIntent(p).hit);
    const overFake = FAKE.filter((p) => judgeTriggerIntent(p).hit);
    ok('D-27 编排意图 23 条全部命中', missed.length === 0, missed.join(' | '));
    ok('D-27 单点动作 6 条全部不命中', overSingle.length === 0, overSingle.join(' | '));
    ok('D-27 伪信号 7 条全部不命中', overFake.length === 0, overFake.join(' | '));
  }

  // 口语编排请求必须真的走到「注入完整路由指令」
  const r = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '拆一下这块', session_id: 'e1c' });
  ok('D-27 口语编排请求注入完整路由指令', r.out.includes('super-agent-router') && r.out.includes('直做'), r.out.slice(0, 120));

  // 载荷解析失败必须留痕，且不注入任何内容（不能静默失效）
  const bad = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
    input: '{ this is not json',
    env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: DATA, MINIMAX_PROJECT_DIR: tmp },
    encoding: 'utf8'
  });
  const traceFile = path.join(DATA, 'hooks', 'super-agent-router', 'gate-trace.jsonl');
  const traced = fs.existsSync(traceFile) && fs.readFileSync(traceFile, 'utf8').includes('payload-parse-failed');
  ok('D-27 载荷解析失败留下痕迹', traced, 'err=' + (bad.stderr || '').slice(0, 120));
  ok('D-27 载荷坏时不注入任何内容', (bad.stdout || '').trim() === '', JSON.stringify(bad.stdout || '').slice(0, 120));

  // D-29：运行时 PLUGIN_DATA 本身就是本插件的专属目录，
  //        痕迹必须落在它**下一层**，不能再多套一层 hooks/super-agent-router
  {
    const runtimeShape = path.join(tmp, 'plugin-data', 'hooks', 'super-agent-router');
    fs.mkdirSync(runtimeShape, { recursive: true });
    spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
      input: '{ this is not json',
      env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: runtimeShape, MINIMAX_PROJECT_DIR: tmp },
      encoding: 'utf8'
    });
    const direct = path.join(runtimeShape, 'gate-trace.jsonl');
    const nested = path.join(runtimeShape, 'hooks', 'super-agent-router', 'gate-trace.jsonl');
    const directHit = fs.existsSync(direct) && fs.readFileSync(direct, 'utf8').includes('payload-parse-failed');
    ok('D-29 痕迹落在 PLUGIN_DATA 下一层（不多套一层）', directHit,
      'direct=' + fs.existsSync(direct) + ' nested=' + fs.existsSync(nested));
    ok('D-29 不产生多套一层的怪目录', !fs.existsSync(nested), 'nestedExists=' + fs.existsSync(nested));

    // F4（独立验收实测的洞）：PLUGIN_DATA 带**尾斜杠**时也不能多套一层。
    // 之前的判定是「正则锚末尾」，尾斜杠会打破锚点 -> 又去拼一层。
    spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', 'gate.mjs')], {
      input: '{ this is not json',
      env: { ...process.env, PLUGIN_ROOT, PLUGIN_DATA: runtimeShape + path.sep, MINIMAX_PROJECT_DIR: tmp },
      encoding: 'utf8'
    });
    const nestedTrailing = path.join(runtimeShape, 'hooks', 'super-agent-router', 'gate-trace.jsonl');
    ok('D-29/F4 尾斜杠形态也不多套一层', !fs.existsSync(nestedTrailing),
      'nestedExists=' + fs.existsSync(nestedTrailing));
  }
}

// 2. 派工登记：scope 只收路径，自然语言被过滤
const scopeSession = 'e-task';
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: scopeSession, turn_id: 'et1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts, src/util.ts\n请实现登录超时修复' }
  });
  const led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const d = led.dispatches.find((x) => x.parent_session_id === scopeSession);
  ok('scope 只收路径', !!d && JSON.stringify(d.scope) === JSON.stringify(['src/app.ts', 'src/util.ts']), JSON.stringify(d && d.scope));
  ok('派工记录带 dispatch_id', !!d && !!d.dispatch_id, d ? String(d.dispatch_id) : 'no-record');
}

// 2b. D-31：SCOPE 不得覆盖成员的私有记忆目录（越权授予他人记忆）
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-privmem1', turn_id: 'pm1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: ro: .superagent/lessons/\n读一下错题本' }
  });
  ok('D-31 覆盖错题本目录被拒', r.out.includes('deny') && r.out.includes('私有记忆'), r.out.slice(0, 200));
}
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-privmem2', turn_id: 'pm2',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: ro: .superagent/methods/\n读方法论' }
  });
  ok('D-31 覆盖方法论目录同样被拒', r.out.includes('deny'), r.out.slice(0, 160));
}
{
  const r = run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-privmem3', turn_id: 'pm3',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: ro: .superagent/lessons/sa-x.md\n读某个成员的' }
  });
  ok('D-31 单个成员文件同样被拒（读模式没有细粒度写法：文件条目的读范围是所在目录）',
    r.out.includes('deny'), r.out.slice(0, 200));
}

// 3. 越界拦截：worker 受自己 scope 约束，Router 不受约束
const workerSession = 'e-worker';
const TR = makeTranscript(workerSession, scopeSession, 'worker', 'src/app.ts');
function wguard(tool, payload, sid, tr) {
  return run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: sid || workerSession,
    agent_id: sid || workerSession, agent_type: 'worker',
    transcript_path: tr === undefined ? TR : tr,
    tool_input: payload
  });
}
{
  const r1 = wguard('write', { file_path: 'src/app.ts' });
  ok('worker scope 内文件放行', r1.out === '');
  const r2 = wguard('write', { file_path: 'config/prod.yaml' });
  ok('worker scope 外文件 deny', r2.out.includes('deny'), r2.out.slice(0, 90));
  const r3 = wguard('bash', { command: 'rm -rf config/prod.yaml' });
  ok('worker bash 越界 deny', r3.out.includes('deny'), r3.out.slice(0, 90));
  // 解析不到边界 -> 拒绝（D-04 / 契约 S4）
  const r4 = wguard('read', { path: 'any/x.ts' }, 'no-scope-w', null);
  ok('worker 解析不到边界时被拦', r4.out.includes('deny'), r4.out.slice(0, 120));
  const r5 = run('guard.mjs', { hook_event_name: 'PreToolUse', tool_name: 'write', session_id: scopeSession, tool_input: { file_path: 'any/x.ts' } });
  ok('Router 父会话不被 worker scope 约束', r5.out === '', r5.out.slice(0, 90));
}

// 3b. D-01：codex 变体的完整链路（派工 -> 守卫按 scope 判定）
{
  const s = 'e-codex';
  const w = 'e-codex-worker';
  const t = makeCodexTranscript(w, s, 'worker', 'src/app.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'ct1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts' }
  });
  const g = (tool, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: tool, session_id: w,
    agent_id: w, agent_type: 'worker', transcript_path: t, tool_input: input
  });
  ok('codex 变体：scope 内放行', g('write', { file_path: 'src/app.ts' }).out === '');
  ok('codex 变体：scope 外 deny', g('write', { file_path: 'config/prod.yaml' }).out.includes('deny'));
}

// 4. Watchdog：空交付与无证据 block，有证据放行
{
  const a = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '' });
  ok('空交付 block', a.out.includes('block'));
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已经完成修复了' });
  ok('无证据声称完成 block', b.out.includes('block'));
  const c = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '已修复。改动文件 src/app.ts，测试命令 npm test 全部通过', cwd: tmp });
  ok('有证据放行', c.out === '');
}

// 4b. D-11：描述性词不算证据
{
  const b = run('watchdog.mjs', { hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'worker', last_assistant_message: '搞定了，测试通过' });
  ok('「搞定了，测试通过」被拦', b.out.includes('block'), b.out.slice(0, 140));
}

// 4c. S8：条目型产出必须符合 S1 的 7 字段模板
{
  const bad = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a3', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n条目统计：总计 1 条；已复现 1 条，推断 0 条'
  });
  ok('条目缺字段时 block 并指明缺哪项', bad.out.includes('block') && bad.out.includes('缺字段'), bad.out.slice(0, 300));
  const good = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a4', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n- 复现步骤：z\n- 证据：e\n- 状态：已复现\n- 修法方向：f\n- 还需要什么：无，代码路径已确定\n条目统计：总计 1 条；已复现 1 条，推断 0 条'
  });
  ok('合规条目放行', good.out === '', good.out.slice(0, 200));
  const noStat = run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'a5', agent_type: 'worker',
    last_assistant_message: '已完成，产出条目如下（验证文件 src/app.ts 已存在）：\n### RG-01\n- 触发条件：x\n- 影响：y\n- 复现步骤：z\n- 证据：e\n- 状态：已复现\n- 修法方向：f\n- 还需要什么：无，代码路径已确定'
  });
  ok('条目缺统计行时 block', noStat.out.includes('block') && noStat.out.includes('条目统计'), noStat.out.slice(0, 300));
}

// 5. 读类工具纳入管控
{
  const scopeSession2 = 'e-read';
  const w2 = 'e-read-worker';
  const tr2 = makeTranscript(w2, scopeSession2, 'worker', 'src/app/login.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: scopeSession2, turn_id: 'rt1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app/login.ts' }
  });
  const g = (toolName, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: toolName, session_id: w2,
    agent_id: w2, agent_type: 'worker', transcript_path: tr2, tool_input: input
  });
  ok('读 scope 内放行', g('read', { path: 'src/app/login.ts' }).out === '');
  ok('读无关目录 deny', g('read', { path: 'config/prod.yaml' }).out.includes('deny'));
  // D-22：判定对象是有效检索根，不是 pattern
  ok('glob 检索根在读放行目录树内放行', g('glob', { pattern: '**/*.ts', path: 'src/app' }).out === '');
  ok('glob 检索根在范围外 deny', g('glob', { pattern: '**/*.ts', path: 'config' }).out.includes('deny'));
  ok('glob 无 path 时按工作区根判定并 deny', g('glob', { pattern: 'src/app/*.ts' }).out.includes('deny'));
}

// 6. 危险操作一律拦（子代理侧，不受 scope 保护）
{
  const g = (toolName, input) => run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: toolName, session_id: 'no-scope',
    agent_id: 'no-scope', agent_type: 'worker', tool_input: input
  });
  ok('删除成员被拦', g('mavis_agent_delete', { agent_name: 'x' }).out.includes('deny'));
  ok('公网部署被拦', g('website_deploy', { path: 'x' }).out.includes('deny'));
  ok('改成员配置被拦', g('mavis_agent_update', { agent_name: 'x' }).out.includes('deny'));
  ok('mavis 的 agent delete 被拦', g('mavis', { command: 'agent delete' }).out.includes('deny'));
}

// 7. 名额回收三条路（契约 S6.2）
{
  // 第 1 条：正常结束（SubagentStop）-> 立即回收
  const s = 'e-recycle';
  const w = 'e-recycle-worker';
  const t = makeTranscript(w, s, 'worker', 'src/recycle.ts');
  fs.writeFileSync(path.join(tmp, 'src', 'recycle.ts'), 'export const b = 2;', 'utf8');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'r1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/recycle.ts' }
  });
  run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'write', session_id: w,
    agent_id: w, agent_type: 'worker', transcript_path: t,
    tool_input: { file_path: 'src/recycle.ts' }
  });
  run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', session_id: w, agent_id: w, agent_type: 'worker',
    transcript_path: t, last_assistant_message: '已完成，改动文件 src/recycle.ts，测试通过'
  });
  let led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const rec = led.dispatches.find((x) => x.parent_session_id === s);
  ok('正常结束后派工状态为 done', !!rec && rec.state === 'done', JSON.stringify(rec && rec.state));

  // 第 2 条：超时兜底 —— 超龄的 active 记录判死并落盘
  led.dispatches.push({
    dispatch_id: 'dsp_e2e_stale', parent_session_id: 'e-stale', turn_id: 'x', turn_key: 'x',
    tool_use_id: '', agent: 'sa-stale', agent_key: 'sa-stale', project: tmp,
    scope: ['src/stale.ts'], state: 'active', at: Date.now() - 5 * 60 * 60 * 1000
  });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify(led, null, 2), 'utf8');
  run('watchdog.mjs', {
    hook_event_name: 'SubagentStop', agent_id: 'e-stale-worker', agent_type: 'worker',
    last_assistant_message: '已完成，改动文件 src/app.ts，测试通过'
  });
  led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const stale = led.dispatches.find((x) => x.dispatch_id === 'dsp_e2e_stale');
  ok('超龄派工被 TTL 判死并落盘', !!stale && stale.state !== 'active' && stale.end_reason === 'ttl_expired', JSON.stringify(stale));

  // 第 3 条：读时自愈 —— 读取在飞名单时把超龄记录判死
  led.dispatches.push({
    dispatch_id: 'dsp_e2e_selfheal', parent_session_id: 'e-selfheal', turn_id: 'y', turn_key: 'y',
    tool_use_id: '', agent: 'sa-selfheal', agent_key: 'sa-selfheal', project: tmp,
    scope: ['src/selfheal.ts'], state: 'active', at: Date.now() - 5 * 60 * 60 * 1000
  });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify(led, null, 2), 'utf8');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'e-selfheal2', turn_id: 'z',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/selfheal2.ts' }
  });
  led = JSON.parse(fs.readFileSync(path.join(DATA, 'dispatches.json'), 'utf8'));
  const healed = led.dispatches.find((x) => x.dispatch_id === 'dsp_e2e_selfheal');
  ok('读取在飞名单时超龄记录被自愈判死', !!healed && healed.state !== 'active', JSON.stringify(healed && healed.state));
}

// 8. S7.3：实战记录摘要必须披露「已显示 N / 共 M」（调用方口径）
{
  fs.mkdirSync(path.join(tmp, '.superagent', 'methods'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-01-01',
    members: [{ name: 'sa-e2e', kind: 'specialist', owns: '端到端回归', method: '.superagent/methods/sa-e2e.md' }]
  }), 'utf8');
  fs.writeFileSync(path.join(tmp, '.superagent', 'methods', 'sa-e2e.md'), [
    '# sa-e2e', '', '## 实战记录', '', '### 端到端回归用例',
    '- 做法：先写断言再改实现', '- 证据：五套回归全绿', '- 验收：独立验收通过', ''
  ].join('\n'), 'utf8');
  const g = run('gate.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '这个需求要拆成几个专项并行做，谁来负责？', session_id: 'e-disclose' });
  ok('gate 披露已显示/共有的成员数', g.out.includes('已显示 1 / 共 1'), g.out.slice(0, 240));
  const ss = run('session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup', session_id: 'e-ss' });
  ok('session-start 披露已显示/共有的成员数', ss.out.includes('已显示 1 / 共 1'), ss.out.slice(0, 240));
}

// 9. D-06 / D-18：历史教训必须真的到达 worker（不能只挂在父会话的 additionalContext 上）
{
  const s = 'e-lessons';
  const w = 'e-lessons-worker';
  fs.mkdirSync(path.join(tmp, '.superagent', 'lessons'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.superagent', 'lessons', 'sa-lesson.md'),
    '# 错题本\n\n## 2026-01-01 · 某次\n- **规则**：先写回归断言再改实现\n', 'utf8');
  const t = makeTranscript(w, s, 'sa-lesson', 'src/lesson.ts');
  run('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: s, turn_id: 'l1',
    tool_input: { agent_name: 'sa-lesson', prompt: 'SCOPE: src/lesson.ts' }
  });
  const g = run('guard.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'read', session_id: w,
    agent_id: w, agent_type: 'sa-lesson', transcript_path: t,
    tool_input: { path: 'src/lesson.ts' }
  });
  ok('历史教训被送进 worker 上下文', g.out.includes('历史教训') && g.out.includes('先写回归断言再改实现'), g.out.slice(0, 260));
}

console.log(fail === 0 ? '>>> E2E ALL PASS' : '>>> E2E FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
