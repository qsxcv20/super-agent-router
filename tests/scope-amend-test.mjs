// 权限自动审核与扩权（scope-amend）回归测试
// 用法：node tests/scope-amend-test.mjs
//   默认跑安装副本；跑仓库副本请显式指定：
//   $env:SAR_PLUGIN_ROOT='<repo>/plugin'; node tests\scope-amend-test.mjs
//
// 验证这些事（D-34）：
//   1. worker 撞 scope 墙 → 被拒 + **自动记账**（台账出现 pending 越界请求）
//   2. 父会话一条命令就能看到待审清单（--list）
//   3. 批准（--grant）→ 派工 scope 与子会话绑定同步更新，同一个请求当场放行
//   4. 读请求只授读：批准后读放行，**写仍然被拦**
//   5. 拒绝（--deny）→ 记录被标记，scope 不变
//   6. 同一目标重复撞墙只记一条（hits 累加），待审清单不被噪音淹没
//   7. 对已结束的派工扩权 → 拒绝（事后再补权限没有意义）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLUGIN_ROOT = process.env.SAR_PLUGIN_ROOT ||
  'C:\\Users\\yang2\\.minimax\\plugins\\super-agent-router';
const GUARD = path.join(PLUGIN_ROOT, 'scripts', 'guard.mjs');
const AMEND = path.join(PLUGIN_ROOT, 'scripts', 'scope-amend.mjs');
const DISPATCH = path.join(PLUGIN_ROOT, 'scripts', 'dispatch.mjs');

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

function makeEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-amend-'));
  const PROJ = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src', 'app.ts'), 'export const a = 1;', 'utf8');
  fs.writeFileSync(path.join(PROJ, 'src', 'other.ts'), 'export const b = 2;', 'utf8');
  fs.mkdirSync(path.join(PROJ, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'docs', 'other.md'), '# other', 'utf8');
  const DATA = path.join(tmp, 'data');
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify({
    dispatches: [], bindings: [], counters: {}, scope_requests: []
  }, null, 2), 'utf8');
  const TR = path.join(tmp, 'tr.jsonl');
  fs.writeFileSync(TR, JSON.stringify({
    uuid: 'p-0', parentUuid: null, sessionId: 'mvs_child',
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: [
      '<agent-context>', '  agentName: worker', '  PARENT SESSION: mvs_parent', '</agent-context>',
      '任务：按 brief 执行', 'SCOPE: src/app.ts'
    ].join('\n') }] }
  }) + '\n', 'utf8');
  return { tmp, PROJ, DATA, TR };
}

function run(script, args, env) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000
  });
  let out; try { out = JSON.parse(r.stdout); } catch { out = { raw: r.stdout, err: r.stderr }; }
  return { code: r.status, out, raw: r.stdout || '' };
}

function guard(env, tool, input) {
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: tool,
      session_id: 'mvs_child', agent_id: 'mvs_child', agent_type: 'worker',
      transcript_path: env.TR, cwd: env.PROJ, tool_input: input
    }),
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ },
    timeout: 60000
  });
  let j = null; try { j = JSON.parse(r.stdout); } catch {}
  const o = j && j.hookSpecificOutput ? j.hookSpecificOutput : null;
  return {
    decision: (o && o.permissionDecision) || 'allow',
    reason: (o && o.permissionDecisionReason) || '',
    raw: r.stdout || ''
  };
}

function ledger(env) {
  return JSON.parse(fs.readFileSync(path.join(env.DATA, 'dispatches.json'), 'utf8'));
}

// ── 1. 撞墙 → 拒绝 + 自动记账 ───────────────────────────
const env = makeEnv();
run(DISPATCH, [], {
  PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ
});
// dispatch 需要 stdin 载荷，改用直接 spawn
const dres = spawnSync('node', [DISPATCH], {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'task',
    session_id: 'mvs_parent', turn_id: 't1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts\n干活' }
  }),
  encoding: 'utf8',
  env: { ...process.env, PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ },
  timeout: 60000
});
ok('派工登记成功', !String(dres.stdout || '').includes('deny'), String(dres.stdout || '').slice(0, 140));

const g1 = guard(env, 'read', { path: 'docs/other.md' });
ok('越界读被拦', g1.decision === 'deny', g1.reason.slice(0, 160));
ok('拒绝文案给出扩权命令', g1.reason.includes('--grant') && g1.reason.includes('待审清单'), g1.reason.slice(0, 220));

const led1 = ledger(env);
const reqs1 = led1.scope_requests || [];
ok('越界请求已自动记账', reqs1.length === 1 && reqs1[0].state === 'pending',
  JSON.stringify(reqs1).slice(0, 220));
const reqId = reqs1.length ? reqs1[0].request_id : '';

// ── 2. 父会话一条命令看待审清单 ──────────────────────────
const l1 = run(AMEND, ['--list'], { PLUGIN_DATA: env.DATA });
ok('--list 能看到待审请求', l1.code === 0 && l1.out.pending_count === 1 &&
  l1.out.pending[0].request_id === reqId, JSON.stringify(l1.out).slice(0, 200));

// ── 3. 重复撞墙只记一条（hits 累加）────────────────────
// 注意：目标必须是**同一个**路径。src/other.ts 在 SCOPE 的读范围（src/ 目录树）内，
// 不产生越界请求，所以拿它来测「重复撞墙」是测不到 hits 累加的。
guard(env, 'read', { path: 'docs/other.md' });
const led2 = ledger(env);
ok('同一目标重复撞墙只记一条', (led2.scope_requests || []).length === 1 &&
  Number((led2.scope_requests[0] || {}).hits) >= 2,
  JSON.stringify(led2.scope_requests).slice(0, 200));

// ── 4. 批准 → scope 与绑定同步 + 当场放行 ───────────────
const gr = run(AMEND, ['--grant', reqId, '--approver', 'router'], { PLUGIN_DATA: env.DATA });
ok('批准成功', gr.code === 0 && gr.out.ok === true, JSON.stringify(gr.out).slice(0, 200));
const led3 = ledger(env);
const d3 = (led3.dispatches || [])[0] || {};
const b3 = (led3.bindings || [])[0] || {};
ok('派工 scope 已加入目标', JSON.stringify(d3.scope || []).includes('docs/other.md'),
  JSON.stringify(d3.scope));
ok('子会话绑定同步更新', JSON.stringify(b3.scope || []).includes('docs/other.md'),
  JSON.stringify(b3.scope));
ok('请求标记为 granted', (led3.scope_requests[0] || {}).state === 'granted',
  JSON.stringify(led3.scope_requests[0]).slice(0, 200));
const g2 = guard(env, 'read', { path: 'docs/other.md' });
ok('批准后同一请求放行', g2.decision !== 'deny', g2.reason.slice(0, 160));

// ── 5. 读请求只授读：写仍然被拦 ─────────────────────────
const g3 = guard(env, 'write', { file_path: 'docs/other.md' });
ok('批准读不等于批准写（写仍被拦）', g3.decision === 'deny', g3.reason.slice(0, 160));

// ── 6. 拒绝路径 ─────────────────────────────────────────
const env2 = makeEnv();
spawnSync('node', [DISPATCH], {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'mvs_parent', turn_id: 't1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts\n干活' }
  }),
  encoding: 'utf8',
  env: { ...process.env, PLUGIN_DATA: env2.DATA, MINIMAX_PROJECT_DIR: env2.PROJ },
  timeout: 60000
});
guard(env2, 'write', { file_path: 'docs/other.md' });
const led4 = ledger(env2);
const rid2 = (led4.scope_requests || [])[0] ? led4.scope_requests[0].request_id : '';
const dn = run(AMEND, ['--deny', rid2, '--approver', 'router', '--reason', '不该写'], { PLUGIN_DATA: env2.DATA });
ok('拒绝成功', dn.code === 0 && dn.out.ok === true, JSON.stringify(dn.out).slice(0, 160));
const led5 = ledger(env2);
ok('拒绝后请求标记 denied', (led5.scope_requests[0] || {}).state === 'denied',
  JSON.stringify(led5.scope_requests[0]).slice(0, 200));
ok('拒绝后 scope 不变', !JSON.stringify((led5.dispatches[0] || {}).scope || []).includes('docs/other.md'),
  JSON.stringify((led5.dispatches[0] || {}).scope));
const g4 = guard(env2, 'write', { file_path: 'docs/other.md' });
ok('拒绝后仍被拦', g4.decision === 'deny', g4.reason.slice(0, 120));

// ── 7. 对已结束的派工扩权 → 拒绝 ────────────────────────
const env3 = makeEnv();
spawnSync('node', [DISPATCH], {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'mvs_parent', turn_id: 't1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts\n干活' }
  }),
  encoding: 'utf8',
  env: { ...process.env, PLUGIN_DATA: env3.DATA, MINIMAX_PROJECT_DIR: env3.PROJ },
  timeout: 60000
});
const led6 = ledger(env3);
led6.dispatches[0].state = 'done';
fs.writeFileSync(path.join(env3.DATA, 'dispatches.json'), JSON.stringify(led6, null, 2), 'utf8');
const ad = run(AMEND, ['--dispatch', led6.dispatches[0].dispatch_id, '--add', 'docs/other.md', '--approver', 'router'],
  { PLUGIN_DATA: env3.DATA });
ok('对已结束的派工扩权被拒', ad.code === 1 && ad.out.ok === false, JSON.stringify(ad.out).slice(0, 180));

// ── 8. 直接加条目（写权限）───────────────────────────────
const env4 = makeEnv();
spawnSync('node', [DISPATCH], {
  input: JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'mvs_parent', turn_id: 't1',
    tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts\n干活' }
  }),
  encoding: 'utf8',
  env: { ...process.env, PLUGIN_DATA: env4.DATA, MINIMAX_PROJECT_DIR: env4.PROJ },
  timeout: 60000
});
const led7 = ledger(env4);
const did = led7.dispatches[0].dispatch_id;
const ad2 = run(AMEND, ['--dispatch', did, '--add', 'docs/other.md', '--approver', 'router'], { PLUGIN_DATA: env4.DATA });
ok('直接加可写条目成功', ad2.code === 0 && ad2.out.ok === true, JSON.stringify(ad2.out).slice(0, 180));
const g5 = guard(env4, 'write', { file_path: 'docs/other.md' });
ok('加可写条目后写放行', g5.decision !== 'deny', g5.reason.slice(0, 140));


// ── 9. 权限等级（tier）：提权后项目内自由读写 ───────────
//
// tier = full 的语义：项目工作区内自由读写，不必逐路径枚举；
// 工作区外仍拦并记账；账号级不可逆动作照旧硬拦。
// 提权是管理员动作，写在项目级 roster.json 里，worker 无权改自己的等级。
function makeTierEnv(tier) {
  const e = makeEnv();
  fs.mkdirSync(path.join(e.PROJ, '.superagent'), { recursive: true });
  fs.writeFileSync(path.join(e.PROJ, '.superagent', 'roster.json'), JSON.stringify({
    version: 1, updated: '2026-11-10',
    members: [{ name: 'worker', kind: 'builtin', source: 'builtin', tier: tier }]
  }, null, 2), 'utf8');
  return e;
}

function dispatchWorker(env) {
  return spawnSync('node', [DISPATCH], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'mvs_parent', turn_id: 't1',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts\n干活' }
    }),
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ },
    timeout: 60000
  });
}

// 账号级动作单独跑一次（工具名是 mavis，不是文件类工具）
function guardAccount(env) {
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'mavis',
      session_id: 'mvs_child', agent_id: 'mvs_child', agent_type: 'worker',
      transcript_path: env.TR, cwd: env.PROJ,
      tool_input: { command: 'agent delete sa-someone' }
    }),
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ },
    timeout: 60000
  });
  let j = null; try { j = JSON.parse(r.stdout); } catch {}
  const o = j && j.hookSpecificOutput ? j.hookSpecificOutput : null;
  return {
    decision: (o && o.permissionDecision) || 'allow',
    reason: (o && o.permissionDecisionReason) || '',
    raw: r.stdout || ''
  };
}

const env5 = makeTierEnv('scoped');
dispatchWorker(env5);
const gScoped = guard(env5, 'write', { file_path: 'docs/other.md' });
ok('scoped 等级：白名单外仍被拦', gScoped.decision === 'deny', gScoped.reason.slice(0, 120));

const tg = run(AMEND, ['--tier', 'full', '--agent', 'worker', '--approver', 'router'],
  { PLUGIN_DATA: env5.DATA, MINIMAX_PROJECT_DIR: env5.PROJ });
ok('提权到 full 成功', tg.code === 0 && tg.out.ok === true && tg.out.changed === true,
  JSON.stringify(tg.out).slice(0, 200));

const gFullRead = guard(env5, 'read', { path: 'docs/other.md' });
ok('full 等级：项目内读放行', gFullRead.decision !== 'deny', gFullRead.reason.slice(0, 140));
const gFullWrite = guard(env5, 'write', { file_path: 'docs/other.md' });
ok('full 等级：项目内写放行', gFullWrite.decision !== 'deny', gFullWrite.reason.slice(0, 140));
const gFullNew = guard(env5, 'write', { file_path: 'src/brand-new.ts' });
ok('full 等级：项目内新文件也放行', gFullNew.decision !== 'deny', gFullNew.reason.slice(0, 140));

// 工作区外仍拦，且仍自动记账
const outsidePath = path.join(env5.tmp, 'outside', 'x.md');
const gOut = guard(env5, 'write', { file_path: outsidePath });
ok('full 等级：工作区外仍被拦', gOut.decision === 'deny', gOut.reason.slice(0, 160));
const ledOut = ledger(env5);
ok('工作区外越界已记账且带 tier',
  (ledOut.scope_requests || []).some((r) => r.state === 'pending' && String(r.tier) === 'full'),
  JSON.stringify(ledOut.scope_requests).slice(0, 240));

// 账号级不可逆动作照旧硬拦 —— tier 不是万能钥匙
const gAcct = guardAccount(env5);
ok('full 等级不解除账号级硬拦', gAcct.decision === 'deny', gAcct.reason.slice(0, 140));

// full 等级也要挖掉编排层私有目录 —— 否则成员能改兄弟成员的错题本
const gSuper = guard(env5, 'write', { file_path: '.superagent/lessons/sa-other.md' });
ok('full 等级也不能写编排层私有目录', gSuper.decision === 'deny', gSuper.reason.slice(0, 160));
const gSuperAbs = guard(env5, 'write',
  { file_path: path.join(env5.PROJ, '.superagent', 'roster.json') });
ok('full 等级也不能改权限名录（绝对路径同样拦）', gSuperAbs.decision === 'deny',
  gSuperAbs.reason.slice(0, 160));

// 提权留痕
const rosterAfter = JSON.parse(
  fs.readFileSync(path.join(env5.PROJ, '.superagent', 'roster.json'), 'utf8'));
ok('提权写进了 roster.json',
  String((rosterAfter.members[0] || {}).tier) === 'full' &&
  String((rosterAfter.members[0] || {}).tier_granted_by) === 'router',
  JSON.stringify(rosterAfter.members[0]).slice(0, 200));

// 收回
const tr = run(AMEND, ['--tier', 'scoped', '--agent', 'worker', '--approver', 'router'],
  { PLUGIN_DATA: env5.DATA, MINIMAX_PROJECT_DIR: env5.PROJ });
ok('收回 full 成功', tr.code === 0 && tr.out.ok === true && tr.out.changed === true,
  JSON.stringify(tr.out).slice(0, 180));
const gRevoked = guard(env5, 'write', { file_path: 'docs/other.md' });
ok('收回后恢复拦截', gRevoked.decision === 'deny', gRevoked.reason.slice(0, 140));

// 对名录里没有的成员提权 -> 拒绝
const tb = run(AMEND, ['--tier', 'full', '--agent', 'not-a-member', '--approver', 'router'],
  { PLUGIN_DATA: env5.DATA, MINIMAX_PROJECT_DIR: env5.PROJ });
ok('对名录外的成员提权被拒', tb.code === 1 && tb.out.ok === false, JSON.stringify(tb.out).slice(0, 160));

// ── 10. 派工闸门 1c：.superagent/ 的三种形态 ─────────────
//
// 规则（契约 S13.4）：
//   · 目录条目        → 拒派（会展开成整棵 .superagent/，能读到兄弟成员的错题本）
//   · 可写文件条目    → 拒派（能改自己的权限等级 = 自己给自己提权）
//   · 只读文件条目    → 允许，但**精确生效**（不展开目录树）
//   · 私有记忆目录    → 一律拒派（闸门 1b：lessons / methods）
function dispatchWithScope(env, scopeLine) {
  return spawnSync('node', [DISPATCH], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task', session_id: 'mvs_parent', turn_id: 't1',
      tool_input: { agent_name: 'worker', prompt: scopeLine + '\n干活' }
    }),
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ },
    timeout: 60000
  });
}

const envRo = makeEnv();
const dRo = dispatchWithScope(envRo, 'SCOPE: ro: .superagent/roster.json');
ok('只读单文件条目可以派（精确生效）',
  !String(dRo.stdout || '').includes('deny'), String(dRo.stdout || '').slice(0, 200));

const envDir = makeEnv();
const dDir = dispatchWithScope(envDir, 'SCOPE: ro: .superagent/');
ok('.superagent/ 目录条目被拒',
  String(dDir.stdout || '').includes('deny'), String(dDir.stdout || '').slice(0, 200));

const envWr = makeEnv();
const dWr = dispatchWithScope(envWr, 'SCOPE: .superagent/roster.json');
ok('.superagent/ 可写条目被拒',
  String(dWr.stdout || '').includes('deny'), String(dWr.stdout || '').slice(0, 200));

const envLes = makeEnv();
const dLes = dispatchWithScope(envLes, 'SCOPE: ro: .superagent/lessons/');
ok('私有记忆目录被拒',
  String(dLes.stdout || '').includes('deny'), String(dLes.stdout || '').slice(0, 200));

// 精确生效的实证：只读 roster.json 时，读它放行、读兄弟成员的错题本被拦
const envExact = makeEnv();
fs.mkdirSync(path.join(envExact.PROJ, '.superagent', 'lessons'), { recursive: true });
fs.writeFileSync(path.join(envExact.PROJ, '.superagent', 'roster.json'), '{"members":[]}', 'utf8');
fs.writeFileSync(path.join(envExact.PROJ, '.superagent', 'lessons', 'sa-other.md'), '# 其他成员', 'utf8');
fs.writeFileSync(envExact.TR, JSON.stringify({
  uuid: 'p-1', parentUuid: null, sessionId: 'mvs_child',
  timestamp: new Date().toISOString(), type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: [
    '<agent-context>', '  agentName: worker', '  PARENT SESSION: mvs_parent', '</agent-context>',
    '任务：按 brief 执行', 'SCOPE: ro: .superagent/roster.json'
  ].join('\n') }] }
}) + '\n', 'utf8');
dispatchWithScope(envExact, 'SCOPE: ro: .superagent/roster.json');
const gExactOk = guard(envExact, 'read', { path: '.superagent/roster.json' });
ok('只读条目：读它本人放行', gExactOk.decision !== 'deny', gExactOk.reason.slice(0, 140));
const gExactBad = guard(envExact, 'read', { path: '.superagent/lessons/sa-other.md' });
ok('只读条目：读兄弟成员的错题本被拦（不展开目录树）',
  gExactBad.decision === 'deny', gExactBad.reason.slice(0, 140));

// brief 直接建边界（不经 dispatch）也要封私有记忆目录 —— 闸门 1c 的第二道防线
const envBrief = makeEnv();
fs.writeFileSync(envBrief.TR, JSON.stringify({
  uuid: 'p-2', parentUuid: null, sessionId: 'mvs_child',
  timestamp: new Date().toISOString(), type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: [
    '<agent-context>', '  agentName: worker', '  PARENT SESSION: mvs_parent', '</agent-context>',
    '任务：按 brief 执行', 'SCOPE: ro: .superagent/lessons/'
  ].join('\n') }] }
}) + '\n', 'utf8');
const gBrief = guard(envBrief, 'read', { path: '.superagent/lessons/sa-other.md' });
ok('brief 里塞私有记忆目录：guard 直接拒绝建边界',
  gBrief.decision === 'deny', gBrief.reason.slice(0, 160));

console.log(fail === 0 ? '>>> SCOPE-AMEND ALL PASS' : '>>> SCOPE-AMEND FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
