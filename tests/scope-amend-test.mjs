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

// 变异矩阵入口放在**最前面**（与 tests/e2e-test.mjs 的 SAR_MUTATION 约定一致）：
// 打开时只跑矩阵并退出 —— 矩阵跑的是「被重跑的套件」的输出，
// 本进程自己的正常断言不该混进同一份输出里（那会让第三方分不清哪条红是变异造成的）。
// 函数声明会提升到模块作用域顶部，所以这里调用它没问题。
if (process.env.SAR_MUTATION_D75 === '1') {
  await runD75MutationMatrix();
}

// 造一份子会话 transcript（brief 的载体）。
// 护栏的边界就是从这份 transcript 的 brief 里解析出来的 ——
// 每个子会话一份，才测得出「等级快照跟着派工走」这类按会话生效的判定。
function writeTr(env, session) {
  const p = path.join(env.tmp, 'tr-' + session + '.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    uuid: 'p-0', parentUuid: null, sessionId: session,
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: [
      '<agent-context>', '  agentName: worker', '  PARENT SESSION: mvs_parent', '</agent-context>',
      '任务：按 brief 执行', 'SCOPE: src/app.ts'
    ].join('\n') }] }
  }) + '\n', 'utf8');
  return p;
}

function makeEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-amend-'));
  const PROJ = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src', 'app.ts'), 'export const a = 1;', 'utf8');
  fs.writeFileSync(path.join(PROJ, 'src', 'other.ts'), 'export const b = 2;', 'utf8');
  fs.mkdirSync(path.join(PROJ, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'docs', 'other.md'), '# other', 'utf8');
  // 项目变更账所在目录（提权与批准都要往这里留痕）
  fs.mkdirSync(path.join(PROJ, '.superagent'), { recursive: true });
  const DATA = path.join(tmp, 'data');
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'dispatches.json'), JSON.stringify({
    dispatches: [], bindings: [], counters: {}, scope_requests: []
  }, null, 2), 'utf8');
  const TR = writeTr({ tmp }, 'mvs_child');
  return { tmp, PROJ, DATA, TR };
}

function run(script, args, env) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000
  });
  let out; try { out = JSON.parse(r.stdout); } catch { out = { raw: r.stdout, err: r.stderr }; }
  return { code: r.status, out, raw: r.stdout || '' };
}

function guard(env, tool, input, sessionId) {
  const sid = sessionId || 'mvs_child';
  const tr = sid === 'mvs_child' ? env.TR : writeTr(env, sid);
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: tool,
      session_id: sid, agent_id: sid, agent_type: 'worker',
      transcript_path: tr, cwd: env.PROJ, tool_input: input
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
const l1 = run(AMEND, ['--list'], { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
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
const gr = run(AMEND, ['--grant', reqId, '--approver', 'mvs_parent'], { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
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
// 审计留痕（A4）：批准要能在项目变更账里看到批准人与时间
const logPath4 = path.join(env.PROJ, '.superagent', 'changes.log');
const logTxt4 = fs.existsSync(logPath4) ? fs.readFileSync(logPath4, 'utf8') : '';
ok('批准在 changes.log 里留痕（批准人与时间）',
  logTxt4.includes('grant ' + reqId) && logTxt4.includes('by mvs_parent') &&
  /\d{4}-\d{2}-\d{2}T/.test(logTxt4),
  logTxt4.slice(-160));
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
const dn = run(AMEND, ['--deny', rid2, '--approver', 'mvs_parent', '--reason', '不该写'], { PLUGIN_DATA: env2.DATA, MINIMAX_PROJECT_DIR: env2.PROJ });
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
const ad = run(AMEND, ['--dispatch', led6.dispatches[0].dispatch_id, '--add', 'docs/other.md', '--approver', 'mvs_parent'],
  { PLUGIN_DATA: env3.DATA, MINIMAX_PROJECT_DIR: env3.PROJ });
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
const ad2 = run(AMEND, ['--dispatch', did, '--add', 'docs/other.md', '--approver', 'mvs_parent'], { PLUGIN_DATA: env4.DATA, MINIMAX_PROJECT_DIR: env4.PROJ });
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

function dispatchWorker(env, sessionId, turnId) {
  return spawnSync('node', [DISPATCH], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'task',
      session_id: sessionId || 'mvs_parent', turn_id: turnId || 't1',
      tool_input: { agent_name: 'worker', prompt: 'SCOPE: src/app.ts\n干活' }
    }),
    encoding: 'utf8',
    env: { ...process.env, PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ },
    timeout: 60000
  });
}

// 账号级动作单独跑一次（工具名是 mavis，不是文件类工具）
function guardAccount(env, sessionId) {
  const sid = sessionId || 'mvs_child';
  const tr = sid === 'mvs_child' ? env.TR : writeTr(env, sid);
  const r = spawnSync('node', [GUARD], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse', tool_name: 'mavis',
      session_id: sid, agent_id: sid, agent_type: 'worker',
      transcript_path: tr, cwd: env.PROJ,
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

// 派工记录里带**等级快照**（F1-4）：worker 操作的等级 = 派工那一刻的等级。
const ledSnap = ledger(env5);
ok('派工记录里带等级快照',
  String(((ledSnap.dispatches || [])[0] || {}).tier) === 'scoped',
  JSON.stringify((ledSnap.dispatches || [])[0]).slice(0, 200));

// 提权是管理员动作：批准人必须是台账里**存在过的父会话 id**（F1 纵深防御）。
const tgBad = run(AMEND, ['--tier', 'full', '--agent', 'worker', '--approver', 'not-a-session'],
  { PLUGIN_DATA: env5.DATA, MINIMAX_PROJECT_DIR: env5.PROJ });
ok('提权的批准人不是台账里的父会话时被拒', tgBad.code === 1 && tgBad.out.ok === false,
  JSON.stringify(tgBad.out).slice(0, 200));

const tg = run(AMEND, ['--tier', 'full', '--agent', 'worker', '--approver', 'mvs_parent'],
  { PLUGIN_DATA: env5.DATA, MINIMAX_PROJECT_DIR: env5.PROJ });
ok('提权到 full 成功', tg.code === 0 && tg.out.ok === true && tg.out.changed === true,
  JSON.stringify(tg.out).slice(0, 200));

// 等级快照的**核心语义**：会话中途的提权对**已在飞**的会话无效。
// （改前这里每次调用都重读 roster.json —— 一次提权就长期有效。）
const gMid = guard(env5, 'write', { file_path: 'docs/other.md' });
ok('会话中途提权对已在飞的会话不生效（等级按派工时快照）',
  gMid.decision === 'deny', gMid.reason.slice(0, 140));

// 重新派工 + 新的子会话 → 按新等级生效
// （先把上一条派工收掉：同一 scope 的在飞派工会撞组队冲突闸门）
const ledEnd = ledger(env5);
ledEnd.dispatches[0].state = 'done';
fs.writeFileSync(path.join(env5.DATA, 'dispatches.json'), JSON.stringify(ledEnd, null, 2), 'utf8');
dispatchWorker(env5, 'mvs_parent', 't2');
const ledSnap2 = ledger(env5);
ok('重新派工后派工记录带新等级',
  String(((ledSnap2.dispatches || []).slice(-1)[0] || {}).tier) === 'full',
  JSON.stringify((ledSnap2.dispatches || []).slice(-1)[0]).slice(0, 200));
const CHILD2 = 'mvs_child2';
const gFullRead = guard(env5, 'read', { path: 'docs/other.md' }, CHILD2);
ok('full 等级：项目内读放行', gFullRead.decision !== 'deny', gFullRead.reason.slice(0, 140));
const gFullWrite = guard(env5, 'write', { file_path: 'docs/other.md' }, CHILD2);
ok('full 等级：项目内写放行', gFullWrite.decision !== 'deny', gFullWrite.reason.slice(0, 140));
const gFullNew = guard(env5, 'write', { file_path: 'src/brand-new.ts' }, CHILD2);
ok('full 等级：项目内新文件也放行', gFullNew.decision !== 'deny', gFullNew.reason.slice(0, 140));

// 工作区外仍拦，且仍自动记账
const outsidePath = path.join(env5.tmp, 'outside', 'x.md');
const gOut = guard(env5, 'write', { file_path: outsidePath }, CHILD2);
ok('full 等级：工作区外仍被拦', gOut.decision === 'deny', gOut.reason.slice(0, 160));
const ledOut = ledger(env5);
ok('工作区外越界已记账且带 tier',
  (ledOut.scope_requests || []).some((r) => r.state === 'pending' && String(r.tier) === 'full'),
  JSON.stringify(ledOut.scope_requests).slice(0, 240));

// 账号级不可逆动作照旧硬拦 —— tier 不是万能钥匙
const gAcct = guardAccount(env5, CHILD2);
ok('full 等级不解除账号级硬拦', gAcct.decision === 'deny', gAcct.reason.slice(0, 140));

// full 等级也要挖掉编排层私有目录 —— 否则成员能改兄弟成员的错题本
const gSuper = guard(env5, 'write', { file_path: '.superagent/lessons/sa-other.md' }, CHILD2);
ok('full 等级也不能写编排层私有目录', gSuper.decision === 'deny', gSuper.reason.slice(0, 160));
const gSuperAbs = guard(env5, 'write',
  { file_path: path.join(env5.PROJ, '.superagent', 'roster.json') }, CHILD2);
ok('full 等级也不能改权限名录（绝对路径同样拦）', gSuperAbs.decision === 'deny',
  gSuperAbs.reason.slice(0, 160));

// ── F3：full 等级命中私有目录的**文案**不能误诊 ──────────
//
// 以前这句话有两个毛病：
//   ① 诊断错：目标其实**在工作区内**，被拒的真实原因是私有状态目录；
//   ② 建议错：让人「批准该路径后重试」—— 而私有目录的批准**永远不生效**
//      （写模式对私有目录一律不授写权），于是父会话被引去做无效批准、worker 反复撞墙。
ok('私有目录拒语文案不出现「工作区之外」',
  !gSuperAbs.reason.includes('工作区之外'), gSuperAbs.reason.slice(0, 200));
ok('私有目录拒语文案不出现批准提示',
  !gSuperAbs.reason.includes('--grant') && !gSuperAbs.reason.includes('待审清单'),
  gSuperAbs.reason.slice(0, 200));
ok('私有目录拒语文案点明是私有状态目录',
  gSuperAbs.reason.includes('私有状态目录'), gSuperAbs.reason.slice(0, 200));

// 提权留痕
const rosterAfter = JSON.parse(
  fs.readFileSync(path.join(env5.PROJ, '.superagent', 'roster.json'), 'utf8'));
ok('提权写进了 roster.json',
  String((rosterAfter.members[0] || {}).tier) === 'full' &&
  String((rosterAfter.members[0] || {}).tier_granted_by) === 'mvs_parent',
  JSON.stringify(rosterAfter.members[0]).slice(0, 200));
// 审计留痕（A4）：提权也要能在项目变更账里看到批准人与时间
const logPath5 = path.join(env5.PROJ, '.superagent', 'changes.log');
const logTxt5 = fs.existsSync(logPath5) ? fs.readFileSync(logPath5, 'utf8') : '';
ok('提权在 changes.log 里留痕（批准人与时间）',
  logTxt5.includes('tier | worker | scoped -> full | by mvs_parent') &&
  /\d{4}-\d{2}-\d{2}T/.test(logTxt5),
  logTxt5.slice(-160));

// 收回
const tr = run(AMEND, ['--tier', 'scoped', '--agent', 'worker', '--approver', 'mvs_parent'],
  { PLUGIN_DATA: env5.DATA, MINIMAX_PROJECT_DIR: env5.PROJ });
ok('收回 full 成功', tr.code === 0 && tr.out.ok === true && tr.out.changed === true,
  JSON.stringify(tr.out).slice(0, 180));
const gRevoked = guard(env5, 'write', { file_path: 'docs/other.md' });
ok('收回后恢复拦截', gRevoked.decision === 'deny', gRevoked.reason.slice(0, 140));

// 对名录里没有的成员提权 -> 拒绝
const tb = run(AMEND, ['--tier', 'full', '--agent', 'not-a-member', '--approver', 'mvs_parent'],
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

// 目录条目覆盖整个工作区时，读范围也**不得**伸进私有记忆目录。
//
// 这是闸门 1c 漏掉的一条路：闸门只判「SCOPE 条目的路径本身碰没碰 .superagent/」，
// 而读模式对**目录条目**会展开整棵树 —— 一条 `ro: <工作区根>/` 的读范围是整个工作区，
// 连带把 .superagent/lessons/ 放开了。堵入口不够，**读范围本身也要判**。
const envRoot = makeEnv();
fs.mkdirSync(path.join(envRoot.PROJ, '.superagent', 'lessons'), { recursive: true });
fs.writeFileSync(path.join(envRoot.PROJ, '.superagent', 'lessons', 'sa-other.md'), '# 其他成员', 'utf8');
const rootScope = 'SCOPE: ro: ' + envRoot.PROJ.replace(/\\/g, '/') + '/';
fs.writeFileSync(envRoot.TR, JSON.stringify({
  uuid: 'p-3', parentUuid: null, sessionId: 'mvs_child',
  timestamp: new Date().toISOString(), type: 'user',
  message: { role: 'user', content: [{ type: 'text', text: [
    '<agent-context>', '  agentName: worker', '  PARENT SESSION: mvs_parent', '</agent-context>',
    '任务：按 brief 执行', rootScope
  ].join('\n') }] }
}) + '\n', 'utf8');
const dRoot = dispatchWithScope(envRoot, rootScope);
ok('覆盖工作区的目录条目本身可派（它没直接点 .superagent/）',
  !String(dRoot.stdout || '').includes('deny'), String(dRoot.stdout || '').slice(0, 160));
const gRootPriv = guard(envRoot, 'read', { path: '.superagent/lessons/sa-other.md' });
ok('目录条目的读范围也伸不进私有记忆目录', gRootPriv.decision === 'deny',
  gRootPriv.reason.slice(0, 160));
const gRootOk = guard(envRoot, 'read', { path: 'docs/other.md' });
ok('同一目录条目仍能读工作区里的普通文件', gRootOk.decision !== 'deny',
  gRootOk.reason.slice(0, 140));

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

// ── 11. F2：「批准请求」路径也必须校验派工状态 ────────────
//
// 以前只有「直接加条目」路径查 state，「批准请求」路径只查「记录还在不在」——
// 于是对已结束（done/aborted）的派工照样批准成功，两条路径口径不一致。
// 回归没覆盖到，是因为现有断言只测了「直接加条目」这一条路径。
for (const st of ['done', 'aborted']) {
  const envS = makeEnv();
  dispatchWorker(envS);
  guard(envS, 'write', { file_path: 'docs/other.md' });
  const ledS = ledger(envS);
  const ridS = (ledS.scope_requests || [])[0] ? ledS.scope_requests[0].request_id : '';
  ledS.dispatches[0].state = st;
  fs.writeFileSync(path.join(envS.DATA, 'dispatches.json'), JSON.stringify(ledS, null, 2), 'utf8');
  const gr = run(AMEND, ['--grant', ridS, '--approver', 'mvs_parent'], { PLUGIN_DATA: envS.DATA, MINIMAX_PROJECT_DIR: envS.PROJ });
  ok('--grant 对已结束的派工被拒（state=' + st + '）',
    gr.code === 1 && gr.out.ok === false, JSON.stringify(gr.out).slice(0, 200));
  ok('拒绝文案与「直接加条目」分支同一口径（state=' + st + '）',
    String((gr.out || {}).error || '').includes('已结束（state=' + st + '）'),
    String((gr.out || {}).error || '').slice(0, 200));
  const ledS2 = ledger(envS);
  ok('被拒后请求仍是 pending（没被批掉）（state=' + st + '）',
    String(((ledS2.scope_requests || [])[0] || {}).state) === 'pending',
    JSON.stringify((ledS2.scope_requests || [])[0]).slice(0, 200));
}

// ── 12. F1 纵深防御：批准人必须是真实的父会话 id ──────────
//
// 以前 --approver 只是命令行上的一个字符串，谁执行都算管理员 ——
// worker 能给自己提权、能自批准自己的越界请求。
// 这一层**挡不住蓄意自提权**（worker 的 brief 里就带着 PARENT SESSION），
// 它挡的是「随手写个名字就过」；主防线是 guard 的「权威面脚本父会话专属」。
{
  const envA = makeEnv();
  dispatchWorker(envA);
  guard(envA, 'write', { file_path: 'docs/other.md' });
  const ledA = ledger(envA);
  const ridA = (ledA.scope_requests || [])[0] ? ledA.scope_requests[0].request_id : '';
  // --list 要把父会话 id 直接给出来（父会话照抄即可，不必猜自己的 session id）
  const lA = run(AMEND, ['--list'], { PLUGIN_DATA: envA.DATA, MINIMAX_PROJECT_DIR: envA.PROJ });
  ok('--list 给出父会话 id（批准人照抄即可）',
    String((((lA.out || {}).pending || [])[0] || {}).parent_session_id || '') === 'mvs_parent',
    JSON.stringify((lA.out || {}).pending || []).slice(0, 200));
  const badApprover = run(AMEND, ['--grant', ridA, '--approver', 'not-the-parent'],
    { PLUGIN_DATA: envA.DATA, MINIMAX_PROJECT_DIR: envA.PROJ });
  ok('--grant 的批准人不是该派工的父会话时被拒',
    badApprover.code === 1 && badApprover.out.ok === false,
    JSON.stringify(badApprover.out).slice(0, 200));
  const goodApprover = run(AMEND, ['--grant', ridA, '--approver', 'mvs_parent'],
    { PLUGIN_DATA: envA.DATA, MINIMAX_PROJECT_DIR: envA.PROJ });
  ok('--grant 的批准人是该派工的父会话时通过',
    goodApprover.code === 0 && goodApprover.out.ok === true,
    JSON.stringify(goodApprover.out).slice(0, 200));
}
{
  // --dispatch --add 同属扩权动作，批准人同样要校验
  const envB = makeEnv();
  dispatchWorker(envB);
  const ledB = ledger(envB);
  const didB = ((ledB.dispatches || [])[0] || {}).dispatch_id || '';
  const badAdd = run(AMEND, ['--dispatch', didB, '--add', 'docs/other.md', '--approver', 'not-the-parent'],
    { PLUGIN_DATA: envB.DATA, MINIMAX_PROJECT_DIR: envB.PROJ });
  ok('--dispatch --add 的批准人不是父会话时被拒',
    badAdd.code === 1 && badAdd.out.ok === false, JSON.stringify(badAdd.out).slice(0, 200));
}

// ── 13. RG-03：legacy 迁移不得把 active 提升成 done ───────
//
// 台账迁移（readLedger）要给旧格式的行补 parent_session_id —— 那是必须的。
// 但把 state 从 active 改成 done，等于**替一个还没结束的派工伪造「已完成」**：
// record-gate 的履历真实性判据（台账里存在一条 state='done' 的派工记录）就被绕过了。
// 迁移只补缺失的字段，不改写已声明的状态。
function legacyProbe(env, rows) {
  fs.writeFileSync(path.join(env.DATA, 'dispatches.json'), JSON.stringify({
    dispatches: rows, bindings: [], counters: {}, scope_requests: []
  }, null, 2), 'utf8');
  const probe = path.join(env.tmp, 'probe-legacy-' + Math.random().toString(36).slice(2, 8) + '.mjs');
  fs.writeFileSync(probe, [
    "import { pathToFileURL } from 'node:url';",
    "const m = await import(pathToFileURL(process.env.SAR_LIB).href);",
    "const l = m.readLedger();",
    "const d = (l.dispatches || [])[0] || {};",
    "console.log(JSON.stringify({ state: d.state || '', legacy: !!d.legacy, parent: d.parent_session_id || '' }));"
  ].join('\n'), 'utf8');
  const p = spawnSync('node', [probe], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PLUGIN_DATA: env.DATA, SAR_LIB: path.join(PLUGIN_ROOT, 'scripts', 'lib.mjs') }
  });
  try { return JSON.parse((p.stdout || '').trim() || '{}'); } catch (e) { return {}; }
}
{
  const envL = makeEnv();
  const lj = legacyProbe(envL, [{
    dispatch_id: 'dsp_legacy_active', session_id: 'mvs_parent',
    state: 'active', scope: ['src/app.ts'], at: Date.now()
  }]);
  ok('legacy 行（state=active）迁移后仍是 active，不被提升成 done',
    lj.state === 'active', JSON.stringify(lj));
  ok('legacy 行仍被标记 legacy 并补上 parent_session_id',
    lj.legacy === true && lj.parent === 'mvs_parent', JSON.stringify(lj));
}
{
  // 旧格式且**没有**状态的行仍落到 done —— 否则一次历史派工会把会话永久锁死
  const envL2 = makeEnv();
  const lj2 = legacyProbe(envL2, [{
    dispatch_id: 'dsp_legacy_nostate', session_id: 'mvs_parent', scope: [], at: Date.now()
  }]);
  ok('没有状态的旧行仍落到 done（不把会话永久锁死）',
    lj2.state === 'done', JSON.stringify(lj2));
}

// ── 14. D-58：私有记忆目录的扩权不造死条目 ────────────────
//
// 范围层对私有记忆路径**一律不授予**（契约 S13.4）——
// 所以给私有记忆目录扩权，批了也永远不生效（死条目）。
// 扩权入口当场拒，并指出契约通道（Router 转写进 brief）。
{
  const envP = makeEnv();
  dispatchWorker(envP);
  guard(envP, 'read', { path: '.superagent/methods/sa-other.md' });
  const ledP = ledger(envP);
  const ridP = (ledP.scope_requests || [])[0] ? ledP.scope_requests[0].request_id : '';
  // 必须带 MINIMAX_PROJECT_DIR：否则 appendChangeLog() 会回退到 process.cwd()，
  // 把**测试夹具的假批准人**写进真实项目的变更账（D-64）。
  const gp = run(AMEND, ['--grant', ridP, '--approver', 'mvs_parent'],
    { PLUGIN_DATA: envP.DATA, MINIMAX_PROJECT_DIR: envP.PROJ });
  ok('私有记忆目录的 --grant 扩权被拒（不造死条目）',
    gp.code === 1 && gp.out.ok === false, JSON.stringify(gp.out).slice(0, 200));
}
{
  const envQ = makeEnv();
  dispatchWorker(envQ);
  const ledQ = ledger(envQ);
  const didQ = ((ledQ.dispatches || [])[0] || {}).dispatch_id || '';
  const gq = run(AMEND, ['--dispatch', didQ, '--add', '.superagent/methods/sa-other.md',
    '--read', '--approver', 'mvs_parent'], { PLUGIN_DATA: envQ.DATA, MINIMAX_PROJECT_DIR: envQ.PROJ });
  ok('私有记忆目录的 --dispatch --add 扩权被拒',
    gq.code === 1 && gq.out.ok === false, JSON.stringify(gq.out).slice(0, 200));
}


// ── 15. D-75：只读 → 可写的升级必须**显式**，不许静默 ──────
//
// 缺陷（D-75）：管理员用 --grant 批准一条「只读条目上的写请求」时，
// 只读条目会被追加一条可写条目 ⇒ **只读被静默升级成可写**，
// 而批准回执与变更账里都看不出这次升级（D-40 只改了拦截措辞，没动扩权入口）。
//
// 口径（父会话已定，机制照做）：
//   · 升级**能力保留**（不堵死批准权 —— 堵死会与「成员给管理员做事必须有权限」相反）；
//   · 升级**必须显式**：回执与变更账都要写明「哪个路径从哪个只读条目升级成了可写」。
//
// 这些断言钉的是「**显式**」，不是「不许升级」——
// 断言里既有「回执必须写出升级」，也有「升级后写确实放行」（证明能力没被堵死）。
//
// 标签统一用 'D-75 ' 前缀：变异体脚本按这个前缀挑断言（回退显式化 → 这些断言必须变红）。

// 把子会话 transcript 的 brief SCOPE 改成指定内容。
// brief 与派工记录的 SCOPE 要一致 —— guard 靠 scope 重叠把 worker 挂到它那条派工上。
function setBriefScope(env, scopeLine) {
  fs.writeFileSync(env.TR, JSON.stringify({
    uuid: 'p-9', parentUuid: null, sessionId: 'mvs_child',
    timestamp: new Date().toISOString(), type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: [
      '<agent-context>', '  agentName: worker', '  PARENT SESSION: mvs_parent', '</agent-context>',
      '任务：按 brief 执行', scopeLine
    ].join('\n') }] }
  }) + '\n', 'utf8');
}

function changesLogOf(env) {
  const p = path.join(env.PROJ, '.superagent', 'changes.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

// ① --grant 批准「只读条目上的写请求」→ 回执显式写出升级 + 来源条目
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: ro: docs/other.md, src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  // worker 写只读路径 → 被拦并记账（mode=write）
  const gw = guard(env, 'write', { file_path: 'docs/other.md' });
  ok('D-75 准备：worker 写只读路径被拦', gw.decision === 'deny', gw.reason.slice(0, 160));
  const led = ledger(env);
  const req = (led.scope_requests || [])[0] || {};
  ok('D-75 准备：越界请求被记成写请求',
    String(req.mode) === 'write' && JSON.stringify(req.targets || []).includes('docs/other.md'),
    JSON.stringify(req).slice(0, 200));
  const rid = String(req.request_id || '');

  const gr = run(AMEND, ['--grant', rid, '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  ok('D-75 --grant 批准成功', gr.code === 0 && gr.out.ok === true, JSON.stringify(gr.out).slice(0, 200));

  // 断言 1：回执里**显式**标明该路径从只读升级为可写（新增字段，既有字段语义不变）
  const upPaths = Array.isArray(gr.out.upgraded_paths) ? gr.out.upgraded_paths : null;
  ok('D-75 回执里有 upgraded_paths 字段且含被升级的路径',
    Array.isArray(upPaths) && upPaths.includes('docs/other.md'),
    JSON.stringify(gr.out.upgraded_paths));
  const upDetail = Array.isArray(gr.out.upgraded_from_readonly) ? gr.out.upgraded_from_readonly : [];
  const upOne = upDetail.find((u) => u && u.path === 'docs/other.md');
  ok('D-75 回执指明升级是从哪个只读条目来的',
    !!upOne && String(upOne.from_entry || '') === 'ro: docs/other.md' &&
    String(upOne.to_entry || '') === 'docs/other.md',
    JSON.stringify(upDetail).slice(0, 240));
  ok('D-75 回执的 upgrade_notice 明写「从只读条目升级为可写」',
    /只读/.test(String(gr.out.upgrade_notice || '')) && /可写/.test(String(gr.out.upgrade_notice || '')) &&
    String(gr.out.upgrade_notice || '').includes('ro: docs/other.md'),
    String(gr.out.upgrade_notice || '').slice(0, 200));

  // 断言 2：既有字段语义不变（added 仍是新增条目列表；note 仍说明「读请求只授读」）
  ok('D-75 既有字段语义不变：added 仍是新增的可写条目列表',
    JSON.stringify(gr.out.added) === JSON.stringify(['docs/other.md']),
    JSON.stringify(gr.out.added));
  ok('D-75 既有字段语义不变：note 仍写明「读请求只授读（ro: 条目）」',
    String(gr.out.note || '').includes('读请求只授读（ro: 条目）'),
    String(gr.out.note || '').slice(0, 200));

  // 断言 3：升级能力**保留**（不堵死批准权）—— 批准后写确实放行
  const led2 = ledger(env);
  ok('D-75 升级后派工 scope 里出现了可写条目',
    JSON.stringify((led2.dispatches || [])[0].scope || []).includes('"docs/other.md"'),
    JSON.stringify((led2.dispatches || [])[0].scope));
  const gAfter = guard(env, 'write', { file_path: 'docs/other.md' });
  ok('D-75 升级能力保留：批准后该路径的写请求放行（没把批准权堵死）',
    gAfter.decision !== 'deny', gAfter.reason.slice(0, 160));

  // 断言 4：变更账那一行**一眼看出**「只读 → 可写」并含来源条目
  const log = changesLogOf(env);
  const line = log.split(/\r?\n/).find((l) => l.includes('grant ' + rid)) || '';
  ok('D-75 变更账那一行写出「readonly -> writable」的升级',
    /upgrade readonly -> writable/.test(line), line.slice(0, 240));
  ok('D-75 变更账那一行含来源只读条目',
    /from: ro: docs\/other\.md/.test(line), line.slice(0, 240));
  ok('D-75 变更账那一行仍保留批准人与时间（既有口径不变）',
    line.includes('by mvs_parent') && /\d{4}-\d{2}-\d{2}T/.test(line), line.slice(0, 240));

  // 断言 5：台账里也留了升级痕迹（验收时不用只看回执）
  const led3 = ledger(env);
  const reqRow = (led3.scope_requests || [])[0] || {};
  ok('D-75 台账里也记下了升级来源',
    JSON.stringify(reqRow.upgraded_from_readonly || []).includes('ro: docs/other.md'),
    JSON.stringify(reqRow.upgraded_from_readonly || []).slice(0, 200));
}

// ② 读请求仍然只授读 —— 口径不得被本次改动带偏
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  guard(env, 'read', { path: 'docs/other.md' });
  const led = ledger(env);
  const req = (led.scope_requests || [])[0] || {};
  ok('D-75 准备：越界请求被记成读请求', String(req.mode) === 'read',
    JSON.stringify(req).slice(0, 200));
  const gr = run(AMEND, ['--grant', String(req.request_id || ''), '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  ok('D-75 读请求批准成功', gr.code === 0 && gr.out.ok === true, JSON.stringify(gr.out).slice(0, 200));
  ok('D-75 读请求只授读：派工 scope 里加的是 ro: 条目',
    JSON.stringify((ledger(env).dispatches || [])[0].scope || []).includes('ro: docs/other.md'),
    JSON.stringify((ledger(env).dispatches || [])[0].scope));
  ok('D-75 读请求批准**不**产生升级声明（只授读，没有只读→可写）',
    Array.isArray(gr.out.upgraded_paths) && gr.out.upgraded_paths.length === 0,
    JSON.stringify(gr.out.upgraded_paths));
  const gRead = guard(env, 'write', { file_path: 'docs/other.md' });
  ok('D-75 批准读不等于批准写：该路径的写请求仍被拦',
    gRead.decision === 'deny', gRead.reason.slice(0, 160));
}

// ③ --dispatch --add 与已有只读条目冲突 → 同样显式说明
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: ro: docs/other.md, src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  const did = (ledger(env).dispatches || [])[0].dispatch_id;
  const ad = run(AMEND, ['--dispatch', did, '--add', 'docs/other.md', '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  ok('D-75 --dispatch --add 成功', ad.code === 0 && ad.out.ok === true,
    JSON.stringify(ad.out).slice(0, 200));
  const adUp = Array.isArray(ad.out.upgraded_from_readonly) ? ad.out.upgraded_from_readonly : [];
  ok('D-75 --dispatch --add 与已有只读条目冲突时显式说明升级',
    JSON.stringify(ad.out.upgraded_paths || []).includes('docs/other.md') &&
    JSON.stringify(adUp).includes('ro: docs/other.md'),
    JSON.stringify(ad.out.upgraded_from_readonly || []).slice(0, 240));
  const adLog = changesLogOf(env);
  const adLine = adLog.split(/\r?\n/).find((l) => l.includes('add-entry')) || '';
  ok('D-75 --dispatch --add 的变更账也写出升级与来源条目',
    /upgrade readonly -> writable/.test(adLine) && /from: ro: docs\/other\.md/.test(adLine),
    adLine.slice(0, 240));
}

// ④ 只读**目录**条目覆盖下的写请求 → 升级也要被认出来
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: ro: docs/, src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  guard(env, 'write', { file_path: 'docs/other.md' });
  const led = ledger(env);
  const req = (led.scope_requests || [])[0] || {};
  const gr = run(AMEND, ['--grant', String(req.request_id || ''), '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  const det = Array.isArray(gr.out.upgraded_from_readonly) ? gr.out.upgraded_from_readonly : [];
  const one = det.find((u) => u && u.path === 'docs/other.md');
  ok('D-75 只读目录条目下的写请求：升级被认出来，来源是那个目录条目',
    !!one && String(one.from_entry || '') === 'ro: docs/',
    JSON.stringify(det).slice(0, 240));
}

// ⑤ 加可写**目录**条目罩住已有只读文件条目 → 也是升级（否则这是一条残留的静默升级路）
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: ro: docs/other.md, src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  const did = (ledger(env).dispatches || [])[0].dispatch_id;
  const ad = run(AMEND, ['--dispatch', did, '--add', 'docs/', '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  const det = Array.isArray(ad.out.upgraded_from_readonly) ? ad.out.upgraded_from_readonly : [];
  const one = det.find((u) => u && u.path === 'docs/other.md');
  ok('D-75 可写目录条目罩住只读文件条目：升级被认出来',
    !!one && String(one.from_entry || '') === 'ro: docs/other.md' &&
    String(one.to_entry || '') === 'docs/',
    JSON.stringify(det).slice(0, 240));
}

// ⑥ 路径写法不同（'./docs/other.md'）也必须被认出来 ——
//
// 为什么：升级检测早先按**写法逐字**比，于是管理员批一条 './docs/other.md'
// 就能把只读条目罩着的那个文件静默升级成可写，而回执与变更账都看不出。
// 同一个文件的不同写法必须归一后再比 —— 这条断言钉住的就是这个归一。
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: ro: docs/other.md, src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  // worker 用 './docs/other.md' 这种写法请求写 → 被拦并记账
  const gw = guard(env, 'write', { file_path: './docs/other.md' });
  ok('D-75 准备：别名写法的写请求被拦', gw.decision === 'deny', gw.reason.slice(0, 160));
  const led = ledger(env);
  const req = (led.scope_requests || [])[0] || {};
  const gr = run(AMEND, ['--grant', String(req.request_id || ''), '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  const det = Array.isArray(gr.out.upgraded_from_readonly) ? gr.out.upgraded_from_readonly : [];
  ok('D-75 路径写法不同（./docs/other.md）的升级仍被认出来',
    det.length > 0 && det.some((u) => u && String(u.from_entry || '') === 'ro: docs/other.md'),
    JSON.stringify(det).slice(0, 240));
  ok('D-75 同一文件的不同写法不重复记账（只报一条升级）',
    det.length === 1, JSON.stringify(det).slice(0, 240));
}

// ⑦ 变更账写成功没有 → 回执必须说出来（不许静默）
//
// 追加写失败时（目录不存在、只读盘……）以前是**静默吞掉**的：
// 回执说「ok: true」，但变更账里根本没有这一行 ——
// 「升级已记入变更账」就成了一句没人验证过的话。
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: ro: docs/other.md, src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  guard(env, 'write', { file_path: 'docs/other.md' });
  const led = ledger(env);
  const req = (led.scope_requests || [])[0] || {};
  const gr = run(AMEND, ['--grant', String(req.request_id || ''), '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  ok('D-75 回执带 audit_logged 字段（变更账写成功没有）',
    typeof gr.out.audit_logged === 'boolean', JSON.stringify(gr.out.audit_logged));
  ok('D-75 变更账确实写成功时 audit_logged 为 true',
    gr.out.audit_logged === true, JSON.stringify(gr.out.audit_logged));
}

// ⑧ 重复加同一条目 → 显式说明「本来就在」（不许静默的 no-op）
{
  const env = makeEnv();
  const scopeLine = 'SCOPE: ro: docs/other.md, src/app.ts';
  setBriefScope(env, scopeLine);
  dispatchWithScope(env, scopeLine);
  const did = (ledger(env).dispatches || [])[0].dispatch_id;
  run(AMEND, ['--dispatch', did, '--add', 'docs/other.md', '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  const ad2 = run(AMEND, ['--dispatch', did, '--add', 'docs/other.md', '--approver', 'mvs_parent'],
    { PLUGIN_DATA: env.DATA, MINIMAX_PROJECT_DIR: env.PROJ });
  ok('D-75 重复加同一条目：added 为空且显式列出 already-present',
    JSON.stringify(ad2.out.added) === JSON.stringify([]) &&
    JSON.stringify(ad2.out.duplicate_paths || []).includes('docs/other.md'),
    JSON.stringify(ad2.out.duplicate_paths || []).slice(0, 200));
}


// ── D-75 变异自检（独立开关 SAR_MUTATION_D75=1）────────────────────
//
// 为什么要有这个：只跑「新实现全绿」不能证明修复有效 ——
// 必须把实现改回去，看目标断言会不会红（D-66 的教训：没有专属断言的修复，回退实现后一条都不红）。
//
// 做法沿用 tests/e2e-test.mjs 里 SAR_MUTATION 约定的那一套：
//   ① 把插件副本装到**系统临时目录**（仓库工作树零改动，跑完即删）；
//   ② 在**副本**上做定向回退；
//   ③ 用副本重跑本套件的目标断言；
//   ④ 目标断言必须转红。
//
// 为什么用**独立开关**而不是复用 SAR_MUTATION=1：
//   总矩阵（SAR_MUTATION=1）归 tests/e2e-test.mjs 那一单独占，
//   两边的分档语义混在一起会让「总矩阵跑过了」被误读成「D-75 的变异体也跑过了」。
//   本单的变异体最终会由 tests/e2e-test.mjs 的下一位独占者归并进总矩阵，
//   在那之前本单先在自己的专属套件里自证。
//
// 用法：node tests/scope-amend-test.mjs   （设 SAR_MUTATION_D75=1）
async function runD75MutationMatrix() {
  const { fileURLToPath } = await import('node:url');
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const SRC_PLUGIN = path.join(REPO, 'plugin');

  const mutRead = (p) => fs.readFileSync(p, 'utf8');
  const mutWrite = (p, s) => fs.writeFileSync(p, s, 'utf8');
  // 替换一处文本；变异点没命中或不唯一就直接失败（变异体没生效 = 矩阵无效）。
  const mutReplace = (file, from, to) => {
    const src = mutRead(file);
    const idx = src.indexOf(from);
    if (idx < 0) throw new Error('变异点未命中：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    if (src.indexOf(from, idx + 1) >= 0) throw new Error('变异点不唯一：' + path.basename(file) + ' :: ' + from.slice(0, 90));
    mutWrite(file, src.slice(0, idx) + to + src.slice(idx + from.length));
  };

  const MUTANTS = [
    {
      // M1：把「升级显式化」整个摘掉 —— 回执与变更账都不再写升级。
      // 这是 D-75 的核心变异体：它必须让「升级有没有被显式说出来」那几条断言转红。
      id: 'M-D75a', defect: 'D-75',
      what: '回退「升级显式化」：detectReadonlyUpgrades 直接返回空（升级不再被算出来）',
      expect: [
        'D-75 回执里有 upgraded_paths 字段且含被升级的路径',
        'D-75 回执指明升级是从哪个只读条目来的',
        'D-75 变更账那一行写出「readonly -> writable」的升级',
        'D-75 台账里也记下了升级来源'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          'export function detectReadonlyUpgrades(scopeBefore, scopeAfter, targets) {\n  const before = Array.isArray(scopeBefore) ? scopeBefore : [];',
          'export function detectReadonlyUpgrades(scopeBefore, scopeAfter, targets) {\n  // MUT-D75a：升级显式化被摘掉 —— 升级不再被算出来\n  return [];\n  const before = Array.isArray(scopeBefore) ? scopeBefore : [];');
      }
    },
    {
      // M2：只把**变更账**那一行的升级标注摘掉（回执不动）。
      // 它必须让「变更账那一行能看出升级」那几条断言转红，
      // 而**回执**那几条仍然绿 —— 这一对变异体证明两块留痕是**各自**被钉住的，
      // 不是「一处红另一处跟着红」的假覆盖。
      id: 'M-D75b', defect: 'D-75',
      what: '回退变更账上的升级标注（回执不动）：变更账那一行不再写 readonly -> writable',
      expect: [
        'D-75 变更账那一行写出「readonly -> writable」的升级',
        'D-75 变更账那一行含来源只读条目',
        'D-75 --dispatch --add 的变更账也写出升级与来源条目'
      ],
      expectGreen: [
        'D-75 回执里有 upgraded_paths 字段且含被升级的路径'
      ],
      apply: (mut) => {
        const f = path.join(mut, 'scripts', 'scope-amend.mjs');
        mutReplace(f,
          "      (upgrades.length\n        ? ' | upgrade readonly -> writable: ' +\n          upgrades.map((u) => u.path + ' (from: ' + u.from_entry + ')').join('; ')\n        : '') +\n      (duplicates.length ? ' | already-present: ' + duplicates.join(', ') : ''));",
          "      '' +\n      (duplicates.length ? ' | already-present: ' + duplicates.join(', ') : ''));");
        mutReplace(f,
          "    (upgrades.length\n      ? ' | upgrade readonly -> writable: ' +\n        upgrades.map((u) => u.path + ' (from: ' + u.from_entry + ')').join('; ')\n      : '') +\n    (duplicate.length ? ' | already-present: ' + duplicate.join(', ') : ''));",
          "    '' +\n    (duplicate.length ? ' | already-present: ' + duplicate.join(', ') : ''));");
      }
    },
    {
      // M3：把**回执**上的升级字段摘掉（变更账不动）。
      // 与 M2 互为镜像：它必须让回执那几条转红、变更账那几条仍然绿。
      id: 'M-D75c', defect: 'D-75',
      what: '回退回执上的升级字段（变更账不动）：回执不再输出 upgraded_paths / upgraded_from_readonly',
      expect: [
        'D-75 回执里有 upgraded_paths 字段且含被升级的路径',
        'D-75 回执指明升级是从哪个只读条目来的'
      ],
      expectGreen: [
        'D-75 变更账那一行写出「readonly -> writable」的升级'
      ],
      apply: (mut) => {
        const f = path.join(mut, 'scripts', 'scope-amend.mjs');
        mutReplace(f,
          '      upgraded_paths: upgradePaths,\n      upgraded_from_readonly: upgrades,\n      upgrade_notice: upgradeNotice,',
          '      upgraded_paths: [],\n      upgraded_from_readonly: [],\n      upgrade_notice: \'\',');
        mutReplace(f,
          '    upgraded_paths: upgrades.map((u) => u.path),\n    upgraded_from_readonly: upgrades,\n    upgrade_notice: upgradeNotice,',
          '    upgraded_paths: [],\n    upgraded_from_readonly: [],\n    upgrade_notice: \'\',');
      }
    },
    {
      // M4：把**路径写法归一**摘掉 —— 升级检测退回按写法逐字比。
      // 它必须让「路径写法不同（./docs/other.md）的升级仍被认出来」那条断言转红：
      // 这条断言钉的正是「换个写法就绕过显式化」这个洞。
      id: 'M-D75d', defect: 'D-75',
      what: '回退路径写法归一：canonicalPathKey 原样返回（同一文件的不同写法认不出来）',
      expect: [
        'D-75 路径写法不同（./docs/other.md）的升级仍被认出来'
      ],
      apply: (mut) => {
        mutReplace(path.join(mut, 'scripts', 'lib.mjs'),
          "export function canonicalPathKey(p) {\n  const raw = String(p || '').replace(/\\\\/g, '/');",
          "export function canonicalPathKey(p) {\n  // MUT-D75d：路径写法归一被摘掉\n  return String(p || '');\n  const raw = String(p || '').replace(/\\\\/g, '/');");
      }
    }
  ];

  const mutRunSuite = (pluginRoot) => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tests', 'scope-amend-test.mjs')], {
      encoding: 'utf8', timeout: 300000, cwd: REPO,
      // 必须清掉 SAR_MUTATION_D75：被重跑的套件里若再次打开本工装，就会**递归**跑自己。
      env: Object.assign({}, process.env, { SAR_PLUGIN_ROOT: pluginRoot, SAR_MUTATION_D75: '' })
    });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const lines = out.split(/\r?\n/);
    return {
      red: lines.filter((l) => l.startsWith('FAIL ')),
      green: lines.filter((l) => l.startsWith('PASS ')).length
    };
  };

  console.log('| 变异体 | 缺陷 | 变异内容 | 转红断言数 | 目标断言全部转红 |');
  console.log('|---|---|---|---|---|');
  for (const m of MUTANTS) {
    const mutRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-mut-d75-' + m.id.toLowerCase() + '-'));
    const mutPlugin = path.join(mutRoot, 'plugin');
    try {
      fs.cpSync(SRC_PLUGIN, mutPlugin, { recursive: true });
      m.apply(mutPlugin);
      const r = mutRunSuite(mutPlugin);
      const missing = m.expect.filter((name) => !r.red.some((l) => l.indexOf(name) >= 0));
      // expectGreen：这些断言在「只回退这一处」的变异体下必须**仍然绿** ——
      // 否则说明两处留痕是连着的（改一处另一处跟着红），覆盖是假的。
      const wronglyRed = (m.expectGreen || []).filter((name) => r.red.some((l) => l.indexOf(name) >= 0));
      const good = missing.length === 0 && r.red.length > 0 && wronglyRed.length === 0;
      if (!good) fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | ' + r.red.length + ' | ' + (good ? 'YES' : 'NO') + ' |');
      for (const l of r.red) console.log('    RED ' + l.slice(0, 150));
      if (missing.length) console.log('    MISS ' + missing.join(' / '));
      if (wronglyRed.length) console.log('    WRONG-RED ' + wronglyRed.join(' / '));
    } catch (e) {
      fail++;
      console.log('| ' + m.id + ' | ' + m.defect + ' | ' + m.what + ' | 0 | NO（变异体本身失败：' + e.message + '） |');
    } finally {
      fs.rmSync(mutRoot, { recursive: true, force: true });
    }
  }
  console.log(fail === 0 ? '>>> D75 MUTATION MATRIX OK' : '>>> D75 MUTATION MATRIX FAILURES: ' + fail);
  process.exit(fail === 0 ? 0 : 1);
}

console.log(fail === 0 ? '>>> SCOPE-AMEND ALL PASS' : '>>> SCOPE-AMEND FAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
