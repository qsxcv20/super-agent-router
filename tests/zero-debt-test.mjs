// 零欠账收口轮的专属回归（D-87 / D-89 / D-90 / D-94）
//
// 每条缺陷一组**专属断言**（互不重叠、名字唯一 ⇒ 变异体矩阵能指认命中的是哪一条）：
//   D-87  后台任务通道（task_output / task_query / task_stop）的归属判定
//   D-89  追加轮（task_append）的台账登记与名额组
//   D-90  台账状态一致性（词表 / 单结论 / 索引行与明细逐字一致 / 统计重算 / 索引表单块）
//   D-94  版本字面量与目录结构数字的一致性
//   D-110 造故障的手法自己会不会坏（版本号写死 ⇒ 手法成空操作 ⇒ 假故障没造成 ⇒ 断言语焉不详地红）
//
// 断言不许恒绿：每条缺陷都配了**语义变异体**（tests/fixtures/zero-debt-mutation-matrix.mjs），
// 变异体把实现退化成旧行为 ⇒ 本套件的**专属断言**必须转红。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLedger, readStatusVocab, splitRow } from '../tools/ledger-check.mjs';

const REPO = path.resolve(process.env.SAR_REPO_DIR || process.cwd());
const PLUGIN_ROOT = path.resolve(REPO, process.env.SAR_PLUGIN_ROOT || 'plugin');

let fail = 0;
const ok = (l, c, e = '') => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + l + (e ? ' :: ' + e : '')); };

// ── 临时环境（不碰真实台账与真实项目）────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sar-zero-debt-'));
function newEnv(tag) {
  const dir = path.join(tmp, tag);
  const proj = path.join(dir, 'proj');
  const data = path.join(dir, 'data');
  fs.mkdirSync(path.join(proj, 'docs', 'audit'), { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(proj, 'docs', 'audit', 'a.md'), 'x', 'utf8');
  return { dir, proj, data, ledger: path.join(data, 'dispatches.json') };
}
function seedLedger(env, obj) {
  fs.writeFileSync(env.ledger, JSON.stringify(obj, null, 2), 'utf8');
}
function readLedger(env) {
  try { return JSON.parse(fs.readFileSync(env.ledger, 'utf8')); } catch { return {}; }
}
function runScript(script, payload, env) {
  const r = spawnSync('node', [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 20000,
    cwd: REPO,
    env: { ...process.env, PLUGIN_ROOT, MINIMAX_PROJECT_DIR: env.proj, PLUGIN_DATA: env.data }
  });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}
function isDeny(out) {
  return out.indexOf('permissionDecision') >= 0 && out.indexOf('deny') >= 0;
}
function denyReason(out) {
  try { return JSON.parse(out).hookSpecificOutput.permissionDecisionReason || ''; } catch { return out; }
}

console.log('[套件] 零欠账收口轮：D-87 / D-89 / D-90 / D-94 / D-110');

// ══════════════════════════════════════════════════════════════
// D-87：后台任务通道的归属判定
// ══════════════════════════════════════════════════════════════
{
  const env = newEnv('d87');
  seedLedger(env, {
    dispatches: [
      { dispatch_id: 'dsp_mine', parent_session_id: 'sess-parent', agent: 'sa-me', agent_key: 'sa-me',
        scope: ['docs/audit/'], state: 'done', at: Date.now() - 1000, end_reason: 'subagent_stop' },
      { dispatch_id: 'dsp_other', parent_session_id: 'sess-parent', agent: 'sa-other', agent_key: 'sa-other',
        scope: ['docs/audit/other.md'], state: 'done', at: Date.now() - 1000, end_reason: 'subagent_stop' }
    ],
    bindings: [
      { session_id: 'sess-worker', parent_session_id: 'sess-parent', agent: 'sa-me', agent_key: 'sa-me',
        scope: ['docs/audit/'], dispatch_id: 'dsp_mine', tier: 'scoped', at: Date.now() }
    ],
    task_bindings: [
      { task_id: 'bg_mine', dispatch_id: 'dsp_mine', agent: 'sa-me', agent_key: 'sa-me',
        session_id: 'sess-worker', at: Date.now() },
      { task_id: 'bg_other', dispatch_id: 'dsp_other', agent: 'sa-other', agent_key: 'sa-other',
        session_id: 'sess-parent', at: Date.now() }
    ],
    counters: {}, scope_requests: []
  });
  const base = { hook_event_name: 'PreToolUse', session_id: 'sess-worker', agent_type: 'sa-me',
    turn_id: 't1', cwd: env.proj };

  const mine = runScript('guard.mjs', Object.assign({}, base, {
    tool_name: 'task_output', tool_input: { task_id: 'bg_mine' }
  }), env);
  ok('D-87-A1 读自己成员的后台任务输出 ⇒ 放行', !isDeny(mine.out), mine.out.slice(0, 160));

  const other = runScript('guard.mjs', Object.assign({}, base, {
    tool_name: 'task_output', tool_input: { task_id: 'bg_other' }
  }), env);
  ok('D-87-A2 读别的成员的后台任务输出 ⇒ 拒绝', isDeny(other.out), other.out.slice(0, 160));
  ok('D-87-A3 拒绝文案点名「另一个成员」（断言可指认命中的是哪条规则）',
    denyReason(other.out).indexOf('另一个成员') >= 0, denyReason(other.out).slice(0, 200));

  const unknown = runScript('guard.mjs', Object.assign({}, base, {
    tool_name: 'task_output', tool_input: { task_id: 'bg_nobody' }
  }), env);
  ok('D-87-A4 归属查不到的后台任务 ⇒ 拒绝（取不到归属即拒绝）', isDeny(unknown.out), unknown.out.slice(0, 160));
  ok('D-87-A5 归属查不到的拒绝文案说清「查不到」',
    denyReason(unknown.out).indexOf('归属查不到') >= 0, denyReason(unknown.out).slice(0, 200));

  const noId = runScript('guard.mjs', Object.assign({}, base, {
    tool_name: 'task_output', tool_input: {}
  }), env);
  ok('D-87-A6 task_output 载荷里没有 task_id ⇒ 拒绝（取不到目标即拒绝）',
    isDeny(noId.out), noId.out.slice(0, 160));

  const list = runScript('guard.mjs', Object.assign({}, base, {
    tool_name: 'task_query', tool_input: {}
  }), env);
  ok('D-87-A7 task_query 不带 task_id（列本会话的任务）⇒ 放行',
    !isDeny(list.out), list.out.slice(0, 160));

  const stopOther = runScript('guard.mjs', Object.assign({}, base, {
    tool_name: 'task_stop', tool_input: { task_id: 'bg_other' }
  }), env);
  ok('D-87-A8 停别的成员的后台任务 ⇒ 拒绝', isDeny(stopOther.out), stopOther.out.slice(0, 160));

  const parent = runScript('guard.mjs', {
    hook_event_name: 'PreToolUse', session_id: 'sess-parent', tool_name: 'task_output',
    tool_input: { task_id: 'bg_other' }, cwd: env.proj
  }, env);
  ok('D-87-A9 父会话不受 worker 的归属判定约束（载荷没有 agent_type ⇒ 早退）',
    !isDeny(parent.out), parent.out.slice(0, 160));

  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const readGroup = (hooks.hooks.PreToolUse || []).find((g) => g.matcher && /read\|glob/.test(g.matcher)) || {};
  const rm = String(readGroup.matcher || '').split(/[|,]/).map((s) => s.trim());
  ok('D-87-A10 hooks.json 读类 matcher 逐个列出三个后台任务工具（宿主 matcher 是精确等值）',
    rm.includes('task_output') && rm.includes('task_query') && rm.includes('task_stop'),
    'matcher=' + String(readGroup.matcher || ''));
}

// ══════════════════════════════════════════════════════════════
// D-89：追加轮的台账登记与名额组
// ══════════════════════════════════════════════════════════════
{
  const env = newEnv('d89');
  seedLedger(env, {
    dispatches: [
      { dispatch_id: 'dsp_orig', parent_session_id: 'sess-parent', agent: 'sa-me', agent_key: 'sa-me',
        scope: ['docs/audit/'], state: 'done', at: Date.now() - 5000, end_reason: 'subagent_stop',
        tool_use_id: 'tu_1' }
    ],
    bindings: [
      { session_id: 'sess-child', parent_session_id: 'sess-parent', agent: 'sa-me', agent_key: 'sa-me',
        scope: ['docs/audit/'], dispatch_id: 'dsp_orig', tier: 'scoped', at: Date.now() }
    ],
    task_bindings: [
      { task_id: 'bg_x', dispatch_id: 'dsp_orig', agent: 'sa-me', agent_key: 'sa-me',
        session_id: 'sess-child', sub_session_id: 'sess-child', at: Date.now() }
    ],
    counters: { 'sess-parent': 1 }, scope_requests: []
  });

  // ① PostToolUse(task) 登记 task_id 归属
  const post = runScript('dispatch.mjs', {
    hook_event_name: 'PostToolUse', tool_name: 'task', session_id: 'sess-parent', turn_id: 't1',
    tool_use_id: 'tu_post', tool_input: { agent_name: 'sa-me', prompt: 'x' },
    tool_response: { tool_name: 'task', text: '<task_background task_id="bg_post">', details: { task_id: 'bg_post', sub_session_id: 'sess-child2' } }
  }, env);
  ok('D-89-B1 PostToolUse(task) 不报错（静默登记即可）', post.code === 0, 'code=' + post.code + ' ' + post.err.slice(0, 120));
  const afterPost = readLedger(env);
  ok('D-89-B2 PostToolUse(task) 把 task_id 登记进台账（归属的唯一来源）',
    (afterPost.task_bindings || []).some((b) => b.task_id === 'bg_post' && b.sub_session_id === 'sess-child2'),
    JSON.stringify(afterPost.task_bindings || []));

  // ② 追加轮：台账里查不到 ⇒ 拒绝
  const unknown = runScript('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task_append', session_id: 'sess-parent', turn_id: 't2',
    tool_use_id: 'tu_2', tool_input: { task_id: 'bg_nobody', content: '追加内容' }, cwd: env.proj
  }, env);
  ok('D-89-B3 追加轮查不到原派工 ⇒ 拒绝（载荷里没有 agent 身份，反查不到就是判不出边界）',
    isDeny(unknown.out), unknown.out.slice(0, 200));

  // ③ 追加轮：登记成功，继承原派工的成员与 SCOPE
  const app = runScript('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task_append', session_id: 'sess-parent', turn_id: 't3',
    tool_use_id: 'tu_3', tool_input: { task_id: 'bg_x', content: '追加内容' }, cwd: env.proj
  }, env);
  ok('D-89-B4 追加轮登记成功（不是拒绝）', !isDeny(app.out) && app.code === 0, app.out.slice(0, 200) + app.err.slice(0, 120));
  const after = readLedger(env);
  const appends = (after.dispatches || []).filter((d) => d.append_of === 'dsp_orig');
  ok('D-89-B5 追加轮在派工台账里有一条自己的条目', appends.length === 1,
    'appends=' + JSON.stringify(appends.map((a) => a.dispatch_id)));
  const ap = appends[0] || {};
  ok('D-89-B6 追加轮继承原派工的成员与 SCOPE',
    ap.agent_key === 'sa-me' && JSON.stringify(ap.scope) === JSON.stringify(['docs/audit/']),
    'agent_key=' + ap.agent_key + ' scope=' + JSON.stringify(ap.scope));
  ok('D-89-B7 追加轮与原派工共用名额组（不重复占名额、也不提前释放）',
    ap.slot_group === 'dsp_orig', 'slot_group=' + ap.slot_group);
  ok('D-89-B8 追加轮条目是在飞状态（可走「为在飞派工预授权」通道）', ap.state === 'active', 'state=' + ap.state);
  const binding = (after.bindings || []).find((b) => b.session_id === 'sess-child');
  ok('D-89-B9 子会话绑定改指追加条目（SubagentStop 回收的是追加轮，不是已结束的原派工）',
    !!binding && binding.dispatch_id === ap.dispatch_id, 'binding=' + JSON.stringify(binding));
  ok('D-89-B10 追加轮不消耗累计派工额度（同一份工作的下一轮）',
    Number((after.counters || {})['sess-parent'] || 0) === 1, 'counter=' + JSON.stringify(after.counters));

  // ④ 名额口径：原派工已结束，但名额组仍在飞 ⇒ 名额没有被提前释放
  const { activeDispatches, activeDispatchesAll } = await import('../plugin/scripts/lib.mjs');
  const active = activeDispatches(after, 'sess-parent', Date.now());
  ok('D-89-B11 追加轮在飞时，该名额组仍占 1 个名额（不是 0、也不是 2）',
    active.length === 1 && active[0].dispatch_id === ap.dispatch_id,
    'active=' + JSON.stringify(active.map((a) => a.dispatch_id)));
  ok('D-89-B12 项目维度的在飞名单也只算这一组（自己跟自己不算组队冲突）',
    activeDispatchesAll(after, Date.now(), null).length === 1,
    'all=' + JSON.stringify(activeDispatchesAll(after, Date.now(), null).map((a) => a.dispatch_id)));

  // ⑤ hooks：task_append 与 task 是两个独立工具名，必须逐个列出
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const groups = hooks.hooks.PreToolUse || [];
  const dispatchGroup = groups.find((g) => g.matcher && String(g.matcher).split(/[|,]/).map((s) => s.trim()).includes('task')) || {};
  const dm = String(dispatchGroup.matcher || '').split(/[|,]/).map((s) => s.trim());
  ok('D-89-B13 hooks.json dispatch 组逐个列出 task 与 task_append（宿主 matcher 是精确等值）',
    dm.includes('task') && dm.includes('task_append'), 'matcher=' + String(dispatchGroup.matcher || ''));
  const postGroup = (hooks.hooks.PostToolUse || [])[0] || {};
  ok('D-89-B14 hooks.json 注册了 PostToolUse(task) 组（登记 task_id 归属）',
    String(postGroup.matcher || '').split(/[|,]/).map((s) => s.trim()).includes('task'),
    'matcher=' + String(postGroup.matcher || ''));

  // ⑥ 名额组的**直接**断言：原派工仍在飞时，追加轮与它同组 ⇒ 只占 1 个名额。
  //
  // 为什么要单独这一组：B11/B12 用的原派工是 done（那是「名额提前释放」那条），
  // 而「**同组去重**」只在两条记录**同时在飞**时才体现得出 —— 不单独构造这个形态，
  // 「追加轮被当成新的一份工作」这个退化就抓不到（变异体 M-D89e 会漏网）。
  const env2 = newEnv('d89b');
  seedLedger(env2, {
    dispatches: [
      { dispatch_id: 'dsp_orig', parent_session_id: 'sess-parent', agent: 'sa-me', agent_key: 'sa-me',
        scope: ['docs/audit/'], state: 'active', at: Date.now() - 5000, tool_use_id: 'tu_1' }
    ],
    bindings: [
      { session_id: 'sess-child', parent_session_id: 'sess-parent', agent: 'sa-me', agent_key: 'sa-me',
        scope: ['docs/audit/'], dispatch_id: 'dsp_orig', tier: 'scoped', at: Date.now() }
    ],
    task_bindings: [
      { task_id: 'bg_x', dispatch_id: 'dsp_orig', agent: 'sa-me', agent_key: 'sa-me',
        session_id: 'sess-child', sub_session_id: 'sess-child', at: Date.now() }
    ],
    counters: { 'sess-parent': 1 }, scope_requests: []
  });
  const app2 = runScript('dispatch.mjs', {
    hook_event_name: 'PreToolUse', tool_name: 'task_append', session_id: 'sess-parent', turn_id: 't4',
    tool_use_id: 'tu_4', tool_input: { task_id: 'bg_x', content: '追加内容' }, cwd: env2.proj
  }, env2);
  ok('D-89-B15 原派工仍在飞时，追加轮仍能登记成功（自己跟自己不算组队冲突 ⇒ 不该被拦）',
    !isDeny(app2.out), app2.out.slice(0, 160) + app2.err.slice(0, 120));
  const after2 = readLedger(env2);
  const active2 = activeDispatches(after2, 'sess-parent', Date.now());
  ok('D-89-B16 同组去重：两条都在飞时，在飞名单里只有 1 条（自己跟自己不算组队冲突）',
    active2.length === 1,
    'active=' + JSON.stringify(active2.map((a) => a.dispatch_id)));
  const all2 = activeDispatchesAll(after2, Date.now(), null);
  ok('D-89-B17 项目维度的在飞名单同样只算 1 条（同组不重复占位、不自撞）',
    all2.length === 1,
    'all=' + JSON.stringify(all2.map((a) => a.dispatch_id)));
}

// ══════════════════════════════════════════════════════════════
// D-90：台账状态一致性
// ══════════════════════════════════════════════════════════════
{
  const LEDGER = path.join(REPO, 'docs', 'audit', 'defect-ledger.md');
  const text = fs.readFileSync(LEDGER, 'utf8');
  const base = checkLedger(text);
  ok('D-90-C1 真实台账零偏差（零欠账）', base.ok, JSON.stringify(base.deviations.map((d) => d.key)));
  const checks = new Set(base.checks.map((c) => c.id));
  ok('D-90-C2 台账检查包含状态四项（词表 / 一致性 / 统计 / 未闭合）',
    checks.has('status-vocab') && checks.has('status-consistency') &&
    checks.has('status-stats') && checks.has('no-unfixed'), [...checks].join(','));
  ok('D-90-C3 台账检查包含索引表单块（D-96 的遗留）', checks.has('index-single-block'), [...checks].join(','));

  // 词表来自契约（不在脚本里另抄一份）
  const vocab = readStatusVocab(REPO);
  ok('D-90-C4 状态词表从契约读出来（5 个词）', vocab.length === 5, JSON.stringify(vocab));

  function mutateStatus(fn) {
    const lines = text.split(/\r\n|\r|\n/);
    fn(lines);
    return lines.join('\n');
  }
  function checkIds(res) {
    return res.deviations.map((d) => d.check);
  }
  // ① 索引行状态与明细不一致
  const drift = mutateStatus((lines) => {
    const head = lines.findIndex((l) => splitRow(l)[0] === '台账编号');
    for (let i = head + 2; i < lines.length; i++) {
      if (!/^\s*\|/.test(lines[i])) break;
      const cells = splitRow(lines[i]);
      if (cells[0] === 'D-01') {
        cells[4] = '已修（某个别的版本）';
        lines[i] = '| ' + cells.join(' | ') + ' |';
        return;
      }
    }
  });
  ok('D-90-C5 索引行状态与明细段不一致 ⇒ status-consistency 转红',
    checkIds(checkLedger(drift)).indexOf('status-consistency') >= 0,
    JSON.stringify(checkLedger(drift).deviations.map((d) => d.key)));
  // ② 状态不在词表内
  const oov = mutateStatus((lines) => {
    for (let i = 0; i < lines.length; i++) {
      if (/^- 状态：已修（v0\.5\.0）$/.test(lines[i])) { lines[i] = '- 状态：已复现'; return; }
    }
  });
  ok('D-90-C6 状态不在契约词表内 ⇒ status-vocab 转红',
    checkIds(checkLedger(oov)).indexOf('status-vocab') >= 0,
    JSON.stringify(checkLedger(oov).deviations.map((d) => d.key)));
  // ③ 双结论
  const dual = mutateStatus((lines) => {
    for (let i = 0; i < lines.length; i++) {
      if (/^- 状态：已修（v0\.5\.0）$/.test(lines[i])) { lines[i] = '- 状态：已修（v0.5.0，未修）'; return; }
    }
  });
  ok('D-90-C7 一条状态塞两个结论 ⇒ status-vocab 转红',
    checkIds(checkLedger(dual)).indexOf('status-vocab') >= 0,
    JSON.stringify(checkLedger(dual).deviations.map((d) => d.key)));
  // ④ 统计行的状态计数被改坏
  const statDrift = mutateStatus((lines) => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('条目统计') >= 0 && lines[i].indexOf('状态：') >= 0) {
        lines[i] = lines[i].replace(/已修 \d+ 条/, '已修 1 条');
        return;
      }
    }
  });
  ok('D-90-C8 统计行的状态计数与明细重算不符 ⇒ status-stats 转红',
    checkIds(checkLedger(statDrift)).indexOf('status-stats') >= 0,
    JSON.stringify(checkLedger(statDrift).deviations.map((d) => d.key)));
  // ⑤ 有一条状态写成「未修」
  const unfixed = mutateStatus((lines) => {
    for (let i = 0; i < lines.length; i++) {
      if (/^- 状态：已修（v0\.5\.0）$/.test(lines[i])) { lines[i] = '- 状态：未修（还没做完）'; return; }
    }
  });
  ok('D-90-C9 有条缺陷状态写成「未修」⇒ no-unfixed 转红（零欠账第 1 条）',
    checkIds(checkLedger(unfixed)).indexOf('no-unfixed') >= 0,
    JSON.stringify(checkLedger(unfixed).deviations.map((d) => d.key)));
  // ⑥ 索引表被折行断成两块
  const splitTable = mutateStatus((lines) => {
    const head = lines.findIndex((l) => splitRow(l)[0] === '台账编号');
    // 折行必须落在**中间**的一行上：折断之后剩下的行会自成一块 ⇒ 索引表被断成两块。
    const target = head + 6;
    const cells = splitRow(lines[target]);
    lines[target] = '| ' + cells.slice(0, 5).join(' | ') + ' |';
    lines.splice(target + 1, 0, cells[5] + ' |');
    return;
  });
  ok('D-90-C10 索引表被折行断成两块 ⇒ index-single-block 转红',
    checkIds(checkLedger(splitTable)).indexOf('index-single-block') >= 0,
    JSON.stringify(checkLedger(splitTable).deviations.map((d) => d.key)));
  // ⑦ 模板里的状态字段写着词表外的旧词（「已复现 | 推断」）
  const oldTmpl = mutateStatus((lines) => {
    for (let i = 0; i < lines.length; i++) {
      if (/^- 状态：已修 \| 未修 \| 设计边界/.test(lines[i])) { lines[i] = '- 状态：已复现 | 推断'; return; }
    }
  });
  ok('D-90-C11 模板里的状态字段含词表外的旧词 ⇒ template-status-vocab 转红',
    checkIds(checkLedger(oldTmpl)).indexOf('template-status-vocab') >= 0,
    JSON.stringify(checkLedger(oldTmpl).deviations.map((d) => d.key)));
}

// ── D-110：造故障的手法（派生版本号 + 替换字节）自己会不会坏 ──────────
//
// 为什么要有这一段（D-110 的真身）：
//   「造故障」的手法自己会坏。D-94-D6 原来把假仓库 manifest 的版本字面量**写死**成
//   0.5.10 → 0.5.11；仓库一升到 0.5.11，这个 replace 就成了**空操作** ⇒
//   假仓库里 manifest 与文档仍然一致 ⇒ 被测检查器退出码 0 ⇒
//   「退出码非 0」那条断言变红，而红的原因（手法坏了）**不在那条断言的视野里**。
//   把字面量改成「下一个版本」只是把同一个坑推迟到下一次升版，不是修好。
//
// 两条规矩（缺一不可）：
//   ① 版本号**从当前版本派生**（末段 +1），任何地方都不写死版本号；
//   ② 每次注入都**断言字节真的变了** —— 没变就是手法失效，当场停下并说清楚。
export function nextVersion(current) {
  const m = String(current || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return '';
  return m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);
}

// 从 manifest 文本里读版本号（读 JSON，不靠正则猜字段）。
export function readManifestVersion(manifestText) {
  try {
    const obj = JSON.parse(String(manifestText || ''));
    return String((obj && obj.version) || '');
  } catch { return ''; }
}

// 只换 manifest 里的 version 字段（不碰 description 里的其它字面量）。
export function replaceManifestVersion(manifestText, next) {
  return String(manifestText || '').replace(/("version"\s*:\s*")([^"]+)(")/, (m, a, v, c) => a + next + c);
}

// 手法本体：读当前版本 → 派生下一个 → 替换。派生过程一并返回，供断言盯。
export function bumpManifestVersion(manifestText) {
  const current = readManifestVersion(manifestText);
  const next = nextVersion(current);
  return { current, next, mutated: replaceManifestVersion(manifestText, next) };
}

// 造故障的统一入口：替换后**断言字节真的变了**。
// 没变 ⇒ 手法失效（假故障根本没造成）⇒ 当场停下并明确说「造故障的手法失效了」，
// 而不是让后面的断言语焉不详地红（看不出是手法坏了还是机制坏了）。
const injectFault = (id, label, filePath, before, after) => {
  const changed = after !== before;
  ok(id + ' 造故障手法自检 · ' + label + '：字节确实被改掉了', changed,
    changed ? '' : '造故障的手法失效了（D-110）：替换后字节与原文完全相同 ⇒ 假故障没造成');
  if (!changed) {
    console.log('>>> 造故障的手法失效了（D-110）：手法坏掉时后续断言语焉不详地红，先停在这里');
    process.exit(1);
  }
  fs.writeFileSync(filePath, after, 'utf8');
};

// ══════════════════════════════════════════════════════════════
// D-94：版本字面量与目录结构数字
// ══════════════════════════════════════════════════════════════
{
  const CHECK = path.join(REPO, 'tools', 'install-selftest', 'check-version-consistency.mjs');
  const r0 = spawnSync('node', [CHECK], { cwd: REPO, encoding: 'utf8', timeout: 20000 });
  ok('D-94-D1 版本一致性自测在真实仓库里全绿（退出码 0）',
    r0.status === 0, 'exit=' + r0.status + ' ' + (r0.stdout || '').slice(-300));

  // 复制一份「仓库」到临时目录，再把版本字面量改坏 ⇒ 必须红
  const fake = path.join(tmp, 'fake-repo');
  fs.mkdirSync(path.join(fake, 'plugin', '.minimax-plugin'), { recursive: true });
  fs.mkdirSync(path.join(fake, 'plugin', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(fake, 'plugin', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fake, 'tools', 'install-selftest'), { recursive: true });
  for (const rel of ['README.md', 'plugin/README.md', 'plugin/CHANGELOG.md',
    'plugin/.minimax-plugin/plugin.json', 'plugin/hooks/hooks.json']) {
    fs.copyFileSync(path.join(REPO, rel), path.join(fake, rel));
  }
  for (const f of fs.readdirSync(path.join(REPO, 'plugin', 'scripts'))) {
    fs.copyFileSync(path.join(REPO, 'plugin', 'scripts', f), path.join(fake, 'plugin', 'scripts', f));
  }
  fs.copyFileSync(CHECK, path.join(fake, 'tools', 'install-selftest', 'check-version-consistency.mjs'));

  const runFake = () => spawnSync('node', [path.join(fake, 'tools', 'install-selftest', 'check-version-consistency.mjs')],
    { cwd: fake, encoding: 'utf8', timeout: 20000 });

  const good = runFake();
  ok('D-94-D2 未改动的副本全绿（基线）', good.status === 0, 'exit=' + good.status);

  // ── D-110：手法从当前版本派生 + 每次注入都断言字节真变了 ──────────
  const manifestPath = path.join(fake, 'plugin', '.minimax-plugin', 'plugin.json');
  const man = fs.readFileSync(manifestPath, 'utf8');
  const bump = bumpManifestVersion(man);
  ok('D-110-D1 注入用的版本号必须从当前版本派生（写死 ⇒ 下次升版复发）',
    bump.current !== '' && bump.next !== '' && bump.next !== bump.current &&
    bump.next === nextVersion(bump.current) && nextVersion('9.9.7') === '9.9.8',
    'current=' + bump.current + ' derived=' + bump.next + ' probe(9.9.7)=' + nextVersion('9.9.7'));

  const readmePath = path.join(fake, 'README.md');
  const orig = fs.readFileSync(readmePath, 'utf8');
  const rootVer = (orig.match(/当前版本：\*\*v?(\d+\.\d+\.\d+)\*\*/) || [])[1] || '';
  const rootVerNext = nextVersion(rootVer);
  injectFault('D-110-D3', 'README 版本字面量', readmePath, orig,
    orig.replace(/当前版本：\*\*v?(\d+\.\d+\.\d+)\*\*/, '当前版本：**v' + rootVerNext + '**'));
  const badVer = runFake();
  ok('D-94-D3 根 README 的版本字面量与 plugin.json 不一致 ⇒ 退出码非 0',
    badVer.status !== 0, 'exit=' + badVer.status);
  ok('D-94-D4 版本分叉时点名「当前版本」那条断言',
    (badVer.stdout || '').indexOf('根 README 的「当前版本」== plugin.json') >= 0,
    (badVer.stdout || '').slice(-400));
  fs.writeFileSync(readmePath, orig, 'utf8');

  injectFault('D-110-D4', 'README handler 数', readmePath, orig,
    orig.replace(/#\s*(\d+)\s*个 handler/, '# 99 个 handler'));
  const badNum = runFake();
  ok('D-94-D5 README 的 handler 数与实际不符 ⇒ 退出码非 0', badNum.status !== 0, 'exit=' + badNum.status);
  fs.writeFileSync(readmePath, orig, 'utf8');

  injectFault('D-110-D2', 'manifest 升版', manifestPath, man, bump.mutated);
  const badMan = runFake();
  ok('D-94-D6 plugin.json 升版而文档没跟 ⇒ 退出码非 0', badMan.status !== 0, 'exit=' + badMan.status);
  fs.writeFileSync(manifestPath, man, 'utf8');

  // 脚本数也必须对得上（与 handler 数同一条口径，别只查一半）
  injectFault('D-110-D5', 'README 脚本数', readmePath, orig,
    orig.replace(/#\s*(\d+)\s*个脚本/, '# 99 个脚本'));
  const badScripts = runFake();
  ok('D-94-D9 README 的脚本数与实际不符 ⇒ 退出码非 0', badScripts.status !== 0, 'exit=' + badScripts.status);
  fs.writeFileSync(readmePath, orig, 'utf8');

  // 断言必须并进 install-selftest 的套件
  const runAll = fs.readFileSync(path.join(REPO, 'tools', 'install-selftest', 'run-all.ps1'), 'utf8');
  ok('D-94-D7 版本一致性自测已并进 run-all.ps1 的套件',
    runAll.indexOf('check-version-consistency.mjs') >= 0, '');
  const suiteNames = [...runAll.matchAll(/name\s*=\s*'([^']+\.(?:mjs|ps1))'/g)].map((m) => m[1]);
  const declared = Number((runAll.match(/ASSERTION-COUNT:\s*(\d+)/) || [])[1] || 0);
  ok('D-94-D8 run-all.ps1 的自身条数声明 == 子套件数 + 2',
    declared === suiteNames.length + 2, 'declared=' + declared + ' suites=' + suiteNames.length);
}

console.log('');
console.log(fail === 0 ? '>>> ZERO-DEBT ALL PASS' : '>>> ZERO-DEBT FAILURES: ' + fail);
process.exit(fail ? 1 : 0);
